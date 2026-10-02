"""JSON 解析工具：从 LLM 文本输出中稳健地提取 JSON。"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

logger = logging.getLogger(__name__)

_FENCE_RE = re.compile(r"```(?:json|JSON)?\s*(.*?)```", re.DOTALL)


def extract_json(text: Any, default: Optional[dict] = None) -> Optional[dict]:
    """从可能包含 markdown 代码块或多余文本的字符串中提取 JSON dict。

    解析失败时返回 *default*（默认 None），绝不抛出异常。
    """
    if default is None:
        default = {}
    if not text or not isinstance(text, str):
        return default

    candidate = text.strip()

    # 1) 尝试剥离 ```json ... ``` 代码块
    match = _FENCE_RE.search(candidate)
    if match:
        candidate = match.group(1).strip()

    # 2) 直接解析
    try:
        return json.loads(candidate)
    except (json.JSONDecodeError, TypeError):
        pass

    # 3) 截取首个 { 到末个 } 之间的子串再试
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start != -1 and end != -1 and end > start:
        sub = candidate[start : end + 1]
        try:
            return json.loads(sub)
        except (json.JSONDecodeError, TypeError):
            pass

    logger.warning("Failed to parse JSON from LLM output: %s", candidate[:200])
    return default
