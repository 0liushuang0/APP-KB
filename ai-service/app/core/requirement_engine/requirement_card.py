"""需求卡数据结构 + 置信度判定。

对应 docs/03_需求结构化引擎_深挖.md 的需求卡 schema。
"""
from __future__ import annotations
from dataclasses import dataclass, field, asdict
from typing import Any


@dataclass
class FieldValue:
    """一个抽取出的字段值。"""
    key: str
    label: str
    value: Any
    unit: str | None = None
    normalized: Any = None
    confidence: float = 0.0
    evidence: list[dict] = field(default_factory=list)
    source: str = "ai"

    @property
    def level(self) -> str:
        if self.confidence >= 0.85:
            return "green"
        if self.confidence >= 0.6:
            return "yellow"
        return "red"


@dataclass
class MissingField:
    field: str
    label: str
    severity: str
    hint: str


@dataclass
class RequirementCard:
    """结构化需求卡。"""
    product_category: str | None = None
    category_confidence: float = 0.0
    fields: list[FieldValue] = field(default_factory=list)
    missing: list[MissingField] = field(default_factory=list)
    overall_confidence: float = 0.0
    sources: list[dict] = field(default_factory=list)
    notes: str = ""
    llm_used: bool = False
    summary: str = ""

    def field_map(self) -> dict[str, FieldValue]:
        return {f.key: f for f in self.fields}

    def to_dict(self) -> dict:
        d = asdict(self)
        d["fields"] = [{**asdict(f), "level": f.level} for f in self.fields]
        return d

    def summary_line(self) -> str:
        """一行诊断摘要（给日志/排查看）。

        注意别改回 summary()：上面已有同名的 summary 字段（存 LLM 产出的需求摘要）。
        dataclass 装饰器取默认值时读的是类属性，方法定义在字段之后会把字段默认值
        覆盖成函数对象 —— 结果是 card.summary 要么是未绑定函数、要么被 engine
        赋成字符串，两种情况调用 card.summary() 都直接抛 TypeError。
        """
        green = sum(1 for f in self.fields if f.level == "green")
        yellow = sum(1 for f in self.fields if f.level == "yellow")
        red = sum(1 for f in self.fields if f.level == "red")
        high_missing = sum(1 for m in self.missing if m.severity == "high")
        mode = "LLM" if self.llm_used else "规则兜底"
        return (f"[{mode}] 大类={self.product_category}({self.category_confidence:.0%}) "
                f"字段: {len(self.fields)}个(绿{green}/黄{yellow}/红{red}) "
                f"缺失: {len(self.missing)}个(高优{high_missing}) "
                f"整体置信={self.overall_confidence:.0%}")
