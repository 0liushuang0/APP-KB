"""缺失推断 + 补问草稿生成 + 引擎主流程。

引擎主流程：多源解析 → 大类识别 → 加载模板 → 字段抽取 → 缺失推断 → 整体置信度 → 输出需求卡。
"""
from __future__ import annotations

from app.core.requirement_engine.param_templates import get_template, infer_category, FieldDef
from app.core.requirement_engine.requirement_card import RequirementCard, FieldValue, MissingField
from app.core.requirement_engine.source_parsers import SourceChunk


def detect_missing(fields: list[FieldValue],
                   template: list[FieldDef]) -> list[MissingField]:
    """对照模板找出缺失/低置信的关键字段。"""
    have = {f.key for f in fields if f.confidence >= 0.6}
    missing: list[MissingField] = []

    for fdef in template:
        if fdef.key in have:
            continue
        if fdef.required_for_match or fdef.required_for_quote:
            unit_text = f"（单位：{fdef.unit}）" if fdef.unit else ""
            options_text = ""
            if fdef.options:
                options_text = f"，可选项：{' / '.join(fdef.options)}"
            hint = f"影响选型/报价，需向客户确认{fdef.label}{unit_text}{options_text}"
            sev = "high"
            if fdef.default:
                hint = f"默认 {fdef.label}={fdef.default}{unit_text}，请确认是否一致"
                sev = "medium"
            missing.append(MissingField(fdef.key, fdef.label, sev, hint))
    return missing


def overall_confidence(fields: list[FieldValue],
                       template: list[FieldDef]) -> float:
    """必抽字段的加权平均置信度。"""
    required_keys = {f.key for f in template
                     if f.required_for_match or f.required_for_quote}
    fmap = {f.key: f for f in fields}
    if required_keys:
        scores = [fmap[k].confidence for k in required_keys if k in fmap]
    else:
        scores = [f.confidence for f in fields]
    if not scores:
        return 0.0
    return sum(scores) / len(scores)


async def run_engine(chunks: list[SourceChunk]) -> RequirementCard:
    """需求结构化引擎主流程。"""
    card = RequirementCard()

    all_text = "\n".join(c.raw_text for c in chunks)
    category, cat_conf = infer_category(all_text)
    card.product_category = category
    card.category_confidence = cat_conf

    template = get_template(category) if category else None
    if not template:
        card.notes = (f"无法识别产品大类（置信{cat_conf:.0%}），"
                      "请人工指定大类后重新解析。")
        card.sources = [c.to_dict() for c in chunks]
        return card

    from app.core.requirement_engine.extractor import extract_fields
    fields, llm_used, summary = await extract_fields(chunks, template, category)
    card.fields = fields
    card.llm_used = llm_used
    card.summary = summary

    card.missing = detect_missing(fields, template)
    card.overall_confidence = overall_confidence(fields, template)

    card.sources = [c.to_dict() for c in chunks]
    if not llm_used:
        card.notes = "规则兜底模式（未配置 LLM key），置信度基于来源启发式估计。"
    return card


def gen_followup_draft(card: RequirementCard, customer: str = "客户") -> dict:
    """根据缺失清单 + 已提取字段动态生成补问文案。返回 {wechat, email}。

    改进点：
    - 引用已提取的摘要信息（产品大类、已有规格范围），让客户知道我们知道什么
    - 针对每个缺失字段生成具体的、可操作的问题（而非泛泛的"请确认X"）
    - 区分高优（影响选型/报价）和中优（影响方案细节）
    """
    high = [m for m in card.missing if m.severity == "high"]
    medium = [m for m in card.missing if m.severity == "medium"]

    if not high and not medium:
        return {
            "wechat": f"{customer}您好，需求信息已收集齐全，我们正在为您准备方案，稍后回复。",
            "email": (
                f"{customer}：\n\n您好！\n\n"
                "需求信息已收集完整，我们正在为您准备方案和报价，完成后将尽快回复。\n\n"
                "顺颂商祺！"
            ),
        }

    # ── 构造"已知信息"摘要（让客户知道我们掌握了哪些） ──
    known_lines: list[str] = []
    if card.product_category:
        known_lines.append(f"产品类型：{card.product_category}")
    # 取已提取的必抽字段，展示关键规格
    key_fields = [
        f for f in card.fields
        if f.confidence >= 0.6 and f.value is not None
    ][:6]
    for f in key_fields:
        val = f"{f.value}{f.unit}" if f.unit else str(f.value)
        known_lines.append(f"{f.label}：{val}")
    known_block = ""
    if known_lines:
        known_block = "目前已掌握的信息：\n" + "\n".join(
            f"  ✓ {line}" for line in known_lines
        ) + "\n\n"

    # ── 高优问题：逐条列出，附带 hint 中的具体说明 ──
    def _q_items(items):
        lines = []
        for i, m in enumerate(items):
            # 从 hint 中提取更具体的问题描述
            hint_text = m.hint
            # hint 格式: "影响选型/报价，需向客户确认X" → 提取"X"
            specific = m.label
            if "确认" in hint_text:
                part = hint_text.split("确认")[-1].strip()
                if part:
                    specific = part
            lines.append(f"  {i+1}. {specific}")
        return "\n".join(lines)

    high_block = ""
    if high:
        high_block = (
            f"【关键信息】（以下信息直接影响选型和报价，请务必确认）：\n"
            f"{_q_items(high)}\n\n"
        )

    medium_block = ""
    if medium:
        medium_block = (
            f"【补充信息】（以下信息有助于优化方案细节）：\n"
            f"{_q_items(medium)}\n"
        )

    # ── 微信话术（简洁，适合即时沟通） ──
    wechat_parts = [f"{customer}您好，感谢提供需求资料！"]
    if known_block:
        wechat_parts.append(known_block.rstrip())
    wechat_parts.append(
        "为确保方案和报价准确，还需麻烦您确认以下信息：\n"
    )
    if high_block:
        wechat_parts.append(high_block.rstrip())
    if medium_block:
        wechat_parts.append(medium_block.rstrip())
    wechat_parts.append("如有相关图纸或技术规格书，也可一并发送。感谢配合！")
    wechat = "\n\n".join(wechat_parts)

    # ── 邮件模板（正式，适合邮件沟通） ──
    email = (
        f"{customer}：\n\n"
        f"您好！\n\n"
        f"感谢您提供的需求资料，我们已经进行了初步分析。\n\n"
        f"{known_block}"
        f"为进一步提供准确的方案与报价，烦请协助确认以下信息：\n\n"
        f"{high_block}"
        f"{medium_block}\n"
        f"如有相关图纸、技术规格书或历史采购记录，也可一并提供，"
        f"这将有助于我们为您匹配最优方案。\n\n"
        f"期待您的回复，我们将尽快为您出具方案。\n\n"
        f"顺颂商祺！"
    )

    return {"wechat": wechat, "email": email}
