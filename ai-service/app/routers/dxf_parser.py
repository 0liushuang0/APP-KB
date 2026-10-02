"""需求解析路由（DXF 文件）。

POST /ai/requirements/parse-dxf - 解析 DXF 文件，提取文本/标题栏/标注/结构化参数

实现委托给 app.core.requirement_engine.dxf_extractor（ezdxf 提取器，A03）。
返回兼容旧契约（text/titleBlock/annotations）并额外提供结构化字段。
"""
from __future__ import annotations

import base64
import binascii
import logging
import asyncio

from fastapi import APIRouter, Security, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import verify_api_key
from app.core.requirement_engine.dxf_extractor import extract_dxf

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Security(verify_api_key)])


class ParseDxfRequest(BaseModel):
    content: str = Field(..., max_length=50_000_000)
    fileName: str = Field(default="upload.dxf", max_length=255)


@router.post("/parse-dxf")
async def parse_dxf(request: ParseDxfRequest):
    """解码 base64 DXF 并提取标题栏/标注/尺寸/结构化参数。"""
    try:
        raw = request.content.split(",", 1)[-1] if request.content.startswith(
            "data:"
        ) else request.content
        data = base64.b64decode(raw, validate=False)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="无效的 base64 内容")

    try:
        import ezdxf  # noqa: F401  依赖存在性检查
    except ImportError:
        logger.error("ezdxf is not installed")
        raise HTTPException(status_code=503, detail="DXF 解析依赖 ezdxf 未安装")

    # ezdxf 解析为同步 CPU 密集，丢进线程池
    result = await asyncio.to_thread(extract_dxf, data, request.fileName)
    if result is None:
        raise HTTPException(status_code=422, detail="无法解析 DXF 文件，文件可能已损坏")

    out = result.to_dict()
    # 兼容旧字段：titleBlock / annotations / text 保持原有类型（list[str] / str）
    out.setdefault("text", "")
    out.setdefault("titleBlock", [])
    out.setdefault("annotations", [])
    return out
