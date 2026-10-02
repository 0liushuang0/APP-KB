"""需求卡的字段/方法命名边界。

回归背景：RequirementCard 曾同时有 `summary` 字段和 `summary()` 方法。
dataclass 装饰器取默认值时读的是类属性，而方法定义在字段之后，
于是字段默认值被覆盖成函数对象 —— /requirement/structure 端点两条路径都 500：
  · 大类识别失败提前返回 → card.summary 是未绑定函数，调用报缺 self
  · 正常路径 engine 赋了字符串 → 'str' object is not callable
这一层没有测试兜底的话，任何人再加个同名方法就会重演。
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.requirement_engine.requirement_card import (  # noqa: E402
    RequirementCard,
    FieldValue,
)


def test_summary_是数据字段而非方法():
    card = RequirementCard()
    assert isinstance(card.summary, str)
    assert card.summary == ""
    # 诊断摘要必须换个名字，不能再叫 summary
    assert callable(card.summary_line)


def test_默认构造的卡片可以json序列化():
    """to_dict 里混进函数对象时，FastAPI 序列化会在响应阶段才炸，很难查。"""
    card = RequirementCard()
    json.dumps(card.to_dict(), ensure_ascii=False)


def test_引擎赋值后字段与摘要互不干扰():
    card = RequirementCard()
    card.fields = [FieldValue(key="w", label="宽度", value="1400", unit="mm", confidence=0.9)]
    card.summary = "【核心需求】客户需采购定尺剪切线。"

    assert card.summary == "【核心需求】客户需采购定尺剪切线。"
    line = card.summary_line()
    assert "字段: 1个" in line
    json.dumps(card.to_dict(), ensure_ascii=False)


def test_summary_line_反映字段分级():
    card = RequirementCard()
    card.fields = [
        FieldValue(key="a", label="A", value="1", confidence=0.95),
        FieldValue(key="b", label="B", value="2", confidence=0.5),
    ]
    line = card.summary_line()
    assert "字段: 2个" in line
    assert "整体置信" in line
