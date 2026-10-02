"""大模型配置管理路由 —— 读取/更新 ai-service/.env"""

from pathlib import Path

from fastapi import APIRouter, Security
from app.core import egress
from app.core.auth import verify_api_key
from app.core.config import get_settings

router = APIRouter()

ENV_PATH = Path(__file__).resolve().parent.parent.parent / ".env"

LLM_KEYS = [
    "DEEPSEEK_API_KEY",
    "DEEPSEEK_MODEL",
    "DEEPSEEK_BASE_URL",
    "GLM_API_KEY",
    "GLM_MODEL",
    "GLM_BASE_URL",
    "GLM_TOOLS_ENABLED",
    "GLM_TOOL_MODEL",
    "GLM_WEB_SEARCH_ENABLED",
    "GLM_WEB_SEARCH_MODEL",
    "GLM_WEB_SEARCH_ENGINE",
    "GLM_WEB_SEARCH_COUNT",
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "OPENAI_BASE_URL",
    "embedding_provider",
    "embedding_model",
    "top_k",
    "chunk_size",
    "chunk_overlap",
]


def _mask(value: str) -> str:
    """
    脱敏：只显示前 6 位和后 4 位。

    原实现是 `if "API_KEY" not in str(value): return value` —— 判断的是
    **值里**有没有 "API_KEY" 这串字，而不是字段名，于是没有任何 Key 被遮住，
    用户自己付费的 API Key 原样出现在接口响应里。
    """
    if not value:
        return value
    value = str(value)
    if len(value) <= 12:
        return value[:2] + "****"
    return value[:6] + "****" + value[-4:]


def _has_key(value: str) -> bool:
    """前端要区分"没配"和"配了但看不到全文"，光看掩码串分不出来"""
    return bool(value)


@router.get("/")
async def get_config(_: str = Security(verify_api_key)):
    s = get_settings()
    return {
        "deepseek": {
            "apiKey": _mask(s.deepseek_api_key),
            "hasKey": _has_key(s.deepseek_api_key),
            "model": s.deepseek_model,
            "baseUrl": s.deepseek_base_url,
        },
        "glm": {
            "apiKey": _mask(s.glm_api_key),
            "hasKey": _has_key(s.glm_api_key),
            "model": s.glm_model,
            "baseUrl": s.glm_base_url,
            # GLM 工具调用（GLM-5.2）。function calling 与 web_search 各用一个模型。
            "toolsEnabled": s.glm_tools_enabled,
            "toolModel": s.glm_tool_model,
            "webSearchEnabled": s.glm_web_search_enabled,
            "webSearchModel": s.glm_web_search_model,
            "webSearchEngine": s.glm_web_search_engine,
            "webSearchCount": s.glm_web_search_count,
        },
        "openai": {
            "apiKey": _mask(s.openai_api_key),
            "hasKey": _has_key(s.openai_api_key),
            "model": s.openai_model,
            "baseUrl": s.openai_base_url,
        },
        "embedding": {
            "provider": s.embedding_provider,
            "model": s.embedding_model,
        },
        "rag": {
            "topK": s.top_k,
            "chunkSize": s.chunk_size,
            "chunkOverlap": s.chunk_overlap,
        },
        "egress": {
            "mode": s.egress_mode,
            "sanitize": s.egress_sanitize,
            "redactTerms": s.egress_redact_terms,
            "logEnabled": s.egress_log_enabled,
        },
    }


@router.put("/")
async def update_config(body: dict, _: str = Security(verify_api_key)):
    """更新 .env 文件并热重载配置"""
    updates = {}

    mapping = {
        "deepseek_api_key": body.get("deepseek", {}).get("apiKey"),
        "deepseek_model": body.get("deepseek", {}).get("model"),
        "deepseek_base_url": body.get("deepseek", {}).get("baseUrl"),
        "glm_api_key": body.get("glm", {}).get("apiKey"),
        "glm_model": body.get("glm", {}).get("model"),
        "glm_base_url": body.get("glm", {}).get("baseUrl"),
        "glm_tool_model": body.get("glm", {}).get("toolModel"),
        "glm_web_search_model": body.get("glm", {}).get("webSearchModel"),
        "glm_web_search_engine": body.get("glm", {}).get("webSearchEngine"),
        "glm_web_search_count": body.get("glm", {}).get("webSearchCount"),
        "openai_api_key": body.get("openai", {}).get("apiKey"),
        "openai_model": body.get("openai", {}).get("model"),
        "openai_base_url": body.get("openai", {}).get("baseUrl"),
        "embedding_provider": body.get("embedding", {}).get("provider"),
        "embedding_model": body.get("embedding", {}).get("model"),
        "top_k": body.get("rag", {}).get("topK"),
        "chunk_size": body.get("rag", {}).get("chunkSize"),
        "chunk_overlap": body.get("rag", {}).get("chunkOverlap"),
        "egress_mode": body.get("egress", {}).get("mode"),
        "egress_redact_terms": body.get("egress", {}).get("redactTerms"),
    }

    for env_key, value in mapping.items():
        if value is None or str(value).strip() == "":
            continue
        value = str(value).strip()
        # GET 返回的是掩码串，用户只改了模型名就保存时会把掩码原样送回来。
        # 不拦住的话，真 Key 会被 "sk-123****abcd" 覆盖掉，且无法恢复。
        if env_key.endswith("_api_key") and "****" in value:
            continue
        updates[env_key.upper()] = value

    # 布尔项单独处理：False 是有效值，不能被上面的"空则跳过"吃掉
    egress = body.get("egress", {})
    for key, field in (("egress_sanitize", "sanitize"), ("egress_log_enabled", "logEnabled")):
        if field in egress and egress[field] is not None:
            updates[key.upper()] = "true" if egress[field] else "false"

    # GLM 工具调用两个开关也是布尔项，同样不能被"空则跳过"吃掉
    glm_body = body.get("glm", {})
    for key, field in (
        ("glm_tools_enabled", "toolsEnabled"),
        ("glm_web_search_enabled", "webSearchEnabled"),
    ):
        if field in glm_body and glm_body[field] is not None:
            updates[key.upper()] = "true" if glm_body[field] else "false"

    # 换 embedding 会让新算出的向量与库里已有的维度对不上。
    # rag 那边写入和检索都有维度校验会拦下来（见 rag.add_chunks / search），
    # 不至于静默写坏，但报错要等到用户下次问答或上传时才出现 —— 那会儿他多半
    # 已经忘了刚改过配置。所以在保存这一刻就把话说清楚。
    before = get_settings()
    prev_embedding = (before.embedding_provider, before.embedding_model)

    _write_env(updates)

    get_settings.cache_clear()

    after = get_settings()
    embedding_changed = (after.embedding_provider, after.embedding_model) != prev_embedding

    # 记录改了哪些项，但绝不回显 Key 本身
    result = {"status": "ok", "updated": list(updates.keys())}
    if embedding_changed:
        # 旧维度向量已与新 embedding 不兼容：留着会让 search 报维度不一致 / 静默返空。
        # 这里直接清空向量库并重建（空）索引，文档原文在后端 documents 表不丢，
        # 用户随后从「知识资料」页重建索引即用新 embedding 重新生成向量。
        try:
            from app.core.rag import rag_service
            purged = rag_service.purge_all()
            result["reindexRequired"] = True
            result["purgedVectors"] = purged
            result["warning"] = (
                f"Embedding 已从 {prev_embedding[0]}/{prev_embedding[1]} 换成 "
                f"{after.embedding_provider}/{after.embedding_model}，"
                f"已自动清空 {purged} 条旧维度向量。请到「知识资料」页重建索引以恢复检索。"
            )
        except Exception as exc:
            result["reindexRequired"] = True
            result["warning"] = (
                f"Embedding 已更换，但自动清空旧向量失败（{exc}）。"
                "请手动到「知识资料」页重建索引，否则检索会报维度不一致。"
            )
    return result


@router.get("/egress")
async def get_egress(limit: int = 100, _: str = Security(verify_api_key)):
    """
    数据出境台账。

    "文件不出内网"是产品承诺，用户需要能自己核对而不是只能相信。
    这里返回概览和明细，明细只有元数据（模块、厂商、字符数、脱敏计数），不含正文。
    """
    return {
        "summary": egress.summary(),
        "entries": egress.read_log(limit=min(max(limit, 1), 500)),
    }


def _write_env(updates: dict):
    """读取现有 .env，合并更新，写回"""
    lines = []
    existing = {}

    if ENV_PATH.exists():
        raw = ENV_PATH.read_text(encoding="utf-8")
        for line in raw.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                lines.append(line)
                continue
            if "=" in stripped:
                key = stripped.split("=", 1)[0].strip()
                existing[key] = True
                if key.upper() in {k.upper() for k in updates}:
                    new_key = next(k for k in updates if k.upper() == key.upper())
                    lines.append(f"{key}={updates[new_key]}")
                else:
                    lines.append(line)
            else:
                lines.append(line)

    for key, value in updates.items():
        if key not in existing:
            lines.append(f"{key}={value}")

    ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
