"""字段抽取：LLM 版（有 key）+ 规则兜底版（无 key）。

LLM 版：把 SourceChunk 喂给 LLM，按参数模板抽取，强制 JSON + evidence。
规则版：用正则 + 别名 + 单位识别，从文本里抠字段。
"""
from __future__ import annotations
import json
import re
from typing import Any

from app.core.llm_router import llm_router
from app.core.requirement_engine.param_templates import FieldDef
from app.core.requirement_engine.requirement_card import FieldValue
from app.core.requirement_engine.source_parsers import SourceChunk


def _is_llm_available(module: str = "requirement") -> bool:
    """检查 LLM 是否可用（有 key）。"""
    config = llm_router.get_config(module)
    api_key = config.get("api_key") or ""
    return bool(api_key.strip())


async def extract_with_llm(chunks: list[SourceChunk],
                           template: list[FieldDef],
                           category: str) -> tuple[list[FieldValue], str]:
    """用 LLM 按模板抽取字段，同时生成需求摘要。返回 (字段列表, 摘要文本)。

    优先走 GLM-5.2 function calling（结构化输出，比强制 JSON 文本可靠）；
    未开启工具调用或模型未调工具时，降级到原"强制 JSON + 正则兜底"路径。
    """
    # 只带非空属性：需求模板动辄六七十个字段，空键会把提示词撑长一倍
    field_defs = [
        {k: v for k, v in {
            "key": f.key, "label": f.label, "type": f.type,
            "unit": f.unit, "options": f.options, "aliases": f.aliases,
            "group": f.group, "hint": f.hint,
            "required": (f.required_for_match or f.required_for_quote) or None,
        }.items() if v}
        for f in template
    ]
    source_blob = "\n\n".join(
        f"[{c.source_id}] ({c.source_type}) {c.file_name}:\n{c.raw_text}"
        for c in chunks
    )

    summary_rule = (
        "5) summary 为 300 字以内的中文需求摘要，必须用换行符 \\n 分段，格式如下：\n"
        "   【核心需求】一句话概括客户需要什么设备、用途、数量\n"
        "   【技术要求】关键规格参数（宽度/厚度/速度/精度等），用顿号分隔\n"
        "   【商务要求】交期、预算、付款方式等（如无则省略此段）\n"
        "   【客户背景】已有设备/产线情况（如无则省略此段）\n"
        "   每段独占一行，段间空一行。"
    )

    # ① 优先：function calling 结构化输出（GLM-5.2）
    tool_schema = {
        "type": "function",
        "function": {
            "name": "submit_extraction",
            "description": "提交从客户资料中按参数模板抽取的需求字段与摘要。必须调用此工具提交结果。",
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {"type": "string", "description": "300字内中文需求摘要，按【核心需求】【技术要求】【商务要求】【客户背景】分段"},
                    "fields": {
                        "type": "array",
                        "description": "抽取到的字段列表（找不到的不放）",
                        "items": {
                            "type": "object",
                            "properties": {
                                "key": {"type": "string", "description": "模板字段 key"},
                                "value": {"type": "string", "description": "原文字面值（含单位）"},
                                "unit": {"type": "string", "description": "模板指定单位"},
                                "normalized": {"type": "number", "description": "归一化到模板单位后的数值"},
                                "confidence": {"type": "number", "description": "置信度 0-1"},
                                "evidence": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "source_id": {"type": "string"},
                                            "span": {"type": "string", "description": "原文片段"},
                                        },
                                    },
                                    "description": "出处",
                                },
                            },
                            "required": ["key", "value", "confidence"],
                        },
                    },
                },
                "required": ["summary", "fields"],
            },
        },
    }

    system_fc = (
        "你是工业装备售前技术工程师。从客户资料中按参数模板抽取需求字段，并生成需求摘要。\n"
        "铁律：\n"
        "1) 只依据资料原文抽取，每个值必须给 evidence（source_id + 原文片段 span）。\n"
        "2) 数值归一化到模板指定单位（吨/mm/MPa 等），填入 normalized。\n"
        "3) enum 字段必须命中 options，否则不要输出该字段。\n"
        "4) 不确定的字段 confidence < 0.6，找不到的字段不要输出。"
        "字段的 hint 是填写说明（如「按最小~最大填写」「可多选」），按说明的格式给 value；"
        "英文资料照样抽取，value 保留原文数值与单位。\n"
        f"{summary_rule}\n"
        "6) 必须调用 submit_extraction 工具提交结果，不要输出普通文本。"
    )
    user_msg = (
        f"产品大类: {category}\n"
        f"参数模板: {json.dumps(field_defs, ensure_ascii=False)}\n\n"
        f"客户资料:\n{source_blob}"
    )
    fc_messages = [
        {"role": "system", "content": system_fc},
        {"role": "user", "content": user_msg},
    ]

    parsed = await llm_router.chat_structured(
        messages=fc_messages,
        tool_schema=tool_schema,
        module="requirement",
        temperature=0.1,
    )
    if parsed is not None:
        return _build_extraction_result(parsed, template)

    # ② 降级：强制 JSON + 正则兜底（DeepSeek/未开启工具调用时）
    system = system_fc.replace(
        "6) 必须调用 submit_extraction 工具提交结果，不要输出普通文本。",
        "6) 严格输出 JSON。",
    )
    user = (
        f"产品大类: {category}\n"
        f"参数模板: {json.dumps(field_defs, ensure_ascii=False)}\n\n"
        f"客户资料:\n{source_blob}\n\n"
        '输出 JSON 格式:\n'
        '{"summary":"【核心需求】\\n客户需采购1台定尺剪切线(CTL)，用于汽车车身板坯料生产。\\n\\n【技术要求】\\n带钢宽度800-2000mm、厚度0.4-3.2mm、板材长度500-4000mm、最大卷重30吨、材料强度250-1400MPa。\\n\\n【客户背景】\\n客户在Hazira工厂已配备冷轧机、张力矫直机、镀锌线等设备。","fields":[{"key":"nominal_force","value":"120","unit":"吨",'
        '"normalized":120,"confidence":0.92,"evidence":[{"source_id":"src_email",'
        '"span":"公称力120吨"}]}]}'
    )
    raw = await llm_router.chat(
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        module="requirement",
        temperature=0.1,
        response_format={"type": "json_object"},
    )
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", raw, re.S)
        if not m:
            raise RuntimeError(f"LLM 返回非 JSON: {raw[:200]}")
        parsed = json.loads(m.group(0))
    return _build_extraction_result(parsed, template)


def _build_extraction_result(parsed: dict, template: list[FieldDef]) -> tuple[list[FieldValue], str]:
    """把 LLM/function-calling 的结构化结果解析成 (FieldValue 列表, 摘要)。"""
    summary = parsed.get("summary", "")
    label_map = {f.key: f.label for f in template}
    unit_map = {f.key: f.unit for f in template}
    results: list[FieldValue] = []
    for item in parsed.get("fields", []):
        key = item.get("key")
        if key not in label_map:
            continue
        results.append(FieldValue(
            key=key,
            label=label_map[key],
            value=item.get("value"),
            unit=unit_map.get(key),
            normalized=item.get("normalized"),
            confidence=float(item.get("confidence", 0.5)),
            evidence=item.get("evidence", []),
            source="ai",
        ))
    return results, summary


_NUM = r"(\d+(?:\.\d+)?)"


def _find_numbers(text: str, aliases: list[str]) -> list[tuple[str, float]]:
    hits = []
    for alias in aliases:
        pattern = rf"{re.escape(alias)}[^0-9]{{0,6}}{_NUM}"
        for m in re.finditer(pattern, text):
            hits.append((m.group(0), float(m.group(1))))
    return hits


def _find_enum(text: str, options: list[str]) -> list[tuple[str, str]]:
    hits = []
    for opt in options:
        if opt in text:
            hits.append((opt, opt))
    return hits


def extract_with_rules(chunks: list[SourceChunk],
                       template: list[FieldDef]) -> list[FieldValue]:
    """规则版抽取。置信度：CAD 来源 0.85，其他 0.7。"""
    by_source = []
    for c in chunks:
        by_source.append((c.source_id, c.source_type, c.raw_text))

    results: list[FieldValue] = []
    for fdef in template:
        aliases = [fdef.label, *(fdef.aliases or [])]
        found_value: Any = None
        found_normalized: Any = None
        found_span: str | None = None
        found_sid: str | None = None
        conf_base = 0.0

        for sid, stype, text in by_source:
            src_conf = 0.85 if stype == "cad" else 0.7
            if fdef.type == "number":
                hits = _find_numbers(text, aliases)
                if hits:
                    span, num = hits[0]
                    if fdef.validation:
                        if num < fdef.validation.get("min", -1e9) or \
                           num > fdef.validation.get("max", 1e9):
                            continue
                    if src_conf > conf_base:
                        found_value = num
                        found_normalized = num
                        found_span = span
                        found_sid = sid
                        conf_base = src_conf
            elif fdef.type == "enum" and fdef.options:
                hits = _find_enum(text, fdef.options)
                if hits:
                    if src_conf > conf_base:
                        found_value = hits[0][0]
                        found_normalized = hits[0][0]
                        found_span = hits[0][0]
                        found_sid = sid
                        conf_base = src_conf
            elif fdef.type in ("string", "text"):
                for alias in aliases:
                    pattern = (rf"{re.escape(alias)}[:：\s]{{0,3}}"
                               rf"([^\n,，;；。]{{1,40}})")
                    m = re.search(pattern, text)
                    if m and src_conf > conf_base:
                        val = m.group(1).strip()
                        val = re.sub(rf"^{re.escape(alias)}[:：\s]*", "", val).strip()
                        if val:
                            found_value = val
                            found_normalized = val
                            found_span = m.group(0)
                            found_sid = sid
                            conf_base = src_conf

        if found_value is not None and conf_base > 0:
            results.append(FieldValue(
                key=fdef.key,
                label=fdef.label,
                value=found_value,
                unit=fdef.unit,
                normalized=found_normalized,
                confidence=conf_base,
                evidence=[{"source_id": found_sid, "span": found_span}],
                source="cad" if found_sid and "cad" in found_sid else "ai",
            ))
    return results


async def extract_fields(chunks: list[SourceChunk],
                         template: list[FieldDef],
                         category: str) -> tuple[list[FieldValue], bool, str]:
    """抽取字段。返回 (字段列表, 是否用了LLM, 需求摘要)。

    有 key 走 LLM（同时输出 summary）；LLM 失败/无 key 自动降级规则版（summary 为空）。
    """
    if _is_llm_available("requirement"):
        try:
            fields, summary = await extract_with_llm(chunks, template, category)
            return fields, True, summary
        except Exception:
            pass
    return extract_with_rules(chunks, template), False, ""
