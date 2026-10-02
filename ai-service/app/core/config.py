from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    port: int = 8000
    # 单机产品默认只监听本机。原先是 0.0.0.0，等于把一个能解析任意文件、
    # 手里握着用户 API Key 的服务开放给整个局域网。
    host: str = "127.0.0.1"
    data_dir: str = "./data/ai"
    api_key: str = "dev-api-key"
    max_file_size_mb: int = 10
    max_top_k: int = 50
    max_batch_size: int = 100
    cors_origins: str = "http://localhost:5174"
    embedding_provider: str = "basic"  # mock / basic / local / openai
    embedding_model: str = "BAAI/bge-small-zh-v1.5"
    chunk_size: int = 500
    chunk_overlap: int = 100
    top_k: int = 5

    # ---- 相关度门槛（见 rag.hybrid_search）----
    # 融合分是 min-max 归一化的，**相对**候选集而言 top1 永远接近 1.0，
    # 拿它当阈值等于没有阈值。判断"到底相不相关"只能看原始余弦，
    # bge 的向量已归一化，余弦是绝对量纲、跨查询可比。
    #
    # 下面两个值是在本机真实索引上标定出来的（15 条有答案 + 10 条库里没有的查询）：
    #   有答案：向量 0.531~0.742
    #   没答案：向量 0.361~0.514
    # 取 0.52 落在两组之间。BM25 单独留一条通道，是因为罕见专名的向量分会偏低
    # （实测「Holthausen」向量 0.459 但 BM25 0.791），只看向量会把它误杀。
    min_vector_score: float = 0.52
    min_bm25_score: float = 0.30
    # 同一个业务对象最多贡献几个分块。不限制的话，一份大 PDF 的连续段落
    # （chunk_overlap=100 还让它们彼此重复）会占满整个上下文窗口，
    # 其它对象一条都进不来。
    max_chunks_per_object: int = 2

    # ---- 重排序（见 rag.hybrid_search / reranker.py）----
    # 交叉编码器：把 query 和候选内容一起送进模型算相关度，比双塔向量的
    # 余弦相似度精确得多（向量是各自独立编码后再比，看不到两者的交互）。
    # 代价是每个候选都要跑一次推理，所以只对召回后的少量候选做。
    #
    # 默认关闭：开之前必须在真实数据上量过确实有提升，否则白付 400MB 内存
    # 和每次查询几百毫秒。开启方式见 .env 的 RERANK_ENABLED。
    rerank_enabled: bool = False
    rerank_model: str = "BAAI/bge-reranker-base"
    # 送进重排的候选数。太小则重排没有腾挪空间，太大则延迟线性上升。
    rerank_candidates: int = 20
    
    # LLM Providers
    deepseek_api_key: str = ""
    deepseek_model: str = "deepseek-chat"
    deepseek_base_url: str = "https://api.deepseek.com/v1"
    
    glm_api_key: str = ""
    glm_model: str = "glm-4"
    glm_base_url: str = "https://open.bigmodel.cn/api/paas/v4"

    # ---- GLM 工具调用（GLM-5.2）----
    # 两个能力各用一个模型，互不影响普通 GLM 调用（glm_model）：
    #   · function calling 用 glm-5.2（官方文档确认支持 tools/tool_choice/tool_calls）
    #   · web_search 内置工具官方仅在 glm-4-air 等模型上示例，glm-5.2 未明确，
    #     故联网搜索独立走 glm-4-air，不与 function calling 混用，规避兼容风险。
    glm_tools_enabled: bool = False
    glm_tool_model: str = "glm-5.2"
    glm_web_search_enabled: bool = False
    glm_web_search_model: str = "glm-4-air"
    # search_std(0.01元/次) / search_pro(0.03) / search_pro_sogou(0.05) / search_pro_quark(0.05)
    glm_web_search_engine: str = "search_std"
    glm_web_search_count: int = 5

    openai_api_key: str = ""
    openai_model: str = "gpt-4-turbo"
    openai_base_url: str = "https://api.openai.com/v1"

    # Ollama 本地模型（离线降级）
    ollama_base_url: str = "http://127.0.0.1:11434/v1"
    ollama_model: str = "qwen2.5:14b"
    ollama_api_key: str = "ollama"  # Ollama 不校验 key，但 OpenAI SDK 需要非空值

    # ---- 数据出境策略（见 app/core/egress.py）----
    # cloud：允许调用云端大模型；local_only：只允许回环地址，硬性阻断出网
    egress_mode: str = "cloud"
    # 出境前脱敏（联系方式 + 自定义敏感词）；本地模型不受影响
    egress_sanitize: bool = True
    # 自定义敏感词，逗号分隔，例如客户单位全称、项目代号
    egress_redact_terms: str = ""
    # 出境台账：只记元数据，不记正文
    egress_log_enabled: bool = True

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

@lru_cache()
def get_settings():
    return Settings()

settings = get_settings()
