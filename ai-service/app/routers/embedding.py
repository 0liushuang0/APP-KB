import base64
from typing import List
import asyncio

from fastapi import APIRouter, HTTPException, Security
from pydantic import BaseModel, Field, field_validator

from app.core.auth import verify_api_key
from app.core.config import settings
from app.core.embeddings import embedding_service
from app.core.parser import parse_document

router = APIRouter(dependencies=[Security(verify_api_key)])


class EmbedRequest(BaseModel):
    texts: List[str] = Field(..., max_length=settings.max_batch_size)

    @field_validator("texts")
    @classmethod
    def _validate_texts(cls, v: List[str]) -> List[str]:
        if not v:
            raise ValueError("texts cannot be empty")
        for text in v:
            if len(text) > 100_000:
                raise ValueError("Individual text exceeds maximum length of 100000 characters")
        return v


class EmbedResponse(BaseModel):
    embeddings: List[List[float]]
    dimensions: int


@router.post("/", response_model=EmbedResponse)
async def embed_texts(request: EmbedRequest):
    # local provider 会跑神经网络，是 CPU/GPU 密集型同步调用，不能阻塞事件循环
    embeddings = await asyncio.to_thread(embedding_service.embed, request.texts)
    return {
        "embeddings": embeddings,
        "dimensions": len(embeddings[0]) if embeddings else 0,
    }


class ParseRequest(BaseModel):
    filename: str = Field(..., max_length=255)
    content: str = Field(..., min_length=1)

    @field_validator("content")
    @classmethod
    def _validate_content(cls, v: str) -> str:
        try:
            decoded = base64.b64decode(v, validate=True)
        except Exception as exc:
            raise ValueError("content must be valid base64") from exc
        max_bytes = settings.max_file_size_mb * 1024 * 1024
        if len(decoded) > max_bytes:
            raise ValueError(
                f"Decoded file size exceeds maximum of {settings.max_file_size_mb}MB"
            )
        return v


class ParseResponse(BaseModel):
    text: str


# 解析并发上限：PDF/DOCX 解析（含 OCR 回退）是 CPU 密集操作，不限并发时几份
# 大文件同时解析会吃满线程池，拖慢所有共用解析的请求（资料上传、方案导入、
# 知识索引）。超出的请求排队等待而不是拒绝 —— 等几秒可接受，报错不可接受。
_PARSE_SEMAPHORE = asyncio.Semaphore(2)


@router.post("/parse", response_model=ParseResponse)
async def parse_file(request: ParseRequest):
    content_bytes = base64.b64decode(request.content)
    async with _PARSE_SEMAPHORE:
        # PDF/DOCX 解析（含 OCR 回退）耗时且同步，丢进线程池
        try:
            text = await asyncio.to_thread(parse_document, request.filename, content_bytes)
        except ValueError as exc:
            # parse_document 用 ValueError 表达"这个文件解析不了，原因是……"，
            # 比如旧版 .doc、不支持的类型、扫描件。这类是**调用方能据此行动**的信息，
            # 不是服务器故障。不拦住的话会落到全局 handler 变成 500 + "Internal server
            # error"，用户在界面上只看得到"AI 服务暂时不可用"，白白丢掉可操作的提示。
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return {"text": text}
