"""本地 OCR 引擎（PaddleOCR，离线）。

提供图片文字识别能力（A05，M02 需求中心）。引擎懒加载并缓存，首次调用会
下载检测/识别/方向分类模型，后续调用复用缓存实例。
依赖 paddleocr + paddlepaddle；未安装时 recognize 抛出 RuntimeError，由路由层
转为友好的 "依赖未安装" 响应，保证服务始终可启动（参见 document_ai.py 的懒加载约定）。

Windows 已知问题：paddlepaddle 的 C++ 推理预测器无法打开位于 CJK（中文）用户目录
（如 C:\\Users\\刘爽\\...）下的模型文件，报 "Cannot open file ... inference.pdmodel"。
规避：把模型复制到 ASCII 路径（data_dir 下的 ocr_models/）再加载。
"""
from __future__ import annotations

import logging
import os
import shutil
import tempfile
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

_ocr = None
_ocr_lang: Optional[str] = None


@dataclass
class OcrResult:
    fullText: str
    blocks: list = field(default_factory=list)
    textLines: list = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "fullText": self.fullText,
            "blocks": self.blocks,
            "textLines": self.textLines,
        }


def _is_ascii_path(path: str) -> bool:
    try:
        path.encode("ascii")
        return True
    except UnicodeEncodeError:
        return False


def _resolve_model_dir(sub: str) -> str:
    """返回某类模型（det/rec/cls）的 ASCII 加载目录。

    PaddleOCR 默认把模型缓存在 ~/.paddleocr/whl/<sub>（CJK 用户目录）。
    若该路径非 ASCII，则复制到 settings.data_dir/ocr_models/<sub>（ASCII）下，
    使 paddlepaddle C++ 预测器能够打开。data_dir 由 config.py 控制，部署时可
    指向 ASCII 路径。
    """
    try:
        from app.core.config import settings
    except Exception:  # noqa: BLE001
        return ""
    cache_root = os.path.join(os.path.expanduser("~"), ".paddleocr", "whl", sub)
    if _is_ascii_path(cache_root) and os.path.isdir(cache_root):
        return cache_root
    # 复制到 ASCII 目录：data_dir/ocr_models/<sub>
    ascii_root = os.path.join(settings.data_dir, "ocr_models", sub)
    os.makedirs(os.path.dirname(ascii_root), exist_ok=True)
    if os.path.isdir(ascii_root):
        return ascii_root  # 已复制
    if not os.path.isdir(cache_root):
        return ""  # 模型尚未下载，交给 PaddleOCR 自动下载（可能仍失败于 CJK 路径）
    try:
        shutil.copytree(cache_root, ascii_root)
        logger.info("Copied PaddleOCR %s models to ASCII path: %s", sub, ascii_root)
        return ascii_root
    except Exception:  # noqa: BLE001
        logger.exception("Failed to copy PaddleOCR %s models to ASCII path", sub)
        return ""


def _get_engine(lang: str = "ch"):
    """懒加载并缓存 PaddleOCR 实例。

    - 跨版本构造参数兼容（use_angle_cls → use_textline_orientation）。
    - 显式传入 ASCII 模型目录，规避 paddlepaddle C++ 预测器对 CJK 路径的打开失败。
    """
    global _ocr, _ocr_lang
    if _ocr is not None and _ocr_lang == lang:
        return _ocr
    try:
        from paddleocr import PaddleOCR
    except ImportError:
        raise RuntimeError("paddleocr 未安装")
    logger.info("Initializing PaddleOCR (lang=%s) ...", lang)

    # 先触发模型下载（PaddleOCR 把模型缓存到 ~/.paddleocr/whl/...）。
    # 即便预测器随后因 CJK 路径无法创建，下载步骤通常已成功。
    try:
        for base in ({"use_textline_orientation": True, "lang": lang},
                     {"use_angle_cls": True, "lang": lang},
                     {"lang": lang}):
            try:
                _ = PaddleOCR(**base)
                break
            except TypeError:
                continue
    except Exception:  # noqa: BLE001  下载或预测器失败均忽略，交由下方显式路径重试
        logger.debug("PaddleOCR warm-up init raised (expected on CJK paths)")

    # 显式 ASCII 模型目录（det/rec/cls）：把已下载的模型复制到 ASCII 路径
    det_dir = _resolve_model_dir(os.path.join("det", lang))
    rec_dir = _resolve_model_dir(os.path.join("rec", lang))
    cls_dir = _resolve_model_dir("cls")
    explicit = {
        k: v for k, v in (
            ("det_model_dir", det_dir),
            ("rec_model_dir", rec_dir),
            ("cls_model_dir", cls_dir),
        ) if v
    }

    # 用显式 ASCII 模型目录构造可用实例
    base_options = [
        {"use_textline_orientation": True, "lang": lang},
        {"use_angle_cls": True, "lang": lang},
        {"lang": lang},
    ]
    last_err: Optional[Exception] = None
    for base in base_options:
        kwargs = {**base, **explicit}
        try:
            _ocr = PaddleOCR(**kwargs)
            _ocr_lang = lang
            return _ocr
        except TypeError:
            continue
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            logger.warning("PaddleOCR init attempt failed: %s", exc)
            continue
    raise RuntimeError(
        "PaddleOCR 初始化失败" + (f"：{last_err}" if last_err else "（参数/路径不兼容）")
    )


def _guess_suffix(file_name: str) -> str:
    name = (file_name or "").lower()
    for ext in (".png", ".jpg", ".jpeg", ".bmp", ".webp", ".tif", ".tiff"):
        if name.endswith(ext):
            return ext
    return ".png"


def recognize(content: bytes,
              file_name: str = "image.png",
              lang: str = "ch") -> OcrResult:
    """识别图片字节中的文字。

    content 为图片原始字节（png/jpg/bmp 等）。返回全文 + 每个文本块
    （含置信度与四点框 [[x1,y1],...,[x4,y4]]）。
    """
    suffix = _guess_suffix(file_name)
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=suffix)
    try:
        with os.fdopen(tmp_fd, "wb") as f:
            f.write(content)
        engine = _get_engine(lang)
        # cls=True 启用方向分类，识别带旋转的文字
        result = engine.ocr(tmp_path, cls=True)
        blocks: list = []
        lines: list = []
        # PaddleOCR 返回结构：[[ [box, (text, conf)], ... ]]（外层按输入数量）
        pages = result or []
        for page in pages:
            if not page:
                continue
            for entry in page:
                try:
                    box, txt_conf = entry[0], entry[1]
                except (IndexError, TypeError, ValueError):
                    continue
                text, conf = (txt_conf if isinstance(txt_conf, (list, tuple)) and len(txt_conf) >= 2
                              else (str(txt_conf), 0.0))
                text = (str(text) or "").strip()
                if not text:
                    continue
                blocks.append({
                    "text": text,
                    "confidence": round(float(conf), 3),
                    "box": box,
                })
                lines.append(text)
        return OcrResult(fullText="\n".join(lines), blocks=blocks, textLines=lines)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
