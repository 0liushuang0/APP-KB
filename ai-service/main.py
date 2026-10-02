import logging

import uvicorn
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.routers import (
    embedding, health, llm, rag, translate,
    customer_match, requirement, matching, solution_match,
    customer, document_ai, dxf_parser, media, config,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="AI Knowledge Base - AI Service",
    description="文档解析、Embedding、RAG、LLM、翻译、客户匹配 路由服务",
    version="0.1.0",
)

cors_origins = (
    [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]
    if settings.cors_origins != "*"
    else ["*"]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors()},
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception")
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


@app.on_event("startup")
async def warmup_embedding_model() -> None:
    """后台预热 embedding 模型。

    本地模型（sentence-transformers）是懒加载的：进程起来后不碰它，
    直到第一次检索才去加载权重。实测重启后第一次查询要 22 秒，之后只要 32ms ——
    也就是说重启后第一个用户必然被罚站一次，而这跟他问了什么毫无关系。

    放后台线程里做，不阻塞 uvicorn 启动，也不影响健康检查先返回 ok。
    """
    import threading
    import time

    from app.core.embeddings import embedding_service

    from app.core.reranker import reranker

    def _load() -> None:
        try:
            started = time.time()
            embedding_service.embed_query("预热")
            logger.info(
                "Embedding 模型预热完成（%s / %s），耗时 %.1fs",
                embedding_service.provider,
                embedding_service.model_name,
                time.time() - started,
            )
        except Exception:
            # 预热失败不该拖垮服务：真正需要时会再次尝试加载，并把错误暴露给调用方
            logger.warning("Embedding 模型预热失败，将在首次调用时重试", exc_info=True)

        # 重排序模型同理：没开启就什么也不做，开了就顺带一起预热，
        # 免得第一个用户同时承担两个模型的加载时间。
        if reranker.enabled:
            try:
                started = time.time()
                reranker.warmup()
                logger.info("重排序模型预热完成，耗时 %.1fs", time.time() - started)
            except Exception:
                logger.warning("重排序模型预热失败", exc_info=True)

    threading.Thread(target=_load, daemon=True, name="embedding-warmup").start()


app.include_router(health.router, prefix="/health", tags=["健康检查"])
app.include_router(embedding.router, prefix="/embeddings", tags=["Embedding"])
app.include_router(rag.router, prefix="/rag", tags=["RAG"])
app.include_router(llm.router, prefix="/llm", tags=["LLM"])
app.include_router(translate.router, prefix="/translate", tags=["翻译"])
app.include_router(customer_match.router, prefix="/customers", tags=["客户匹配"])
app.include_router(requirement.router, prefix="/requirement", tags=["需求结构化"])
app.include_router(matching.router, prefix="/matching", tags=["智能匹配"])
app.include_router(solution_match.router, prefix="/ai/solutions", tags=["方案匹配"])
app.include_router(customer.router, prefix="/ai/customer", tags=["客户画像"])
app.include_router(document_ai.router, prefix="/ai/documents", tags=["文档AI"])
app.include_router(dxf_parser.router, prefix="/ai/requirements", tags=["DXF解析"])
app.include_router(media.router, prefix="/ai/media", tags=["OCR/ASR"])
app.include_router(config.router, prefix="/config", tags=["配置管理"])


if __name__ == "__main__":
    uvicorn.run("main:app", host=settings.host, port=settings.port, reload=False)
