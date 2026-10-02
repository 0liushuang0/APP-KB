"""本地 ASR 引擎（faster-whisper，离线）。

提供音频转写能力（A04，M02 需求中心）。模型懒加载并缓存，首次调用会
下载/加载模型（耗时数秒~数十秒），后续调用复用缓存实例。
依赖 faster_whisper；未安装时 transcribe 抛出 RuntimeError，由路由层
转为友好的 "依赖未安装" 响应，保证服务始终可启动（参见 document_ai.py 的懒加载约定）。
"""
from __future__ import annotations

import logging
import os
import tempfile
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

# 模型缓存：避免每次请求重新加载（加载耗时数秒~数十秒）
_model = None
_model_key: Optional[str] = None

# 默认模型：base（~145MB）。中文场景可由调用方传 small/medium 提升精度。
DEFAULT_MODEL = "base"


@dataclass
class AsrResult:
    text: str
    language: Optional[str]
    language_probability: float
    duration: float
    segments: list = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "text": self.text,
            "language": self.language,
            "languageProbability": self.language_probability,
            "duration": round(self.duration, 2),
            "segments": self.segments,
        }


def _get_model(model_name: str = DEFAULT_MODEL,
               device: str = "cpu",
               compute_type: str = "int8"):
    """懒加载并缓存 faster-whisper 模型。device/compute_type 变更会重建实例。"""
    global _model, _model_key
    cache_key = f"{model_name}|{device}|{compute_type}"
    if _model is not None and _model_key == cache_key:
        return _model
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        raise RuntimeError("faster_whisper 未安装")
    logger.info("Loading faster-whisper model '%s' (%s/%s) ...", model_name, device, compute_type)
    _model = WhisperModel(model_name, device=device, compute_type=compute_type)
    _model_key = cache_key
    return _model


def _guess_suffix(file_name: str) -> str:
    name = (file_name or "").lower()
    for ext in (".wav", ".mp3", ".m4a", ".flac", ".ogg", ".webm"):
        if name.endswith(ext):
            return ext
    return ".wav"


def transcribe(content: bytes,
               file_name: str = "audio.wav",
               language: Optional[str] = None,
               model_name: str = DEFAULT_MODEL) -> AsrResult:
    """转写音频字节。

    content 为音频原始字节（wav/mp3/m4a 等）。走临时文件路径，由
    faster-whisper 经 PyAV/ffmpeg 解码，兼容多格式。
    language 指定可提升精度（如 "zh"/"en"），None 则自动检测。
    """
    suffix = _guess_suffix(file_name)
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=suffix)
    try:
        with os.fdopen(tmp_fd, "wb") as f:
            f.write(content)
        model = _get_model(model_name)
        # vad_filter=False：避免触发 onnxruntime（VAD 依赖），它与 paddlepaddle 2.6.x
        # 要求的 protobuf<=3.20.2 冲突。ctranslate2 本身不依赖 protobuf，关闭 VAD 后
        # ASR 仅走 ctranslate2 推理路径，可与 OCR 共存于同一进程。
        segments_gen, info = model.transcribe(
            tmp_path, language=language, vad_filter=False,
        )
        segments: list = []
        text_parts: list = []
        for seg in segments_gen:
            t = (seg.text or "").strip()
            segments.append({
                "start": round(float(seg.start), 2),
                "end": round(float(seg.end), 2),
                "text": t,
            })
            if t:
                text_parts.append(t)
        return AsrResult(
            text=" ".join(text_parts).strip(),
            language=getattr(info, "language", None),
            language_probability=round(float(getattr(info, "language_probability", 0.0)), 3),
            duration=round(float(getattr(info, "duration", 0.0)), 2),
            segments=segments,
        )
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
