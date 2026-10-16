"""需求模板驱动识别（第二轮差距清单 P1-7）。

原来识别引擎只认代码里写死的 6 个大类，「需求模板」页维护的 58 个模板对识别毫无作用，
联轴器 / 辊系等零部件需求根本识别不出参数。现在：
  · 需求已选产品类型 → 按该类型的模板字段抽取、按模板必填项列缺失；
  · 没选 → 在全部模板里按资料判定类型（中英文写法都认），判定结果回给后端自动填上。
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.requirement_engine import extractor  # noqa: E402
from app.core.requirement_engine.engine import run_engine  # noqa: E402
from app.core.requirement_engine.param_templates import (  # noqa: E402
    TEMPLATES,
    fielddefs_from_template,
    infer_category_among,
)
from app.core.requirement_engine.source_parsers import make_chunk  # noqa: E402

COUPLING = {
    "category": "零部件/联轴器/常规联轴器",
    "fields": [
        {"key": "application_industry", "label": "应用行业", "unit": "", "type": "text",
         "section": "A. 需求信息", "required": True, "remark": "应用行业描述"},
        {"key": "requirement_type", "label": "需求类别", "unit": "", "type": "select",
         "section": "A. 需求信息", "required": True, "options": ["设计配套", "国产化", "改造替代", "试用"]},
        {"key": "rated_torque", "label": "额定扭矩", "unit": "kNm", "type": "number",
         "section": "B. 技术参数", "required": True},
        {"key": "max_speed", "label": "最高转速", "unit": "rpm", "type": "number",
         "section": "B. 技术参数", "required": False},
        {"key": "shaft_dia", "label": "轴孔直径", "unit": "mm", "type": "range",
         "section": "B. 技术参数", "required": True, "remark": "主动端/从动端"},
        {"key": "quantity", "label": "数量", "unit": "套", "type": "number",
         "section": "C. 商务", "required": True},
    ],
}

ALL_CATEGORIES = [
    "零部件/联轴器/常规联轴器", "零部件/联轴器/特殊联轴器", "零部件/联轴器/球头联轴器",
    "新产品/轧机联轴器", "零部件/辊系/常规多辊辊系", "零部件/辊系/拉弯矫辊系",
    "装备/矫直设备/常规拉弯矫", "装备/矫直设备/常规多辊矫", "装备/矫直设备/中厚板多辊矫",
    "装备/剪切设备/圆盘剪", "装备/剪切设备/圆盘剪+碎边剪", "装备/剪切设备/碎边剪",
    "装备/开收卷设备/常规开卷机", "生产线/拉矫线", "生产线/分切线",
]


def _rules_only(monkeypatch):
    """测试不依赖大模型：强制走规则兜底。"""
    monkeypatch.setattr(extractor, "_is_llm_available", lambda module="requirement": False)


def test_燃油输送装置不再是内置模板():
    assert "燃油输送装置" not in TEMPLATES


def test_模板字段转换_类型分组必填说明():
    defs = {d.key: d for d in fielddefs_from_template(COUPLING["fields"])}
    assert defs["requirement_type"].type == "enum"
    assert defs["requirement_type"].options == ["设计配套", "国产化", "改造替代", "试用"]
    assert defs["rated_torque"].type == "number" and defs["rated_torque"].unit == "kNm"
    assert defs["shaft_dia"].type == "string" and "最小~最大" in defs["shaft_dia"].hint
    assert defs["rated_torque"].group == "B. 技术参数"
    assert defs["rated_torque"].required_for_match is True
    assert defs["max_speed"].required_for_match is False


def test_模板字段转换_丢弃无效与重复字段():
    defs = fielddefs_from_template([
        {"key": "", "label": "空键"},
        {"key": "a", "label": "A", "type": "select", "options": []},
        {"key": "a", "label": "A 重复"},
    ])
    assert [d.key for d in defs] == ["a"]
    assert defs[0].type == "string"  # 没选项的 select 退化为文本


def test_类型判定_联轴器优先常规():
    cat, conf, why = infer_category_among("鼓形齿联轴器，用于冷轧机主传动，额定扭矩 50kNm", ALL_CATEGORIES)
    assert cat == "零部件/联轴器/常规联轴器"
    assert 0.5 <= conf < 0.95  # 常规/特殊靠「联轴器」区分不开，置信度应被压低
    assert "常规联轴器" in why or "联轴器" in why


def test_类型判定_明确写了球头():
    cat, _, _ = infer_category_among("需要一套球头联轴器替代进口件", ALL_CATEGORIES)
    assert cat == "零部件/联轴器/球头联轴器"


def test_类型判定_组合类型要两项都出现():
    assert infer_category_among("圆盘剪与碎边剪各一台，带钢宽度 1500", ALL_CATEGORIES)[0] == "装备/剪切设备/圆盘剪+碎边剪"
    assert infer_category_among("只要一台圆盘剪，刀轴直径 220", ALL_CATEGORIES)[0] == "装备/剪切设备/圆盘剪"


def test_类型判定_拉弯矫与英文资料():
    assert infer_category_among("拉弯矫直机组，延伸率 0.5%", ALL_CATEGORIES)[0] == "装备/矫直设备/常规拉弯矫"
    assert infer_category_among("Quotation request for a Tension Leveller, strip width 1650 mm", ALL_CATEGORIES)[0] \
        == "装备/矫直设备/常规拉弯矫"
    assert infer_category_among("Uncoiler for 30t coils", ALL_CATEGORIES)[0] == "装备/开收卷设备/常规开卷机"


def test_类型判定_无关资料返回空():
    assert infer_category_among("请提供贵司营业执照复印件", ALL_CATEGORIES) == (None, 0.0, "")


def test_已选产品类型_按模板抽取并列出缺失(monkeypatch):
    _rules_only(monkeypatch)
    text = "应用行业：冷轧\n额定扭矩 63 kNm，最高转速 1200 rpm\n需求类别 国产化"
    card = asyncio.run(run_engine([make_chunk("s1", "text", "邮件", text)], template=COUPLING))

    assert card.template_source == "user"
    assert card.product_category == "零部件/联轴器/常规联轴器"
    got = {f.key: f for f in card.fields}
    assert got["rated_torque"].value == 63
    assert got["requirement_type"].value == "国产化"
    assert got["rated_torque"].group == "B. 技术参数"
    assert got["rated_torque"].required_for_match is True
    missing = {m.field for m in card.missing}
    assert {"shaft_dia", "quantity"} <= missing
    assert "rated_torque" not in missing
    # 填写说明进补问提示
    hint = next(m.hint for m in card.missing if m.field == "shaft_dia")
    assert "主动端/从动端" in hint


def test_未选产品类型_在模板里判定并按该模板识别(monkeypatch):
    _rules_only(monkeypatch)
    other = {"category": "装备/剪切设备/圆盘剪", "fields": [
        {"key": "blade_dia", "label": "刀盘直径", "type": "number", "unit": "mm", "required": True},
    ]}
    text = "客户需要鼓形齿联轴器 2 套，额定扭矩 40 kNm"
    card = asyncio.run(run_engine([make_chunk("s1", "text", "微信", text)], candidates=[other, COUPLING]))
    assert card.template_source == "inferred"
    assert card.template_category == "零部件/联轴器/常规联轴器"
    assert any(f.key == "rated_torque" and f.value == 40 for f in card.fields)


def test_没有模板时退回内置大类(monkeypatch):
    _rules_only(monkeypatch)
    card = asyncio.run(run_engine([make_chunk("s1", "text", "邮件", "拉弯矫直机组，来料材质 SPCC")]))
    assert card.template_source == "builtin"
    assert card.product_category == "矫直设备"
    assert card.template_category is None
