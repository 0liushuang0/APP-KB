"""翻译 API 路由。

POST /ai/translate - 文本翻译
POST /ai/translate/document - 文档翻译
POST /ai/translate/batch - 批量翻译
"""

from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter, Security, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import verify_api_key
from app.core.translation import translation_service

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Security(verify_api_key)])


class TranslateRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=50000, description="待翻译文本")
    target_lang: str = Field(default="en", max_length=10, description="目标语言代码")
    source_lang: Optional[str] = Field(default=None, max_length=10, description="源语言代码（可选，自动检测）")
    context: Optional[str] = Field(default=None, max_length=500, description="上下文信息")
    style: str = Field(default="professional", max_length=20, description="翻译风格：professional/casual/technical")


class DocumentTranslateRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=100000, description="文档内容")
    target_lang: str = Field(default="en", max_length=10, description="目标语言代码")
    source_lang: Optional[str] = Field(default=None, max_length=10, description="源语言代码")
    document_type: str = Field(default="general", max_length=20, description="文档类型：general/technical/legal/marketing")


class BatchTranslateRequest(BaseModel):
    texts: List[str] = Field(..., min_length=1, max_length=100, description="待翻译文本列表")
    target_lang: str = Field(default="en", max_length=10, description="目标语言代码")
    source_lang: Optional[str] = Field(default=None, max_length=10, description="源语言代码")


@router.post("/")
async def translate_text(request: TranslateRequest):
    """翻译文本，返回翻译结果和双语对照"""
    try:
        result = await translation_service.translate(
            text=request.text,
            target_lang=request.target_lang,
            source_lang=request.source_lang,
            context=request.context,
            style=request.style,
        )
        return result.to_dict()
    except Exception as e:
        logger.error(f"Translation failed: {e}")
        raise HTTPException(status_code=500, detail=f"翻译失败：{str(e)}")


@router.post("/document")
async def translate_document(request: DocumentTranslateRequest):
    """翻译整个文档"""
    try:
        result = await translation_service.translate_document(
            content=request.content,
            target_lang=request.target_lang,
            source_lang=request.source_lang,
            document_type=request.document_type,
        )
        return result.to_dict()
    except Exception as e:
        logger.error(f"Document translation failed: {e}")
        raise HTTPException(status_code=500, detail=f"文档翻译失败：{str(e)}")


@router.post("/batch")
async def batch_translate(request: BatchTranslateRequest):
    """批量翻译文本"""
    try:
        results = await translation_service.batch_translate(
            texts=request.texts,
            target_lang=request.target_lang,
            source_lang=request.source_lang,
        )
        return {
            "results": [r.to_dict() for r in results],
            "total": len(results),
        }
    except Exception as e:
        logger.error(f"Batch translation failed: {e}")
        raise HTTPException(status_code=500, detail=f"批量翻译失败：{str(e)}")
