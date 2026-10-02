"""
数据出境边界。

产品前提：**文件不出内网，数据可以出端**。
文件这一半已经成立 —— parser.py 用 python-docx / pypdf / openpyxl 在本机解析，
原始文件从不上传；上云的只有抽取出来的文本。

这个模块管的是另一半：文本出去之前，最后一道关。

它做三件事：
  1. 拦截 —— 本地模式下禁止任何非回环地址的请求，硬性阻断
  2. 脱敏 —— 出去的文本里去掉联系方式和用户指定的敏感词（如客户单位全称）
  3. 留痕 —— 记录每一次出境：什么模块、发往哪个厂商、多少字符、脱敏了几处

第 3 点尤其重要。用户把商业数据交给一个装在自己电脑上的程序，
"我们不会上传你的文件"是一句无法验证的承诺；出境台账能让他自己核对。
"""

from __future__ import annotations

import json
import re
import threading
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from app.core.config import get_settings

# 出境台账写入是并发的（多个请求同时打 LLM），加锁避免半行
_log_lock = threading.Lock()

# 单个台账文件的上限，超了就轮转，避免长期使用后撑爆磁盘
MAX_LOG_BYTES = 5 * 1024 * 1024

_LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0"}


class EgressBlocked(Exception):
    """本地模式下试图出网 —— 是策略拒绝，不是故障"""


# 固定脱敏规则：这些字段对回答质量没有贡献，出去了纯属泄漏
_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("手机号", re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")),
    ("固话", re.compile(r"(?<!\d)0\d{2,3}-?\d{7,8}(?!\d)")),
    ("邮箱", re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")),
    ("身份证", re.compile(r"(?<!\d)\d{17}[\dXx](?!\d)")),
    ("银行账号", re.compile(r"(?<!\d)\d{16,19}(?!\d)")),
]


def _redaction_terms() -> list[str]:
    raw = get_settings().egress_redact_terms or ""
    # 长词优先，否则「博亚精工」会被「博亚」先吃掉半截
    terms = [t.strip() for t in re.split(r"[,，\n]", raw) if t.strip()]
    return sorted(terms, key=len, reverse=True)


def sanitize_text(text: str) -> tuple[str, dict[str, int]]:
    """按规则脱敏，返回处理后的文本和各类命中次数"""
    if not text:
        return text, {}

    hits: dict[str, int] = {}

    for label, pattern in _PATTERNS:
        text, count = pattern.subn(f"[{label}已隐去]", text)
        if count:
            hits[label] = hits.get(label, 0) + count

    # 用户自定义敏感词（客户单位全称、项目代号等）
    for idx, term in enumerate(_redaction_terms(), start=1):
        if term and term in text:
            count = text.count(term)
            text = text.replace(term, f"[敏感词{idx}]")
            hits["自定义"] = hits.get("自定义", 0) + count

    return text, hits


def sanitize_messages(messages: list[dict]) -> tuple[list[dict], dict[str, int]]:
    """
    对话消息脱敏。

    只处理 content，role 不动。system 提示词是我们自己写的，
    但历史消息里可能夹带用户粘贴进来的原文，一律过一遍。
    """
    total: dict[str, int] = {}
    out = []
    for msg in messages:
        content = msg.get("content", "")
        if isinstance(content, str):
            content, hits = sanitize_text(content)
            for k, v in hits.items():
                total[k] = total.get(k, 0) + v
        out.append({**msg, "content": content})
    return out, total


def is_loopback(url: str) -> bool:
    """base_url 是否指向本机（本地部署的模型）"""
    try:
        host = urlparse(url).hostname or ""
    except ValueError:
        return False
    return host in _LOOPBACK_HOSTS


def assert_allowed(base_url: str, module: str, provider: str = "") -> None:
    """
    本地模式下阻断出网。

    用户在做涉密项目时可以整体切到本地模式：此时只有指向 127.0.0.1 的
    本地模型能用，任何云端厂商地址直接拒绝，而不是"尽量不发"。
    边界要么是硬的，要么不算边界。

    拦下来的同时要记一笔台账。审计要回答的问题是"这台机器试图往外发过什么"，
    只记发成功的，那么一次次撞在本地模式墙上的尝试在台账里完全看不见 ——
    而恰恰是这些尝试最能说明"某个功能正在偷偷够云端"。
    llm_router 里 5 个调用点全都 catch 了 EgressBlocked 然后静默降级，
    所以这笔账只能记在这里：放在抛异常之前，一处收口覆盖全部路径。

    chars 记 0 是如实的 —— 拦在发送之前，确实一个字都没出去。
    """
    settings = get_settings()
    if settings.egress_mode == "local_only" and not is_loopback(base_url):
        reason = (
            f"当前为本地模式，已阻止向 {urlparse(base_url).hostname} 发送数据"
            f"（模块：{module}）。如需使用云端大模型，请在「AI 配置」中切换。"
        )
        record(
            module,
            provider or (urlparse(base_url).hostname or "unknown"),
            base_url,
            0,
            {},
            "blocked",
            reason,
        )
        raise EgressBlocked(reason)


def _log_path() -> Path:
    directory = Path(get_settings().data_dir)
    directory.mkdir(parents=True, exist_ok=True)
    return directory / "egress.log"


def record(
    module: str,
    provider: str,
    base_url: str,
    chars: int,
    redactions: dict[str, int],
    status: str,
    error: str | None = None,
) -> None:
    """
    记一笔出境台账。

    只记元数据 —— 模块、厂商、字符数、脱敏计数。
    **不记正文**：台账本身若含业务原文，就成了第二份泄漏源。
    """
    settings = get_settings()
    if not settings.egress_log_enabled:
        return

    entry = {
        "at": datetime.now().isoformat(timespec="seconds"),
        "module": module,
        "provider": provider,
        "host": urlparse(base_url).hostname or "",
        "local": is_loopback(base_url),
        "chars": chars,
        "redactions": redactions,
        "status": status,
    }
    if error:
        # 错误信息可能带回厂商返回的原始请求片段，截断
        entry["error"] = error[:200]

    try:
        path = _log_path()
        with _log_lock:
            if path.exists() and path.stat().st_size > MAX_LOG_BYTES:
                path.replace(path.with_suffix(".log.1"))
            with path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError:
        # 台账写不进去不能连带把业务请求搞失败
        pass


def read_log(limit: int = 200) -> list[dict[str, Any]]:
    """读取最近的出境记录，新的在前"""
    path = _log_path()
    if not path.exists():
        return []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []

    out = []
    for line in reversed(lines[-limit * 2 :]):
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
        if len(out) >= limit:
            break
    return out


def summary() -> dict[str, Any]:
    """出境概览：让用户一眼看到"这台机器往外发过什么" """
    entries = read_log(limit=1000)
    cloud = [e for e in entries if not e.get("local")]
    by_host: dict[str, int] = {}
    for e in cloud:
        host = e.get("host") or "未知"
        by_host[host] = by_host.get(host, 0) + 1

    settings = get_settings()
    return {
        "mode": settings.egress_mode,
        "sanitize": settings.egress_sanitize,
        "logEnabled": settings.egress_log_enabled,
        "redactTermCount": len(_redaction_terms()),
        "totalCalls": len(entries),
        "cloudCalls": len(cloud),
        "localCalls": len(entries) - len(cloud),
        "totalChars": sum(e.get("chars", 0) for e in cloud),
        "byHost": by_host,
        "lastAt": entries[0]["at"] if entries else None,
    }
