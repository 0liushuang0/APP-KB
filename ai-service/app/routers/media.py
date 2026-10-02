"""媒体 AI 路由（ASR / OCR）。

POST /ai/media/asr - 语音转写（本地 faster-whisper，A04）
POST /ai/media/ocr - 图片文字识别（本地 PaddleOCR，A05）

两个能力均为 M02 需求中心的专用媒体→文本引擎，同步调用，离线运行。
依赖未安装时返回明确的 "依赖未安装" 错误而非崩溃，保证服务始终可用。
"""
from __future__ import annotations

import base64
import binascii
import logging
import asyncio
from typing import Optional

from fastapi import APIRouter, Security, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import verify_api_key
from app.core.media import asr as asr_engine
from app.core.media import ocr as ocr_engine

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Security(verify_api_key)])


def _decode_data_url(content: str) -> bytes:
    """兼容 data:URL 前缀与裸 base64。"""
    raw = content.split(",", 1)[-1] if content.startswith("data:") else content
    return base64.b64decode(raw, validate=False)


class AsrRequest(BaseModel):
    content: str = Field(..., max_length=100_000_000)  # 音频体积可能较大
    fileName: str = Field(default="audio.wav", max_length=255)
    language: Optional[str] = Field(default=None, max_length=10)  # "zh"/"en"/...，None=自动检测
    model: str = Field(default=asr_engine.DEFAULT_MODEL, max_length=32)


@router.post("/asr")
async def transcribe_audio(request: AsrRequest):
    """解码 base64 音频并转写为文本（A04）。"""
    try:
        data = _decode_data_url(request.content)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="无效的 base64 音频内容")

    try:
        # faster-whisper 推理为秒级同步阻塞，丢进线程池避免卡死事件循环
        result = await asyncio.to_thread(
            asr_engine.transcribe,
            data, request.fileName,
            request.language, request.model,
        )
        return result.to_dict()
    except RuntimeError as e:
        msg = str(e)
        logger.error("ASR failed: %s", msg)
        detail = ("语音转写依赖 faster-whisper 未安装" if "未安装" in msg
                  else f"语音转写失败：{msg}")
        raise HTTPException(status_code=503, detail=detail)
    except Exception:
        logger.exception("ASR transcription failed")
        raise HTTPException(status_code=500, detail="语音转写失败")


class OcrRequest(BaseModel):
    content: str = Field(..., max_length=50_000_000)
    fileName: str = Field(default="image.png", max_length=255)
    lang: str = Field(default="ch", max_length=10)


@router.post("/ocr")
async def recognize_image(request: OcrRequest):
    """解码 base64 图片并识别其中的文字（A05）。"""
    try:
        data = _decode_data_url(request.content)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="无效的 base64 图片内容")

    try:
        # PaddleOCR 推理为同步阻塞，丢进线程池
        result = await asyncio.to_thread(
            ocr_engine.recognize, data, request.fileName, request.lang,
        )
        return result.to_dict()
    except RuntimeError as e:
        msg = str(e)
        logger.error("OCR failed: %s", msg)
        detail = ("图片识别依赖 paddleocr 未安装" if "未安装" in msg
                  else f"图片识别失败：{msg}")
        raise HTTPException(status_code=503, detail=detail)
    except Exception:
        logger.exception("OCR recognition failed")
        raise HTTPException(status_code=500, detail="图片识别失败")
