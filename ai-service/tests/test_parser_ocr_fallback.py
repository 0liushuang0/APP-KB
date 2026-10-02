"""扫描件 PDF 的 OCR 回退契约。

回归背景：_pdf_ocr_fallback 曾 `from app.core.media.ocr import get_ocr`，
但 ocr 模块从来没有 get_ocr（引擎获取是私有的 _get_engine）；且把**临时文件路径**
传给了只接受 **bytes** 的 recognize()。两个缺陷叠加的结果是：ImportError 先被
`except ImportError` 吞掉，日志写成"缺少依赖"，让人以为是没装 paddleocr ——
整条扫描件回退实际上从未跑通过，且伪装成环境问题。
"""
import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core import parser  # noqa: E402
from app.core.media import ocr as ocr_mod  # noqa: E402


class _FakeResult:
    def __init__(self, text):
        self.fullText = text


class _FakePix:
    def tobytes(self, fmt):
        return b"\x89PNG-fake-" + fmt.encode()


class _FakePage:
    def get_pixmap(self, dpi=200):
        return _FakePix()


class _FakeDoc:
    def __init__(self, pages=2):
        self._pages = [_FakePage() for _ in range(pages)]
        self.closed = False

    def __iter__(self):
        return iter(self._pages)

    def close(self):
        self.closed = True


@pytest.fixture
def fake_fitz(monkeypatch):
    """PyMuPDF 是可选依赖（见 requirements.txt 尾部），本机不一定装，用替身。"""
    opened = []

    def _open(stream=None, filetype=None):
        d = _FakeDoc()
        opened.append(d)
        return d

    monkeypatch.setitem(sys.modules, "fitz", types.SimpleNamespace(open=_open))
    return opened


def test_ocr_模块没有_get_ocr_只有_recognize():
    """parser 只能依赖公开的 recognize；引擎获取是私有的。"""
    assert not hasattr(ocr_mod, "get_ocr")
    assert hasattr(ocr_mod, "recognize")


def test_每页传给recognize的是字节而非路径(monkeypatch, fake_fitz):
    captured = []

    def _recognize(content, file_name="image.png", lang="ch"):
        captured.append((type(content), file_name))
        return _FakeResult(f"文本-{file_name}")

    monkeypatch.setattr(ocr_mod, "recognize", _recognize)

    out = parser._pdf_ocr_fallback(b"%PDF-fake")

    assert captured, "recognize 没有被调用"
    for kind, _name in captured:
        assert kind is bytes, f"应传 bytes，实得 {kind}"
    assert "文本-page_0.png" in out and "文本-page_1.png" in out


def test_单页失败不影响其余页(monkeypatch, fake_fitz):
    calls = {"n": 0}

    def _flaky(content, file_name="image.png", lang="ch"):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("paddleocr 未安装")
        return _FakeResult("第二页OK")

    monkeypatch.setattr(ocr_mod, "recognize", _flaky)

    assert parser._pdf_ocr_fallback(b"%PDF-fake") == "第二页OK"


def test_文档句柄一定会被关闭(monkeypatch, fake_fitz):
    monkeypatch.setattr(
        ocr_mod, "recognize",
        lambda content, file_name="image.png", lang="ch": _FakeResult("x"),
    )
    parser._pdf_ocr_fallback(b"%PDF-fake")
    assert fake_fitz[-1].closed, "doc.close() 必须在 finally 里调用"


def test_缺少可选依赖时安静降级(monkeypatch):
    """PyMuPDF 没装时返回空串，不抛异常 —— 解析主流程不该被可选能力拖垮。"""
    monkeypatch.setitem(sys.modules, "fitz", None)
    monkeypatch.delitem(sys.modules, "fitz")

    real_import = __builtins__["__import__"] if isinstance(__builtins__, dict) else __builtins__.__import__

    def _no_fitz(name, *a, **kw):
        if name == "fitz":
            raise ImportError("No module named 'fitz'")
        return real_import(name, *a, **kw)

    monkeypatch.setattr("builtins.__import__", _no_fitz)
    assert parser._pdf_ocr_fallback(b"%PDF-fake") == ""
