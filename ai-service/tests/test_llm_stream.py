"""流式对话的重试 / 运行时降级 / 出境审计。

回归背景：非流式 chat() 一直有重试、Ollama 降级和 egress 台账，而 chat_stream
一件都没有。最要命的是审计 —— 这个系统专门做了出境记录（/config 会展示
egress.summary()），偏偏最常用的问答走流式，等于最大一股出境流量在账外。

这里不打真实网络：把 _stream_once 换成可编程替身，只验编排逻辑。
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core import egress  # noqa: E402
from app.core.llm_router import LLMRouter  # noqa: E402


@pytest.fixture
def records(monkeypatch):
    """拦下 egress.record，返回收集到的调用参数列表。"""
    got = []
    monkeypatch.setattr(egress, "record", lambda *a, **k: got.append(a))
    return got


@pytest.fixture
def router():
    def _make(ollama=True, api_key="k"):
        r = LLMRouter()
        r._resolve_provider = lambda module: ("deepseek", {
            "name": "deepseek", "api_key": api_key, "model": "m",
            "base_url": "https://api.deepseek.com/v1",
        })
        r._is_ollama_available = lambda: ollama
        r._get_ollama_config = lambda: {
            "name": "ollama", "api_key": "ollama", "model": "local",
            "base_url": "http://127.0.0.1:11434/v1",
        }
        r._maybe_sanitize = lambda msgs, url: (msgs, {"phone": 1})
        return r
    return _make


async def _collect(gen):
    return [x async for x in gen]


MSGS = [{"role": "user", "content": "你好" * 10}]


@pytest.mark.asyncio
async def test_正常流式要记一条ok台账(router, records):
    r = router()

    async def _ok(cfg, m, **kw):
        for t in ["答", "案"]:
            yield t

    r._stream_once = _ok
    assert await _collect(r.chat_stream(MSGS, module="rag")) == ["答", "案"]

    assert len(records) == 1
    module, provider, base_url, chars, _red, status = records[0][:6]
    assert (module, provider, status) == ("rag", "deepseek", "ok")
    assert chars == 20, "出境字符数要如实统计"


@pytest.mark.asyncio
async def test_云端失败且未吐内容时降级到ollama(router, records):
    r = router()
    tried = []

    async def _fail_then_ok(cfg, m, **kw):
        tried.append(cfg["name"])
        if cfg["name"] == "deepseek":
            raise Exception("connection refused")
            yield  # pragma: no cover
        yield "本地答案"

    r._stream_once = _fail_then_ok
    assert await _collect(r.chat_stream(MSGS, module="rag")) == ["本地答案"]
    assert tried == ["deepseek", "ollama"]
    # 台账要记在真正发出去的那个 provider 上
    assert records[0][1] == "ollama" and records[0][5] == "ok"


@pytest.mark.asyncio
async def test_已吐出内容后失败不重来只记partial(router, records):
    """半截内容已经发给用户了，换 provider 重来只会前后文错乱。"""
    r = router()

    async def _half(cfg, m, **kw):
        yield "前半"
        raise Exception("stream broken")

    r._stream_once = _half
    out = await _collect(r.chat_stream(MSGS, module="rag"))

    assert out[0] == "前半"
    assert "生成中断" in out[-1]
    assert records[0][5] == "partial"


@pytest.mark.asyncio
async def test_全部provider失败记failed(router, records):
    r = router()

    async def _boom(cfg, m, **kw):
        raise Exception("boom")
        yield  # pragma: no cover

    r._stream_once = _boom
    out = await _collect(r.chat_stream(MSGS, module="rag"))

    assert "[错误]" in out[0]
    assert records[0][5] == "failed"


@pytest.mark.asyncio
async def test_没有ollama时不做无谓的第二次尝试(router, records):
    r = router(ollama=False)
    tried = []

    async def _boom(cfg, m, **kw):
        tried.append(cfg["name"])
        raise Exception("boom")
        yield  # pragma: no cover

    r._stream_once = _boom
    await _collect(r.chat_stream(MSGS, module="rag"))
    assert tried == ["deepseek"]


@pytest.mark.asyncio
async def test_未配置key时直接提示且不记台账(router, records):
    r = router(api_key="")
    out = await _collect(r.chat_stream(MSGS, module="rag"))

    assert "未配置" in out[0]
    assert records == [], "没发出去就不该记出境"
