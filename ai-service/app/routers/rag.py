from typing import Dict, List, Optional
import asyncio

from fastapi import APIRouter, Security
from pydantic import BaseModel, Field, field_validator

from app.core.auth import verify_api_key
from app.core.config import settings
from app.core.rag import rag_service

router = APIRouter(dependencies=[Security(verify_api_key)])


class SearchRequest(BaseModel):
    query: str = Field(..., max_length=10_000)
    source_types: Optional[List[str]] = None
    top_k: int = Field(default=5, ge=1, le=settings.max_top_k)


class HybridSearchRequest(BaseModel):
    query: str = Field(..., max_length=10_000)
    source_types: Optional[List[str]] = None
    top_k: int = Field(default=5, ge=1, le=settings.max_top_k)
    # 默认 None —— 交给 rag_service 按查询形态自适应（编号型查询走关键词优先，
    # 自然语言走向量优先）。写死 0.7/0.3 会把自适应逻辑架空，
    # 编号查询的准确率明显下降（实测 hit@1 14/16 → 10/16）。
    vector_weight: Optional[float] = Field(default=None, ge=0, le=1)
    bm25_weight: Optional[float] = Field(default=None, ge=0, le=1)
    # 相关度门槛，默认取配置值。想要"宁滥勿缺"的场景（比如相似方案推荐）
    # 可以显式调低；问答场景不要动，宁可答"没找到"也别拿无关资料硬答。
    min_vector_score: Optional[float] = Field(default=None, ge=0, le=1)
    min_bm25_score: Optional[float] = Field(default=None, ge=0, le=1)


class SearchResponse(BaseModel):
    results: List[Dict]


@router.post("/search", response_model=SearchResponse)
async def search(request: SearchRequest):
    # FAISS + numpy 是 CPU 密集型同步调用，直接在 async 端点里跑会卡住事件循环，
    # 让其它请求（含 health check）排队。丢进线程池执行。
    results = await asyncio.to_thread(
        rag_service.search,
        query=request.query,
        source_types=request.source_types,
        top_k=request.top_k,
    )
    return {"results": results}


@router.post("/hybrid-search", response_model=SearchResponse)
async def hybrid_search(request: HybridSearchRequest):
    results = await asyncio.to_thread(
        rag_service.hybrid_search,
        query=request.query,
        source_types=request.source_types,
        top_k=request.top_k,
        vector_weight=request.vector_weight,
        bm25_weight=request.bm25_weight,
        min_vector_score=request.min_vector_score,
        min_bm25_score=request.min_bm25_score,
    )
    return {"results": results}


class ChunkRequest(BaseModel):
    chunks: List[Dict] = Field(..., max_length=settings.max_batch_size)

    @field_validator("chunks")
    @classmethod
    def _validate_chunks(cls, v: List[Dict]) -> List[Dict]:
        if not v:
            raise ValueError("chunks cannot be empty")
        for chunk in v:
            if not isinstance(chunk, dict) or "content" not in chunk:
                raise ValueError("Each chunk must be a dict containing a 'content' key")
            if len(chunk["content"]) > 100_000:
                raise ValueError("Chunk content exceeds maximum length of 100000 characters")
        return v


class DeleteRequest(BaseModel):
    source_type: str = Field(..., max_length=100)
    source_id: str = Field(..., max_length=255)


@router.post("/chunks")
async def add_chunks(request: ChunkRequest):
    # Keep delete -> add ordering deterministic for knowledge updates. Running
    # both as independent background tasks could delete freshly indexed chunks.
    stats = await asyncio.to_thread(rag_service.add_chunks, request.chunks)
    # count 报的是**实际入库**的数量，不是提交的数量。
    # 解析失败的内容会在 add_chunks 里被挡下，报提交数会让调用方以为都进去了。
    return {
        "message": "Chunks indexed",
        "count": stats.get("indexed", 0),
        "submitted": len(request.chunks),
        "skipped": stats.get("skipped", 0),
    }


@router.post("/delete-by-source")
async def delete_by_source(
    request: DeleteRequest,
):
    await asyncio.to_thread(rag_service.delete_by_source, request.source_type, request.source_id)
    return {"message": "Chunks deleted"}


class PurgeRequest(BaseModel):
    source_type: str = Field(..., max_length=64)


@router.post("/purge-source-type")
async def purge_source_type(request: PurgeRequest):
    """清空某一类的全部向量。全量重建的第一步，避免已删对象的向量残留。"""
    deleted = await asyncio.to_thread(rag_service.purge_source_type, request.source_type)
    return {"message": "Purged", "deleted": deleted}


@router.get("/stats")
async def stats():
    """索引健康度：各 source_type 的分块数 / 对象数。"""
    return await asyncio.to_thread(rag_service.stats)
