"""
数据出境边界的测试。

这一层的失败是静默的 —— 脱敏漏了一条正则、本地模式没拦住，
表面上功能一切正常，只有对方服务器那边多了一份不该有的数据。
所以规则逐条钉死。
"""

import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core import egress  # noqa: E402
from app.core.config import get_settings  # noqa: E402


@pytest.fixture(autouse=True)
def clean_settings(tmp_path, monkeypatch):
    """每个用例独立的配置与台账目录，避免相互串味"""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("EGRESS_MODE", "cloud")
    monkeypatch.setenv("EGRESS_SANITIZE", "true")
    monkeypatch.setenv("EGRESS_REDACT_TERMS", "")
    monkeypatch.setenv("EGRESS_LOG_ENABLED", "true")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


class TestSanitize:
    @pytest.mark.parametrize(
        "raw,label",
        [
            ("请联系 13812345678", "手机号"),
            ("总机 0710-3456789", "固话"),
            ("发到 sales@boya-precision.com", "邮箱"),
            ("身份证 420682199003156789", "身份证"),
            ("打款到 6222021234567890123", "银行账号"),
        ],
    )
    def test_联系方式被隐去(self, raw, label):
        out, hits = egress.sanitize_text(raw)
        assert label in hits
        assert f"[{label}已隐去]" in out

    def test_设备参数不受影响(self):
        """脱敏不能伤到业务本身 —— 型号、辊数、板厚是回答质量的来源"""
        raw = "矫直机 8 辊，板厚 12mm，屈服强度 345MPa，轧制力 5000kN"
        out, hits = egress.sanitize_text(raw)
        assert out == raw
        assert hits == {}

    def test_价格和交期照常出境(self):
        """产品前提是"数据可以出端"，报价场景要靠这些数字才能给建议"""
        raw = "报价 128 万元，交期 90 天"
        out, _ = egress.sanitize_text(raw)
        assert "128" in out and "90" in out

    def test_自定义敏感词(self, monkeypatch):
        monkeypatch.setenv("EGRESS_REDACT_TERMS", "襄阳博亚精工装备股份有限公司,鞍钢冷轧厂")
        get_settings.cache_clear()
        out, hits = egress.sanitize_text("襄阳博亚精工装备股份有限公司 与 鞍钢冷轧厂 签订合同")
        assert "襄阳博亚精工装备股份有限公司" not in out
        assert "鞍钢冷轧厂" not in out
        assert hits["自定义"] == 2

    def test_长词优先替换(self, monkeypatch):
        """短词先匹配会把长词吃掉半截，留下"[敏感词1]装备股份有限公司"这种残句"""
        monkeypatch.setenv("EGRESS_REDACT_TERMS", "博亚,襄阳博亚精工装备股份有限公司")
        get_settings.cache_clear()
        out, _ = egress.sanitize_text("襄阳博亚精工装备股份有限公司")
        assert "装备股份有限公司" not in out

    def test_消息列表逐条处理且保留角色(self):
        messages = [
            {"role": "system", "content": "你是售前专家"},
            {"role": "user", "content": "客户电话 13812345678"},
        ]
        out, hits = egress.sanitize_messages(messages)
        assert [m["role"] for m in out] == ["system", "user"]
        assert "13812345678" not in out[1]["content"]
        assert hits["手机号"] == 1

    def test_空内容不炸(self):
        out, hits = egress.sanitize_messages([{"role": "user", "content": ""}])
        assert out[0]["content"] == ""
        assert hits == {}


class TestBoundary:
    @pytest.mark.parametrize(
        "url,expected",
        [
            ("http://127.0.0.1:11434/v1", True),
            ("http://localhost:8000", True),
            ("https://api.deepseek.com/v1", False),
            ("https://open.bigmodel.cn/api/paas/v4", False),
            ("https://api.openai.com/v1", False),
        ],
    )
    def test_回环判定(self, url, expected):
        assert egress.is_loopback(url) is expected

    def test_云端模式放行(self):
        egress.assert_allowed("https://api.deepseek.com/v1", "proposal")

    def test_本地模式阻断出网(self, monkeypatch):
        monkeypatch.setenv("EGRESS_MODE", "local_only")
        get_settings.cache_clear()
        with pytest.raises(egress.EgressBlocked) as exc:
            egress.assert_allowed("https://api.deepseek.com/v1", "proposal")
        # 报错要说清是策略拒绝而非故障，否则用户会去查网络
        assert "本地模式" in str(exc.value)

    def test_本地模式仍允许本地模型(self, monkeypatch):
        monkeypatch.setenv("EGRESS_MODE", "local_only")
        get_settings.cache_clear()
        egress.assert_allowed("http://127.0.0.1:11434/v1", "proposal")


class TestLedger:
    def test_记录元数据但不记正文(self, tmp_path):
        egress.record(
            "proposal", "deepseek", "https://api.deepseek.com/v1", 1234, {"手机号": 2}, "ok"
        )
        raw = (tmp_path / "egress.log").read_text(encoding="utf-8")
        entry = json.loads(raw.strip())

        assert entry["module"] == "proposal"
        assert entry["host"] == "api.deepseek.com"
        assert entry["local"] is False
        assert entry["chars"] == 1234
        assert entry["redactions"] == {"手机号": 2}
        # 台账里若含业务原文，它自己就成了第二份泄漏源
        assert "content" not in entry and "messages" not in entry

    def test_关闭后不写(self, tmp_path, monkeypatch):
        monkeypatch.setenv("EGRESS_LOG_ENABLED", "false")
        get_settings.cache_clear()
        egress.record("default", "glm", "https://open.bigmodel.cn", 10, {}, "ok")
        assert not (tmp_path / "egress.log").exists()

    def test_错误信息被截断(self, tmp_path):
        egress.record("default", "glm", "https://x.com", 1, {}, "failed", "E" * 900)
        entry = json.loads((tmp_path / "egress.log").read_text(encoding="utf-8").strip())
        assert len(entry["error"]) == 200

    def test_读取时新的在前(self):
        for i in range(3):
            egress.record(f"m{i}", "deepseek", "https://api.deepseek.com", i, {}, "ok")
        entries = egress.read_log()
        assert [e["module"] for e in entries] == ["m2", "m1", "m0"]

    def test_概览区分本地与云端(self):
        egress.record("a", "deepseek", "https://api.deepseek.com", 100, {}, "ok")
        egress.record("b", "local", "http://127.0.0.1:11434", 200, {}, "ok")
        s = egress.summary()
        assert s["totalCalls"] == 2
        assert s["cloudCalls"] == 1
        assert s["localCalls"] == 1
        # 字符数只统计真正出境的部分
        assert s["totalChars"] == 100
        assert s["byHost"] == {"api.deepseek.com": 1}

    def test_台账写不进去不影响业务(self, monkeypatch):
        def boom(*_a, **_kw):
            raise OSError("disk full")

        monkeypatch.setattr(Path, "open", boom)
        egress.record("default", "glm", "https://x.com", 1, {}, "ok")  # 不抛异常即通过


class TestRouterIntegration:
    """出境策略必须由 llm_router 真正执行，光有函数没接上等于没有"""

    @pytest.mark.asyncio
    async def test_本地模式下没有本地模型时硬阻断(self, monkeypatch):
        """没有兜底时必须是明确的拒绝，绝不能"尽力发出去" """
        monkeypatch.setenv("EGRESS_MODE", "local_only")
        monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-test-key")
        monkeypatch.setenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
        # 关掉 Ollama 降级，测的是边界本身
        monkeypatch.setenv("OLLAMA_MODEL", "")
        get_settings.cache_clear()

        from app.core.llm_router import llm_router

        with pytest.raises(egress.EgressBlocked):
            await llm_router.chat([{"role": "user", "content": "hi"}], module="default")

        # 被拦下的尝试同样要留痕
        entries = egress.read_log()
        assert entries and entries[0]["status"] == "blocked"

    @pytest.mark.asyncio
    async def test_本地模式下降级到本地模型而不是发往云端(self, monkeypatch):
        """
        配了 Ollama 时，本地模式转为走本机模型。
        这里要守住的性质不是"报错"，而是**没有任何数据发往云端地址**。
        """
        monkeypatch.setenv("EGRESS_MODE", "local_only")
        monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-test-key")
        monkeypatch.setenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
        monkeypatch.setenv("OLLAMA_MODEL", "qwen2.5:14b")
        monkeypatch.setenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434/v1")
        get_settings.cache_clear()

        from app.core import llm_router as router_mod

        sent: list[str] = []

        async def fake_dispatch(self, base_url, headers, payload, stream):
            sent.append(base_url)
            return "本地模型回答"

        monkeypatch.setattr(router_mod.LLMRouter, "_dispatch", fake_dispatch)

        result = await router_mod.llm_router.chat(
            [{"role": "user", "content": "hi"}], module="default"
        )

        assert result == "本地模型回答"
        assert sent, "应当发出了一次请求"
        for url in sent:
            assert egress.is_loopback(url), f"本地模式下不该请求 {url}"

    def test_模块到厂商的映射(self):
        from app.core.llm_router import llm_router

        assert llm_router.get_config("proposal")["name"] == "glm"
        assert llm_router.get_config("quotation")["name"] == "deepseek"
        # 未知模块回落到 default
        assert llm_router.get_config("不存在的模块")["name"] == "deepseek"

    def test_改完Key立刻生效不需要重启(self, monkeypatch):
        """原实现用 lambda 闭包捕获了旧 Settings，改了 Key 也读不到"""
        from app.core.llm_router import llm_router

        monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-first")
        get_settings.cache_clear()
        assert llm_router.get_config("default")["api_key"] == "sk-first"

        monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-second")
        get_settings.cache_clear()
        assert llm_router.get_config("default")["api_key"] == "sk-second"
