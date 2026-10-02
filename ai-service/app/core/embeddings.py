from typing import List
import numpy as np
from app.core.config import get_settings

# 各 provider 的输出维度。RAG 索引按维度建表，跨 provider 切换会导致维度不匹配，
# 这里集中维护以便在切换时给出明确提示，而不是让 np.stack 在启动时崩溃。
PROVIDER_DIMENSIONS = {
    "mock": 768,
    "basic": 768,
    "openai": 1536,
    # local 的真实维度取决于所加载的 sentence-transformers 模型，
    # 默认 BAAI/bge-small-zh-v1.5 为 512 维，运行时以模型实际输出为准。
}


class EmbeddingService:
    """Embedding 服务。

    重要：配置通过 get_settings() 动态读取（而不是模块导入时固化的 settings 单例），
    这样用户在「AI 配置」界面修改 provider/model 后无需重启进程即可生效——
    与 LLMRouter 的行为保持一致。

    _model 会在 provider/model 变化时自动重建，避免缓存到过期模型。
    """

    def __init__(self):
        self._model = None
        # 记录当前缓存的模型对应的 (provider, model_name)，便于检测变更
        self._cached_key: tuple | None = None

    def _current_key(self) -> tuple:
        s = get_settings()
        return (s.embedding_provider, s.embedding_model)

    @property
    def provider(self) -> str:
        return get_settings().embedding_provider

    @property
    def model_name(self) -> str:
        return get_settings().embedding_model

    def _get_model(self):
        """懒加载模型，provider/model 变化时自动重建。"""
        key = self._current_key()
        if self._model is not None and self._cached_key == key:
            return self._model

        provider = key[0]
        model_name = key[1]
        if provider == "local":
            from sentence_transformers import SentenceTransformer
            self._model = SentenceTransformer(model_name)
        elif provider == "basic":
            from sklearn.feature_extraction.text import HashingVectorizer
            self._model = HashingVectorizer(
                analyzer='char',
                ngram_range=(2, 4),
                n_features=768,
                alternate_sign=False,
            )
        else:
            # mock / openai 不需要常驻模型对象
            self._model = None
        self._cached_key = key
        return self._model

    @property
    def model(self):
        """向后兼容：外部如有引用 embedding_service.model 仍可用。"""
        return self._get_model()

    def _query_instruction(self) -> str:
        """bge 系列要求给**查询**加指令前缀，文档侧不加。

        这是 bge 的训练方式决定的（query 与 passage 走的是非对称编码），
        官方实测能提升几个点的召回。加错边（给文档也加）反而会掉点，
        所以这里只在 embed_query 里用。

        非 bge 的本地模型（text2vec / m3e 等）没有这个约定，返回空串。
        """
        if self.provider != "local":
            return ""
        name = (self.model_name or "").lower()
        if "bge" not in name:
            return ""
        # bge 的中文模型用中文指令，英文模型用英文指令
        if "zh" in name:
            return "为这个句子生成表示以用于检索相关文章："
        return "Represent this sentence for searching relevant passages: "

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        """给入库的分块做向量化（不加查询指令）。"""
        return self.embed(texts)

    def embed_query(self, query: str) -> List[float]:
        """给检索词做向量化（bge 下会加查询指令前缀）。"""
        return self.embed([self._query_instruction() + query])[0]

    def embed(self, texts: List[str]) -> List[List[float]]:
        provider = self.provider
        if provider == "mock":
            dim = PROVIDER_DIMENSIONS["mock"]
            return [[0.0] * dim for _ in texts]
        elif provider == "local":
            model = self._get_model()
            embeddings = model.encode(texts, convert_to_numpy=True)
            return embeddings.tolist()
        elif provider == "basic":
            model = self._get_model()
            vectors = model.transform(texts).toarray()
            return vectors.tolist()
        elif provider == "openai":
            return self._openai_embed(texts)
        else:
            raise ValueError(f"Unknown embedding provider: {provider}")

    def get_dimension(self) -> int:
        """返回当前 provider 的输出维度。

        对 local 模型通过一次占位推理得到真实维度（首次稍慢），
        其余 provider 走静态表。
        """
        provider = self.provider
        if provider == "local":
            # 用短文本探测一次，拿到真实维度
            vec = self.embed(["维度探测"])
            return len(vec[0])
        return PROVIDER_DIMENSIONS.get(provider, 768)

    def _openai_embed(self, texts: List[str]) -> List[List[float]]:
        from openai import OpenAI
        s = get_settings()
        client = OpenAI(api_key=s.openai_api_key)
        # 用配置里的 embedding_model，不再写死 text-embedding-3-small——否则
        # 设置页改 OpenAI 向量模型无效（model_name 取自 settings.embedding_model）。
        response = client.embeddings.create(
            model=self.model_name or "text-embedding-3-small",
            input=texts,
        )
        return [item.embedding for item in response.data]


embedding_service = EmbeddingService()
