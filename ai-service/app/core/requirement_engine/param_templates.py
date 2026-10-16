"""参数模板：定义各产品大类"该抽哪些字段"。

两套来源，优先级从高到低：
  1. 业务人员在「需求模板」页维护的模板（后端随请求传入，见 fielddefs_from_template）——
     需求已选产品类型就用该类型的模板；没选就在全部模板里按资料内容判定（infer_category_among）；
  2. 下方内置的 5 个设备大类（矫直/剪切/辊涂/开收卷/液压锁紧），只在后端没传模板时兜底。
原内置的「燃油输送装置」不是博亚产品线，已移除。
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Any


@dataclass
class FieldDef:
    key: str
    label: str
    type: str
    unit: str | None = None
    options: list[str] | None = None
    aliases: list[str] | None = None
    required_for_match: bool = False
    required_for_quote: bool = False
    default: Any = None
    validation: dict | None = None
    # 需求模板里的分组（如「来料信息」「设备信息」）与填写说明（如「min~max」「冷轧/拉矫/辊涂线」）
    group: str | None = None
    hint: str | None = None

    def to_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items() if v is not None}


HYDRAULIC_LOCKING = [
    FieldDef("nominal_force", "公称力", "number", unit="吨",
             aliases=["额定力", "锁紧力", "吨位", "锁紧载荷"],
             required_for_match=True, required_for_quote=True,
             validation={"min": 10, "max": 500}),
    FieldDef("stroke", "行程", "number", unit="mm",
             aliases=["工作行程", "位移"],
             required_for_quote=True),
    FieldDef("medium", "工作介质", "enum",
             options=["液压油", "水-乙二醇", "乳化液"],
             aliases=["介质", "液压介质", "液体"],
             required_for_match=True, default="液压油"),
    FieldDef("working_pressure", "工作压力", "number", unit="MPa",
             aliases=["压力", "额定压力", "系统压力"]),
    FieldDef("mounting", "安装方式", "enum",
             options=["法兰", "螺纹", "插装", "其他"],
             aliases=["安装", "连接方式"]),
    FieldDef("explosion_proof", "防爆要求", "enum",
             options=["否", "ExdIIBT4", "ExdIICT4", "其他"],
             aliases=["防爆", "防爆等级", "隔爆"],
             default="否"),
    FieldDef("control", "控制方式", "enum",
             options=["手动", "液控", "电控", "PLC", "智能"],
             aliases=["控制", "控制类型"]),
    FieldDef("quantity", "数量", "number", unit="套",
             aliases=["台数", "数量", "几台", "多少"],
             required_for_quote=True),
    FieldDef("delivery_date", "交期", "string",
             aliases=["交货期", "交货时间", "交付", "到货"]),
    FieldDef("temperature", "工况温度", "string",
             aliases=["温度", "环境温度", "工作温度"]),
]

# ============================================================
# 矫直设备（拉弯矫直 / 辊式矫直 / 连续拉弯矫直机组）
# 基于「01矫直设备需求信息采集表（中英双语）」
# ============================================================
STRAIGHTENING = [
    # ── 一、来料信息 ──
    FieldDef("material_type", "来料材质", "string",
             aliases=["材质", "材料", "钢种", "材料类型", "material"],
             required_for_match=True),
    FieldDef("material_grade", "牌号/种类", "string",
             aliases=["牌号", "种类", "钢号", "grade", "type"]),
    FieldDef("strip_width_min", "来料最小板带宽度", "number", unit="mm",
             aliases=["最小宽度", "宽度下限", "width min", "最小板宽"],
             required_for_match=True,
             validation={"min": 100, "max": 3000}),
    FieldDef("strip_width_max", "来料最大板带宽度", "number", unit="mm",
             aliases=["最大宽度", "宽度上限", "width max", "最大板宽"],
             required_for_match=True,
             validation={"min": 100, "max": 3000}),
    FieldDef("strip_thickness_min", "来料最小板带厚度", "number", unit="mm",
             aliases=["最小厚度", "厚度下限", "thickness min", "最薄"],
             required_for_match=True,
             validation={"min": 0.01, "max": 20}),
    FieldDef("strip_thickness_max", "来料最大板带厚度", "number", unit="mm",
             aliases=["最大厚度", "厚度上限", "thickness max", "最厚"],
             required_for_match=True,
             validation={"min": 0.01, "max": 20}),
    FieldDef("yield_strength_min", "最小屈服强度", "number", unit="MPa",
             aliases=["屈服强度下限", "屈服最小", "yield min", "σs min"]),
    FieldDef("yield_strength_max", "最大屈服强度", "number", unit="MPa",
             aliases=["屈服强度上限", "屈服最大", "yield max", "σs max"]),
    FieldDef("tensile_strength_min", "最小抗拉强度", "number", unit="MPa",
             aliases=["抗拉下限", "抗拉最小", "tensile min", "σb min"]),
    FieldDef("tensile_strength_max", "最大抗拉强度", "number", unit="MPa",
             aliases=["抗拉上限", "抗拉最大", "tensile max", "σb max"]),
    FieldDef("strip_temp_min", "来料最低温度", "number", unit="°C",
             aliases=["温度下限", "最低板温", "temp min"]),
    FieldDef("strip_temp_max", "来料最高温度", "number", unit="°C",
             aliases=["温度上限", "最高板温", "temp max"]),
    FieldDef("surface_condition", "表面状态", "enum",
             options=["镀锌", "镀铝锌", "镀锡", "彩涂", "无"],
             aliases=["表面", "涂层", "coating", "surface"],
             default="无"),
    FieldDef("surface_cleanliness", "表面清洁度", "string",
             aliases=["清洁度", "清洁要求", "cleanliness", "表面清洁", "残油", "残铁"]),
    FieldDef("incoming_strip_quality", "来料带钢质量", "string",
             aliases=["带钢质量", "来料质量", "板材质量", "strip quality", "钢带质量"]),
    FieldDef("coil_condition", "钢卷状况", "enum",
             options=["下端卷(卷眼水平)", "上端卷(卷眼竖直)", "其他"],
             aliases=["卷状", "钢卷方向", "coil", "卷眼"],
             default="下端卷(卷眼水平)"),
    FieldDef("camber", "镰刀弯允许值", "string", unit="mm/m",
             aliases=["镰刀弯", "camber", "弯度"]),
    FieldDef("flatness_incoming", "来料平直度", "string", unit="I值",
             aliases=["来料浪形", "来料平直度", "incoming flatness", "steepness"]),

    # ── 二、设备信息 ──
    FieldDef("requirement_type", "需求类别", "enum",
             options=["新增新建", "改造升级"],
             aliases=["新建", "改造", "new build", "upgrade", "retrofit", "需求类型"],
             required_for_quote=True),
    FieldDef("line_type", "生产线名称/类型", "enum",
             options=["拉弯矫直机组", "连续拉弯矫直机组", "辊式矫直机组", "张力矫直机组", "其他"],
             aliases=["矫直类型", "机组类型", "线类型", "line type", "拉弯矫", "矫直机", "矫直机组"],
             required_for_match=True),
    FieldDef("strip_direction", "钢带运行方向", "enum",
             options=["左→右", "右→左"],
             aliases=["运行方向", "走带方向", "travel direction", "strip direction"]),
    FieldDef("max_line_speed", "最高生产速度", "number", unit="m/min",
             aliases=["最高线速", "最大速度", "线速度", "max speed", "产线速度", "生产速度"],
             required_for_match=True,
             validation={"min": 10, "max": 2000}),
    FieldDef("threading_speed", "穿带速度", "number", unit="m/min",
             aliases=["穿带", "threading", "引带速度"],
             default=20),
    FieldDef("tension_entry_low", "入口张力(低/开卷)", "number", unit="kN",
             aliases=["入口张力", "开卷张力", "entry tension", "入口段张力"]),
    FieldDef("tension_entry_high", "入口张力(高/拉伸段)", "number", unit="kN",
             aliases=["拉伸段入口张力", "入口高张力", "entry tension high"]),
    FieldDef("tension_exit", "出口张力(卷取)", "number", unit="kN",
             aliases=["出口张力", "卷取张力", "exit tension", "出口段张力"]),
    FieldDef("pass_line_height", "轧制线标高", "number", unit="mm",
             aliases=["标高", "线高", "pass line", "中心高"],
             default=1100),
    FieldDef("annual_output", "年产量目标", "number", unit="吨/年",
             aliases=["年产能", "产量", "产能", "annual output", "capacity"]),
    FieldDef("floor_space", "设备空间(长×宽×高)", "string", unit="m",
             aliases=["占地", "空间", "floor space", "外形尺寸", "安装空间"]),

    # ── 三、成品参数 ──
    FieldDef("product_flatness", "成品平直度要求", "string", unit="I值",
             aliases=["成品平直度", "成品浪形", "flatness req", "成品板形", "平直度"],
             required_for_quote=True),
    FieldDef("elongation", "延伸率", "string", unit="%",
             aliases=["伸长率", "延伸", "elongation"],
             required_for_match=True),
    FieldDef("surface_quality_req", "表面质量要求", "string",
             aliases=["表面要求", "表面质量", "surface quality", "擦划伤"],
             default="不产生新擦划伤、皱折"),

    # ── 四、电源及公用工程 ──
    FieldDef("voltage", "供电电压", "string", unit="V",
             aliases=["二次侧电压", "电压", "voltage", "AC380", "低压侧"],
             default="AC 380V"),
    FieldDef("frequency", "电源频率", "number", unit="Hz",
             aliases=["频率", "frequency", "工频"],
             default=50),
    FieldDef("phase_wiring", "相数及接线", "string",
             aliases=["接线", "相数", "phase", "三相"],
             default="三相三线制+PE"),
    FieldDef("grounding", "接地方式", "string",
             aliases=["接地", "grounding", "TN-C-S"],
             default="TN-C-S"),
    FieldDef("compressed_air", "压缩空气压力", "number", unit="MPa",
             aliases=["气压", "压缩空气", "air pressure", "气源"]),
    FieldDef("cooling_water", "冷却水压力/水质", "string", unit="MPa",
             aliases=["冷却水", "水质", "cooling water"]),

    # ── 五、现场环境 ──
    FieldDef("altitude", "海拔高度", "number", unit="m",
             aliases=["海拔", "altitude", "标高(环境)"]),
    FieldDef("ambient_temp_min", "最低环境温度", "number", unit="°C",
             aliases=["环境温度下限", "最低气温", "ambient min"]),
    FieldDef("ambient_temp_max", "最高环境温度", "number", unit="°C",
             aliases=["环境温度上限", "最高气温", "ambient max"]),
    FieldDef("humidity", "相对湿度", "number", unit="%RH",
             aliases=["湿度", "humidity", "RH"]),
    FieldDef("special_env", "其他环境要求", "string",
             aliases=["腐蚀", "粉尘", "防爆", "环境特殊要求"]),

    # ── 六、配套设备及配置 ──
    FieldDef("hydraulic_unit", "液压泵站", "enum",
             options=["客户提供", "卖家提供"],
             aliases=["液压站", "液压泵", "hydraulic", "泵站"],
             default="卖家提供"),
    FieldDef("hydraulic_valve", "液压阀台", "enum",
             options=["客户提供", "卖家提供"],
             aliases=["阀台", "valve stand"],
             default="卖家提供"),
    FieldDef("electrical_control", "电控系统配置", "enum",
             options=["端子箱", "操作箱", "操作台", "电控柜", "不配置"],
             aliases=["电控", "电气控制", "MCC", "控制柜", "操作台", "电气"],
             default="电控柜"),
    FieldDef("tensiometer", "张力计", "enum",
             options=["配置", "不配置"],
             aliases=["张力仪", "tensiometer", "张力检测"],
             default="配置"),
    FieldDef("edge_trim", "边丝处理方式", "enum",
             options=["卷取", "碎断", "不配置"],
             aliases=["边丝", "废边", "trim", "chopper", "winder"],
             default="碎断"),
    FieldDef("automation_level", "自动化等级", "enum",
             options=["全自动", "半自动", "不配置"],
             aliases=["自动化", "自动", "auto", "水平"],
             default="半自动"),
    FieldDef("install_material", "机械安装材料", "enum",
             options=["客户提供", "卖家提供"],
             aliases=["安装材料", "地脚螺栓", "installation"],
             default="卖家提供"),
    FieldDef("commissioning", "调试工作", "enum",
             options=["客户负责", "卖家负责", "客户主导/卖家协助"],
             aliases=["调试", "commissioning", "联调"],
             default="卖家负责"),
    FieldDef("component_brand", "配件品牌", "enum",
             options=["标准配置", "客户推荐"],
             aliases=["品牌", "元器件", "brand", "指定品牌"],
             default="标准配置"),

    # ── 通用 ──
    FieldDef("quantity", "数量", "number", unit="套",
             aliases=["台数", "几条线", "几套", "quantity"],
             required_for_quote=True,
             default=1),
    FieldDef("delivery_location", "交货地点", "string",
             aliases=["交货地", "使用地", "现场", "delivery", "location"],
             required_for_quote=True),
    FieldDef("delivery_date", "交期", "string",
             aliases=["交货期", "交货时间", "交付", "到货时间", "delivery date"]),
    FieldDef("special_req", "其他特殊要求", "text",
             aliases=["特殊要求", "特殊工艺", "special", "其他要求"]),
]

SHEARING = [
    # ── 一、来料信息 ──
    FieldDef("material_type", "来料材质", "string",
             aliases=["材质", "材料", "钢种", "材料类型", "material"],
             required_for_match=True),
    FieldDef("material_grade", "牌号/种类", "string",
             aliases=["牌号", "种类", "钢号", "grade", "type"]),
    FieldDef("strip_width_min", "来料最小板带宽度", "number", unit="mm",
             aliases=["最小宽度", "宽度下限", "width min", "最小板宽"],
             required_for_match=True, validation={"min": 100, "max": 3000}),
    FieldDef("strip_width_max", "来料最大板带宽度", "number", unit="mm",
             aliases=["最大宽度", "宽度上限", "width max", "最大板宽"],
             required_for_match=True, validation={"min": 100, "max": 3000}),
    FieldDef("strip_thickness_min", "来料最小板带厚度", "number", unit="mm",
             aliases=["最小厚度", "厚度下限", "thickness min", "最薄"],
             required_for_match=True, validation={"min": 0.01, "max": 20}),
    FieldDef("strip_thickness_max", "来料最大板带厚度", "number", unit="mm",
             aliases=["最大厚度", "厚度上限", "thickness max", "最厚"],
             required_for_match=True, validation={"min": 0.01, "max": 20}),
    FieldDef("gauge_variation", "厚度误差", "string",
             aliases=["厚度偏差", "厚度公差", "gauge variation"]),
    FieldDef("yield_strength_min", "最小屈服强度", "number", unit="MPa",
             aliases=["屈服强度下限", "屈服最小", "yield min"]),
    FieldDef("yield_strength_max", "最大屈服强度", "number", unit="MPa",
             aliases=["屈服强度上限", "屈服最大", "yield max"]),
    FieldDef("tensile_strength_min", "最小抗拉强度", "number", unit="MPa",
             aliases=["抗拉下限", "抗拉最小", "tensile min"]),
    FieldDef("tensile_strength_max", "最大抗拉强度", "number", unit="MPa",
             aliases=["抗拉上限", "抗拉最大", "tensile max"]),
    FieldDef("strip_temp_min", "来料最低温度", "number", unit="°C",
             aliases=["温度下限", "最低板温", "temp min"]),
    FieldDef("strip_temp_max", "来料最高温度", "number", unit="°C",
             aliases=["温度上限", "最高板温", "temp max"]),
    FieldDef("camber", "镰刀弯允许值", "string", unit="mm/m",
             aliases=["镰刀弯", "camber", "弯度"]),
    FieldDef("surface_cleanliness", "表面清洁度(残油)", "string", unit="mg/m²",
             aliases=["清洁度", "残油", "cleanliness", "表面清洁"]),
    FieldDef("flatness_incoming", "浪形/平直度", "string", unit="I值",
             aliases=["浪形", "平直度", "steepness", "incoming flatness"]),
    FieldDef("surface_condition", "表面状态", "enum",
             options=["镀锌", "镀铝锌", "镀锡", "彩涂", "无"],
             aliases=["表面", "涂层", "coating", "surface"],
             default="无"),
    FieldDef("weld_width_diff", "焊缝前后宽度差", "string", unit="mm",
             aliases=["焊缝宽度差", "焊接宽度差", "weld width"]),
    FieldDef("crescent_notch", "月牙口尺寸", "string", unit="mm",
             aliases=["月牙口", "月牙", "crescent notch"]),
    FieldDef("edge_guide_accuracy", "圆盘剪前纠偏精度", "string", unit="mm",
             aliases=["纠偏精度", "圆盘剪纠偏", "edge guide", "对中精度"]),
    FieldDef("strip_surface_quality", "带钢表面质量", "string",
             aliases=["表面质量", "strip surface quality", "表面缺陷"]),

    # ── 二、设备信息 ──
    FieldDef("requirement_type", "需求类别", "enum",
             options=["新增新建", "改造升级"],
             aliases=["新建", "改造", "new build", "upgrade", "需求类型"],
             required_for_quote=True),
    FieldDef("line_type", "生产线名称/类型", "enum",
             options=["纵剪机组", "横剪机组", "拉弯矫直机组", "重卷机组", "其他"],
             aliases=["产线类型", "机组类型", "线类型", "line type", "剪切线", "剪切机组",
                      "纵剪", "横剪", "切边线", "slitting"],
             required_for_match=True),
    FieldDef("strip_direction", "钢带运行方向", "enum",
             options=["左→右", "右→左"],
             aliases=["运行方向", "走带方向", "travel direction", "strip direction"]),
    FieldDef("threading_speed", "穿带速度", "number", unit="m/min",
             aliases=["穿带", "threading speed", "引带速度"],
             default=20),
    FieldDef("max_line_speed", "剪切段最高生产速度", "number", unit="m/min",
             aliases=["最高线速", "最高速度", "max speed", "max line speed"],
             required_for_match=True, validation={"min": 10, "max": 2000}),
    FieldDef("shear_entry_tension", "剪切段入口张力", "number", unit="kN",
             aliases=["入口张力", "entry tension", "剪切入口张力"]),
    FieldDef("shear_tension", "剪切段张力", "number", unit="kN",
             aliases=["剪切张力", "shear tension", "shearing tension"]),
    FieldDef("pass_line_height", "轧制线标高", "number", unit="mm",
             aliases=["标高", "pass line", "线标高"],
             default=1100),
    FieldDef("floor_space", "设备空间(长x宽x高)", "string", unit="m",
             aliases=["占地面积", "空间", "floor space", "设备尺寸"]),
    FieldDef("annual_output", "年产量目标", "number", unit="吨/年",
             aliases=["年产量", "产能", "annual output", "产量目标"]),

    # ── 三、成品参数 ──
    FieldDef("trim_width_min", "切边宽度(最小)", "number", unit="mm",
             aliases=["切边宽度", "修剪宽度", "trim width min"],
             required_for_match=True),
    FieldDef("trim_width_max", "切边宽度(最大)", "number", unit="mm",
             aliases=["切边宽度上限", "trim width max"],
             required_for_match=True),
    FieldDef("edge_quality", "边部质量", "string",
             aliases=["边缘质量", "边部缺陷", "edge quality"],
             required_for_quote=True),
    FieldDef("shearing_accuracy", "剪切精度", "string",
             aliases=["剪切精度", "shearing accuracy", "裁切精度"],
             required_for_quote=True),
    FieldDef("shearing_burr", "剪切毛刺", "string",
             aliases=["毛刺", "burr", "剪切毛刺"],
             required_for_quote=True),

    # ── 四、电源及公用工程 ──
    FieldDef("voltage", "变压器二次侧低压", "string", unit="V",
             aliases=["供电电压", "供电", "voltage", "二次侧"],
             default="AC 380V"),
    FieldDef("frequency", "电源频率", "number", unit="Hz",
             aliases=["频率", "frequency"],
             default=50),
    FieldDef("phase_wiring", "相数及接线", "string",
             aliases=["相数", "接线", "phase", "wiring"],
             default="三相三线制+PE"),
    FieldDef("grounding", "接地方式", "string",
             aliases=["接地", "grounding"],
             default="TN-C-S"),
    FieldDef("compressed_air", "压缩空气压力", "number", unit="MPa",
             aliases=["压缩空气", "气源", "compressed air"]),
    FieldDef("cooling_water", "冷却水压力/水质", "string", unit="MPa",
             aliases=["冷却水", "cooling water"]),

    # ── 五、现场气候与环境条件 ──
    FieldDef("altitude", "海拔高度", "number", unit="m",
             aliases=["海拔", "altitude"]),
    FieldDef("ambient_temp_min", "最低环境温度", "number", unit="°C",
             aliases=["最低温度", "min temp"]),
    FieldDef("ambient_temp_max", "最高环境温度", "number", unit="°C",
             aliases=["最高温度", "max temp"]),
    FieldDef("rainfall", "年均/最大降水量", "string", unit="mm",
             aliases=["降水量", "降雨", "rainfall"]),
    FieldDef("humidity", "相对湿度", "number", unit="%RH",
             aliases=["湿度", "humidity"]),

    # ── 六、配套设备及配置选项 ──
    FieldDef("knife_box_config", "刀箱配置", "enum",
             options=["单塔式", "双塔式"],
             aliases=["刀箱", "knife box", "刀架"]),
    FieldDef("accessories", "附件配置", "string",
             aliases=["附件", "稳定辊", "去毛刺辊", "accessories"]),
    FieldDef("scrap_handling", "废边处理方式", "enum",
             options=["碎边剪", "在线废边卷", "离线废边卷"],
             aliases=["废边", "边丝处理", "scrap handling", "废边处理"],
             required_for_quote=True),
    FieldDef("hydraulic_unit", "液压泵站", "enum",
             options=["客户提供", "卖家提供"],
             aliases=["液压泵", "hydraulic power", "液压站"],
             default="卖家提供"),
    FieldDef("hydraulic_valve", "液压阀台", "enum",
             options=["客户提供", "卖家提供"],
             aliases=["液压阀", "hydraulic valve"],
             default="卖家提供"),
    FieldDef("pneumatic_unit", "气动泵站", "enum",
             options=["客户提供", "卖家提供"],
             aliases=["气动泵", "pneumatic power"],
             default="卖家提供"),
    FieldDef("pneumatic_valve", "气动阀台", "enum",
             options=["客户提供", "卖家提供"],
             aliases=["气动阀", "pneumatic valve"],
             default="卖家提供"),
    FieldDef("electrical_control", "电控系统", "enum",
             options=["端子箱", "操作箱", "操作台", "电控柜"],
             aliases=["电控", "electrical control"],
             default="电控柜"),
    FieldDef("install_material_mech", "机械安装材料", "enum",
             options=["客户提供", "卖家提供"],
             aliases=["安装材料", "机械安装", "installation material"],
             default="卖家提供"),
    FieldDef("install_material_fluid", "流体安装材料", "enum",
             options=["客户提供", "卖家提供"],
             aliases=["流体安装", "管路安装"],
             default="卖家提供"),
    FieldDef("install_material_elec", "电气安装材料", "enum",
             options=["客户提供", "卖家提供"],
             aliases=["电气安装", "电缆安装"],
             default="卖家提供"),
    FieldDef("civil_foundation", "设备土建基础及施工", "enum",
             options=["客户提供", "卖家提供"],
             aliases=["土建", "基础", "civil foundation"]),
    FieldDef("commissioning", "调试工作内容", "enum",
             options=["客户负责", "卖家负责", "客户主导/卖家协助"],
             aliases=["调试", "commissioning"],
             default="卖家负责"),
    FieldDef("component_brand", "配件品牌", "enum",
             options=["标准配置", "客户推荐"],
             aliases=["品牌", "component brand"],
             default="标准配置"),

    # ── 通用 ──
    FieldDef("quantity", "数量", "number", unit="套",
             default=1, required_for_quote=True),
    FieldDef("delivery_location", "交货地点", "string",
             aliases=["交货", "delivery location", "交货地"],
             required_for_quote=True),
    FieldDef("delivery_date", "交期", "string",
             aliases=["交货期", "delivery date", "交货时间"]),
    FieldDef("special_req", "其他特殊要求", "text",
             aliases=["特殊要求", "special requirement", "备注"]),
]

ROLLER_COATING = [
    # ── 一、来料信息 ──
    FieldDef("material_type", "来料材质", "enum",
             options=["普碳钢系列", "不锈钢系列", "硅钢系列", "高强钢系列", "铝及铝合金", "铜及铜合金"],
             aliases=["材质", "材料", "钢种", "material"],
             required_for_match=True),
    FieldDef("material_category", "来料种类", "string",
             aliases=["种类", "产品种类", "料种", "退火料", "平整料", "冷轧料"]),
    FieldDef("prior_process", "来料前道工艺", "string",
             aliases=["前道工艺", "前工序", "prior process"]),
    FieldDef("strip_width_min", "来料最小板带宽度", "number", unit="mm",
             aliases=["最小宽度", "宽度下限", "width min"],
             required_for_match=True, validation={"min": 100, "max": 3000}),
    FieldDef("strip_width_max", "来料最大板带宽度", "number", unit="mm",
             aliases=["最大宽度", "宽度上限", "width max"],
             required_for_match=True, validation={"min": 100, "max": 3000}),
    FieldDef("strip_thickness_min", "来料最小板带厚度", "number", unit="mm",
             aliases=["最小厚度", "厚度下限", "thickness min"],
             required_for_match=True, validation={"min": 0.01, "max": 20}),
    FieldDef("strip_thickness_max", "来料最大板带厚度", "number", unit="mm",
             aliases=["最大厚度", "厚度上限", "thickness max"],
             required_for_match=True, validation={"min": 0.01, "max": 20}),
    FieldDef("gauge_variation", "板带厚度偏差", "string",
             aliases=["厚度偏差", "厚度公差", "gauge variation"]),
    FieldDef("yield_strength_min", "最小屈服强度", "number", unit="MPa",
             aliases=["屈服强度下限", "屈服最小", "yield min"]),
    FieldDef("yield_strength_max", "最大屈服强度", "number", unit="MPa",
             aliases=["屈服强度上限", "屈服最大", "yield max"]),
    FieldDef("tensile_strength_min", "最小抗拉强度", "number", unit="MPa",
             aliases=["抗拉下限", "抗拉最小", "tensile min"]),
    FieldDef("tensile_strength_max", "最大抗拉强度", "number", unit="MPa",
             aliases=["抗拉上限", "抗拉最大", "tensile max"]),
    FieldDef("strip_temp_min", "来料最低温度", "number", unit="°C",
             aliases=["温度下限", "最低板温", "temp min"]),
    FieldDef("strip_temp_max", "来料最高温度", "number", unit="°C",
             aliases=["温度上限", "最高板温", "temp max"]),
    FieldDef("surface_cleanliness", "表面清洁度(残油)", "string", unit="mg/m²",
             aliases=["清洁度", "残油", "cleanliness"]),
    FieldDef("flatness_incoming", "板带平直度", "string", unit="I值或mm/m",
             aliases=["浪形", "平直度", "steepness", "flatness"]),
    FieldDef("camber", "镰刀弯", "string", unit="mm/2m",
             aliases=["镰刀弯", "camber"]),
    FieldDef("surface_condition", "表面状态", "enum",
             options=["镀锌", "镀铝锌", "镀锡", "彩涂", "无"],
             aliases=["表面", "涂层", "coating", "surface"],
             default="无"),

    # ── 二、成品参数 ──
    FieldDef("coating_thickness_min", "涂层厚度(最小)", "number", unit="μm",
             aliases=["涂层厚度", "膜厚", "coating thickness min"],
             required_for_match=True),
    FieldDef("coating_thickness_max", "涂层厚度(最大)", "number", unit="μm",
             aliases=["涂层厚度上限", "coating thickness max"],
             required_for_match=True),
    FieldDef("coating_uniformity", "涂层厚度均匀性", "string", unit="%",
             aliases=["均匀性", "厚度均匀", "coating uniformity"],
             required_for_quote=True),
    FieldDef("uncoated_weld_length", "焊缝前后不涂层长度", "string", unit="m",
             aliases=["焊缝不涂", "不涂层长度", "uncoated weld"]),
    FieldDef("surface_quality", "表面质量", "string",
             aliases=["成品表面", "表面质量要求", "surface quality"],
             required_for_quote=True),

    # ── 三、生产线信息 ──
    FieldDef("requirement_type", "需求类别", "enum",
             options=["新增新建", "改造升级"],
             aliases=["新建", "改造", "new build", "upgrade"],
             required_for_quote=True),
    FieldDef("line_type", "生产线名称", "enum",
             options=["镀锌", "镀锡", "彩涂", "硅钢", "其他"],
             aliases=["产线", "机组", "line type", "生产线"],
             required_for_match=True),
    FieldDef("strip_direction", "钢带运行方向", "enum",
             options=["左→右", "右→左", "垂直进料"],
             aliases=["运行方向", "走带方向", "strip direction"]),
    FieldDef("threading_speed", "穿带速度", "number", unit="m/min",
             aliases=["穿带", "threading speed"], default=20),
    FieldDef("coating_position", "涂覆位置", "enum",
             options=["正面", "反面", "双面"],
             aliases=["涂覆面", "coating position"]),
    FieldDef("coating_speed", "涂覆段线速度", "number", unit="m/min",
             aliases=["涂覆速度", "涂装速度", "coating speed"],
             required_for_match=True),
    FieldDef("coating_tension", "辊涂段张力", "number", unit="kN",
             aliases=["涂覆张力", "coating tension"]),
    FieldDef("pass_line_height", "工作线标高", "number", unit="mm",
             aliases=["标高", "pass line"], default=1100),
    FieldDef("floor_space", "设备空间(长x宽x高)", "string", unit="m",
             aliases=["占地面积", "空间", "floor space"]),

    # ── 四、电源及公用工程 ──
    FieldDef("voltage", "电源电压", "string", unit="V",
             aliases=["供电", "voltage"], default="AC 380V"),
    FieldDef("frequency", "电源频率", "number", unit="Hz",
             aliases=["频率", "frequency"], default=50),
    FieldDef("phase_wiring", "相数", "string",
             aliases=["相数及接线", "phase"], default="三相三线制+PE"),
    FieldDef("grounding", "接地方式", "string",
             aliases=["接地", "grounding"], default="TN-C-S"),
    FieldDef("compressed_air", "压缩空气压力", "number", unit="MPa",
             aliases=["气源", "compressed air"]),
    FieldDef("cooling_water", "冷却水压力/水质", "string", unit="MPa",
             aliases=["冷却水", "cooling water"]),

    # ── 五、现场气候条件 ──
    FieldDef("altitude", "海拔高度", "number", unit="m", aliases=["海拔", "altitude"]),
    FieldDef("ambient_temp_min", "最低环境温度", "number", unit="°C", aliases=["最低温度"]),
    FieldDef("ambient_temp_max", "最高环境温度", "number", unit="°C", aliases=["最高温度"]),
    FieldDef("rainfall", "年均/最大降水量", "string", unit="mm", aliases=["降水", "rainfall"]),
    FieldDef("humidity", "相对湿度", "number", unit="%RH", aliases=["湿度", "humidity"]),

    # ── 六、配套设备及配置选项 ──
    FieldDef("coating_head_type", "涂头结构", "enum",
             options=["两辊式", "三辊式"],
             aliases=["涂头", "涂覆头", "coating head"]),
    FieldDef("pressure_adjust", "压力调整系统", "enum",
             options=["手动调整", "自动调整"],
             aliases=["压力调整", "辊压调整"]),
    FieldDef("fluid_circulation", "供液循环系统", "enum",
             options=["客户提供", "卖家提供"],
             aliases=["供液", "循环系统", "fluid circulation"]),
    FieldDef("hydraulic_unit", "液压泵站", "enum",
             options=["客户提供", "卖家提供"], default="卖家提供"),
    FieldDef("hydraulic_valve", "液压阀台", "enum",
             options=["客户提供", "卖家提供"], default="卖家提供"),
    FieldDef("air_source", "气源", "enum",
             options=["客户提供", "卖家提供"], default="卖家提供"),
    FieldDef("pneumatic_valve", "气动阀台", "enum",
             options=["客户提供", "卖家提供"], default="卖家提供"),
    FieldDef("electrical_control", "电控系统", "enum",
             options=["客户提供", "卖家提供"], default="卖家提供"),
    FieldDef("install_material_mech", "机械安装材料", "enum",
             options=["客户提供", "卖家提供"], default="卖家提供"),
    FieldDef("install_material_fluid", "流体安装材料", "enum",
             options=["客户提供", "卖家提供"], default="卖家提供"),
    FieldDef("install_material_elec", "电气安装材料", "enum",
             options=["客户提供", "卖家提供"], default="卖家提供"),
    FieldDef("civil_foundation", "设备土建基础", "enum",
             options=["客户负责", "卖家负责"]),
    FieldDef("commissioning", "调试工作内容", "enum",
             options=["客户负责", "卖家负责", "客户主导/卖家协助"], default="卖家负责"),
    FieldDef("component_brand", "配件品牌", "enum",
             options=["标准配置", "客户推荐"], default="标准配置"),

    # ── 通用 ──
    FieldDef("quantity", "数量", "number", unit="套", default=1, required_for_quote=True),
    FieldDef("delivery_location", "交货地点", "string", required_for_quote=True),
    FieldDef("delivery_date", "交期", "string"),
    FieldDef("special_req", "其他特殊要求", "text"),
]

WINDER_UNWINDER = [
    # ── 一、来料信息 ──
    FieldDef("material_type", "来料材质", "enum",
             options=["普碳钢系列", "不锈钢系列", "硅钢系列", "高强钢系列", "铝及铝合金", "铜及铜合金"],
             aliases=["材质", "材料", "钢种", "material"],
             required_for_match=True),
    FieldDef("material_category", "来料种类/状态", "string",
             aliases=["种类", "来料状态", "镀锌板", "冷轧钢板"]),
    FieldDef("prior_process", "来料前道工艺", "string",
             aliases=["前道工艺", "前工序", "prior process"]),
    FieldDef("strip_width_min", "来料最小板带宽度", "number", unit="mm",
             aliases=["最小宽度", "宽度下限", "width min"],
             required_for_match=True, validation={"min": 100, "max": 3000}),
    FieldDef("strip_width_max", "来料最大板带宽度", "number", unit="mm",
             aliases=["最大宽度", "宽度上限", "width max"],
             required_for_match=True, validation={"min": 100, "max": 3000}),
    FieldDef("strip_thickness_min", "来料最小板带厚度", "number", unit="mm",
             aliases=["最小厚度", "厚度下限", "thickness min"],
             required_for_match=True, validation={"min": 0.01, "max": 20}),
    FieldDef("strip_thickness_max", "来料最大板带厚度", "number", unit="mm",
             aliases=["最大厚度", "厚度上限", "thickness max"],
             required_for_match=True, validation={"min": 0.01, "max": 20}),
    FieldDef("gauge_variation", "板带厚度偏差", "string",
             aliases=["厚度偏差", "厚度公差"]),
    FieldDef("yield_strength_min", "最小屈服强度", "number", unit="MPa",
             aliases=["屈服强度下限", "yield min"]),
    FieldDef("yield_strength_max", "最大屈服强度", "number", unit="MPa",
             aliases=["屈服强度上限", "yield max"]),
    FieldDef("tensile_strength_min", "最小抗拉强度", "number", unit="MPa",
             aliases=["抗拉下限", "tensile min"]),
    FieldDef("tensile_strength_max", "最大抗拉强度", "number", unit="MPa",
             aliases=["抗拉上限", "tensile max"]),
    FieldDef("coil_od_min", "钢卷最小外径", "number", unit="mm",
             aliases=["最小外径", "coil OD min"]),
    FieldDef("coil_od_max", "钢卷最大外径", "number", unit="mm",
             aliases=["最大外径", "coil OD max"]),
    FieldDef("coil_weight_min", "钢卷最小重量", "number", unit="吨",
             aliases=["最小卷重", "coil weight min"]),
    FieldDef("coil_weight_max", "钢卷最大重量", "number", unit="吨",
             aliases=["最大卷重", "coil weight max"]),
    FieldDef("strip_temp_min", "来料最低温度", "number", unit="°C",
             aliases=["温度下限", "temp min"]),
    FieldDef("strip_temp_max", "来料最高温度", "number", unit="°C",
             aliases=["温度上限", "temp max"]),
    FieldDef("surface_cleanliness", "表面清洁度(残油)", "string", unit="mg/m²",
             aliases=["清洁度", "残油"]),
    FieldDef("flatness_incoming", "板带平直度", "string", unit="I值或mm/m",
             aliases=["浪形", "平直度"]),
    FieldDef("camber", "镰刀弯", "string", unit="mm/2m",
             aliases=["镰刀弯", "camber"]),
    FieldDef("surface_condition", "表面状态", "enum",
             options=["镀锌", "镀铝锌", "镀锡", "彩涂", "无"],
             default="无"),

    # ── 二、成品参数 ──
    FieldDef("mandrel_diameter", "卷筒直径", "string", unit="mm",
             aliases=["卷筒", "芯轴直径", "mandrel", "钢卷内径", "卷筒名义直径"],
             required_for_match=True),
    FieldDef("mandrel_expansion", "卷筒胀缩范围", "string", unit="mm",
             aliases=["胀缩", "胀径范围", "expansion range"]),
    FieldDef("mandrel_jaw", "卷筒钳口", "string",
             aliases=["钳口", "jaw"]),
    FieldDef("product_coil_od_min", "成品钢卷最小外径", "number", unit="mm",
             aliases=["成品外径下限", "product coil OD min"]),
    FieldDef("product_coil_od_max", "成品钢卷最大外径", "number", unit="mm",
             aliases=["成品外径上限", "product coil OD max"]),
    FieldDef("product_coil_weight_min", "成品钢卷最小重量", "number", unit="吨",
             aliases=["成品卷重下限"]),
    FieldDef("product_coil_weight_max", "成品钢卷最大重量", "number", unit="吨",
             aliases=["成品卷重上限"]),
    FieldDef("telescoping", "错层公差", "string", unit="mm",
             aliases=["错层", "telescoping", "层差"],
             required_for_quote=True),
    FieldDef("tower_tolerance", "塔形公差", "string", unit="mm",
             aliases=["塔形", "tower", "跑偏"],
             required_for_quote=True),
    FieldDef("expansion_method", "扩径方式", "enum",
             options=["钢套筒", "纸套筒", "橡胶套筒", "增径瓦", "无"],
             aliases=["套筒", "扩径", "sleeve", "expansion"]),
    FieldDef("expanded_diameter", "扩径后直径", "string", unit="mm",
             aliases=["扩径直径", "expanded dia"]),
    FieldDef("sleeve_spec", "套筒规格", "string", unit="mm",
             aliases=["套筒尺寸", "sleeve spec"]),
    FieldDef("surface_quality", "表面质量", "string",
             aliases=["成品表面", "表面质量要求"],
             required_for_quote=True),

    # ── 三、生产线信息 ──
    FieldDef("requirement_type", "需求类别", "enum",
             options=["新增新建", "改造升级"],
             required_for_quote=True),
    FieldDef("line_type", "生产线名称", "enum",
             options=["酸洗", "脱脂", "退火", "镀锌", "镀锡", "彩涂", "重卷", "横切", "分条", "其他"],
             aliases=["产线", "机组", "line type", "生产线"],
             required_for_match=True),
    FieldDef("strip_direction", "钢带运行方向", "enum",
             options=["左→右", "右→左"]),
    FieldDef("uncoil_method", "开卷方式", "enum",
             options=["上开卷", "下开卷"],
             aliases=["开卷", "上卷", "uncoil"]),
    FieldDef("recoil_method", "收卷方式", "enum",
             options=["上收卷", "下收卷"],
             aliases=["收卷", "卷取", "recoil"]),
    FieldDef("threading_speed", "穿带速度", "number", unit="m/min",
             default=20),
    FieldDef("uncoil_speed", "开卷段速度", "number", unit="m/min",
             aliases=["开卷速度", "uncoil speed"]),
    FieldDef("recoil_speed", "卷取段速度", "number", unit="m/min",
             aliases=["卷取速度", "recoil speed", "收卷速度"]),
    FieldDef("uncoil_tension", "开卷段张力", "number", unit="kN",
             aliases=["开卷张力", "uncoil tension"]),
    FieldDef("recoil_tension", "卷取段张力", "number", unit="kN",
             aliases=["卷取张力", "收卷张力", "recoil tension"]),
    FieldDef("pass_line_height", "工作线标高", "number", unit="mm",
             default=1100),
    FieldDef("floor_space", "设备空间(长x宽x高)", "string", unit="m",
             aliases=["占地面积", "空间"]),

    # ── 四、电源及公用工程 ──
    FieldDef("voltage", "电源电压", "string", unit="V", default="AC 380V"),
    FieldDef("frequency", "电源频率", "number", unit="Hz", default=50),
    FieldDef("phase_wiring", "相数", "string", default="三相三线制+PE"),
    FieldDef("grounding", "接地方式", "string", default="TN-C-S"),
    FieldDef("compressed_air", "压缩空气压力", "number", unit="MPa"),
    FieldDef("cooling_water", "冷却水压力/水质", "string", unit="MPa"),

    # ── 五、现场气候条件 ──
    FieldDef("altitude", "海拔高度", "number", unit="m"),
    FieldDef("ambient_temp_min", "最低环境温度", "number", unit="°C"),
    FieldDef("ambient_temp_max", "最高环境温度", "number", unit="°C"),
    FieldDef("rainfall", "年均/最大降水量", "string", unit="mm"),
    FieldDef("humidity", "相对湿度", "number", unit="%RH"),

    # ── 六、配套设备及配置选项 ──
    FieldDef("hydraulic_unit", "液压泵站", "enum",
             options=["客户提供", "卖家提供"], default="卖家提供"),
    FieldDef("hydraulic_valve", "液压阀台", "enum",
             options=["客户提供", "卖家提供"], default="卖家提供"),
    FieldDef("air_source", "气源", "enum",
             options=["客户提供", "卖家提供"], default="卖家提供"),
    FieldDef("pneumatic_valve", "气动阀台", "enum",
             options=["客户提供", "卖家提供"], default="卖家提供"),
    FieldDef("electrical_control", "电控系统", "enum",
             options=["客户提供", "卖家提供"], default="卖家提供"),
    FieldDef("install_material_mech", "机械安装材料", "enum",
             options=["客户提供", "卖家提供"], default="卖家提供"),
    FieldDef("install_material_fluid", "流体安装材料", "enum",
             options=["客户提供", "卖家提供"], default="卖家提供"),
    FieldDef("install_material_elec", "电气安装材料", "enum",
             options=["客户提供", "卖家提供"], default="卖家提供"),
    FieldDef("civil_foundation", "设备土建基础", "enum",
             options=["客户负责", "卖家负责"]),
    FieldDef("commissioning", "调试工作内容", "enum",
             options=["客户负责", "卖家负责", "客户主导/卖家协助"], default="卖家负责"),
    FieldDef("component_brand", "配件品牌", "enum",
             options=["标准配置", "客户推荐"], default="标准配置"),

    # ── 通用 ──
    FieldDef("quantity", "数量", "number", unit="套", default=1, required_for_quote=True),
    FieldDef("delivery_location", "交货地点", "string", required_for_quote=True),
    FieldDef("delivery_date", "交期", "string"),
    FieldDef("special_req", "其他特殊要求", "text"),
]

TEMPLATES: dict[str, list[FieldDef]] = {
    "液压锁紧装置": HYDRAULIC_LOCKING,
    "矫直设备": STRAIGHTENING,
    "剪切设备": SHEARING,
    "辊涂设备": ROLLER_COATING,
    "开收卷设备": WINDER_UNWINDER,
}

TEMPLATE_CATEGORIES = list(TEMPLATES.keys())


def get_template(category: str) -> list[FieldDef] | None:
    return TEMPLATES.get(category)


# 内置大类的关键词权重：专有词 3、行业常用词 2、泛词 1
BUILTIN_KEYWORDS: dict[str, dict[str, int]] = {
    "液压锁紧装置": {
        "液压锁": 3, "锁紧器": 3, "锁紧装置": 3, "液压缸锁": 3,
        "锁紧": 2, "液压夹": 2, "抱闸": 2, "安全锁": 2,
    },
    "矫直设备": {
        "拉弯矫": 3, "矫直机": 3, "矫直机组": 3, "矫直段": 3,
        "辊式矫直": 3, "连续拉弯矫": 3, "张力矫直": 3,
        "拉弯矫直": 3, "矫直线": 3, "straightener": 3, "leveler": 3,
        "矫直": 2, "平整机": 2, "延伸率": 2, "张力辊": 2,
        "平整": 1, "板形": 1, "平直度": 1,
    },
    "剪切设备": {
        "纵剪": 3, "横剪": 3, "剪切机组": 3, "圆盘剪": 3,
        "飞剪": 3, "切边线": 3, "刀箱": 3, "碎边": 3,
        "slitting": 3, "shearing": 3, "剪切线": 3,
        "剪切": 2, "剪切段": 2, "废边": 2, "切边宽度": 2,
        "剪切精度": 2, "剪切毛刺": 2, "剪机": 1,
    },
    "辊涂设备": {
        "辊涂": 3, "化涂": 3, "涂覆机": 3, "涂层机": 3,
        "涂头": 3, "辊涂机": 3, "涂覆段": 3, "涂辊": 3,
        "涂覆辊": 3, "coating": 2, "涂覆": 2,
        "彩涂": 1, "两辊式": 1, "三辊式": 1,
    },
    "开收卷设备": {
        "开卷机": 3, "收卷机": 3, "卷取机": 3, "卷筒胀缩": 3,
        "钳口": 3, "扩径": 3, "错层": 3, "塔形": 3,
        "uncoiler": 3, "recoiler": 3, "winder": 3,
        "开卷": 2, "收卷": 2, "卷取": 2, "卷筒": 2,
        "上开卷": 2, "下开卷": 2, "套筒": 2,
    },
}


def _builtin_scores(text: str) -> tuple[dict[str, int], dict[str, int]]:
    """各内置大类的关键词总分与命中个数（英文关键词不区分大小写）。"""
    scores: dict[str, int] = {}
    hits: dict[str, int] = {}
    low = text.lower()
    for cat, kws in BUILTIN_KEYWORDS.items():
        total = 0
        cnt = 0
        for kw, w in kws.items():
            if kw in text or kw in low:
                total += w
                cnt += 1
        if total > 0:
            scores[cat] = total
            hits[cat] = cnt
    return scores, hits


def infer_category(text: str) -> tuple[str | None, float]:
    """从文本粗判内置产品大类（加权评分版）。

    每个关键词有权重 1-3：专有词（如"矫直机"）权重 3，
    行业常用词（如"平整"）权重 2，泛词（如"板形"）权重 1。
    最终取总得分最高的类别。

    返回 (category, confidence)。无法判断返回 (None, 0)。
    """
    scores, hit_counts = _builtin_scores(text)
    if not scores:
        return None, 0.0

    best = max(scores, key=scores.get)
    best_hits = hit_counts[best]

    # 置信度：基础 0.5 + 每个命中关键词加 0.08（上限 0.92）
    conf = min(0.5 + 0.08 * best_hits, 0.92)

    # 如果第二名得分接近第一名（差距 ≤1 个权重），降低置信度
    sorted_scores = sorted(scores.values(), reverse=True)
    if len(sorted_scores) > 1 and sorted_scores[0] - sorted_scores[1] <= 1:
        conf *= 0.7

    return best, round(conf, 2)


# ============================================================
# 需求模板（数据库维护）驱动
# ============================================================

# 需求模板的字段类型 → 引擎抽取类型
_TYPE_MAP = {
    "number": "number",
    "select": "enum",
    "multiselect": "string",
    "range": "string",
    "textarea": "text",
    "text": "string",
    "checkbox": "string",
    "date": "string",
}


def fielddefs_from_template(fields: list[dict]) -> list[FieldDef]:
    """把「需求模板」页维护的字段（key/label/unit/type/section/required/remark/options）转成引擎字段定义。

    · required → 影响选型/报价的必填项：识别不到就进缺失清单、生成补问
    · section → 分组（参数表按组显示）；remark → 填写说明（喂给大模型，也用于补问提示）
    · select 有选项 → 枚举（大模型只能在选项里选）；range 填「最小~最大」
    """
    defs: list[FieldDef] = []
    seen: set[str] = set()
    for f in fields or []:
        key = str(f.get("key") or "").strip()
        label = str(f.get("label") or "").strip()
        if not key or not label or key in seen:
            continue
        seen.add(key)
        raw_type = str(f.get("type") or "text")
        ftype = _TYPE_MAP.get(raw_type, "string")
        options = [str(o) for o in (f.get("options") or []) if str(o).strip()] or None
        if ftype == "enum" and not options:
            ftype = "string"
        hint = str(f.get("remark") or "").strip() or None
        if raw_type == "range":
            hint = (f"{hint}；" if hint else "") + "按「最小~最大」填写"
        if raw_type == "multiselect" and options:
            hint = (f"{hint}；" if hint else "") + "可多选，用顿号分隔：" + " / ".join(options)
        required = bool(f.get("required"))
        defs.append(FieldDef(
            key=key,
            label=label,
            type=ftype,
            unit=(str(f.get("unit") or "").strip() or None),
            options=options if ftype == "enum" else None,
            required_for_match=required,
            required_for_quote=required,
            group=(str(f.get("section") or "").strip() or None),
            hint=hint,
        ))
    return defs


# 产品类型名里的修饰前缀：去掉后剩下的才是产品本体（常规联轴器 → 联轴器、液压横剪 → 横剪）
_MODIFIERS = ("常规", "特殊", "高强", "中厚板", "智驱", "组合", "液压", "滚筒", "球头", "非标", "轧机")

# 海外客户的资料多是英文：常见产品名的英文写法 → 中文本体
_EN_SYNONYMS: dict[str, tuple[str, ...]] = {
    "拉弯矫": ("tension leveller", "tension leveler", "tension levelling", "tension leveling", "stretch bend"),
    "多辊矫": ("roller leveller", "roller leveler", "multi-roll", "multi roll leveler"),
    "直头机": ("head straightener", "flattener"),
    "圆盘剪": ("side trimmer", "side trim", "disc shear", "circle shear", "rotary shear"),
    "碎边剪": ("scrap chopper", "scrap cutter", "edge chopper"),
    "废边卷": ("scrap winder", "scrap baller", "scrap reel"),
    "飞剪": ("flying shear",),
    "横剪": ("crop shear",),
    "横切线": ("cut to length", "cut-to-length", "ctl line"),
    "分切线": ("slitting line", "slitter"),
    "切边线": ("trimming line", "side trimming line"),
    "拉矫线": ("tension leveling line", "tension levelling line"),
    "准备线": ("preparation line", "recoiling line", "inspection line"),
    "开卷机": ("uncoiler", "decoiler", "pay-off reel", "pay off reel", "payoff reel"),
    "收卷机": ("recoiler", "tension reel", "coiler"),
    "联轴器": ("coupling",),
    "辊涂机": ("roll coater", "roller coater"),
    "化涂机": ("chem coater", "chemical coater"),
    "卷筒": ("mandrel",),
    "支承辊": ("backup roll", "back-up roll"),
    "工作辊": ("work roll",),
    "中间辊": ("intermediate roll",),
    "背衬轴承": ("backing bearing",),
    "连铸轴承": ("caster bearing", "continuous casting bearing"),
    "旋转接头": ("rotary joint", "rotary union"),
    "液压螺母": ("hydraulic nut",),
    "纠偏装置": ("edge position control", "center position control", "steering unit"),
    "夹送装置": ("pinch roll",),
    "精冲机": ("fine blanking",),
    "高压清洗头": ("high pressure cleaning", "descaling nozzle"),
    "螺旋辊": ("spiral roll", "helical roll"),
    "胶辊": ("rubber roll",),
    "圆盘刀": ("slitter knife", "slitting knife", "circular knife"),
    "横剪刀": ("shear blade",),
    "碎边刀": ("chopper knife",),
    "缝合机模具": ("stitcher", "stitching"),
    "多辊减速箱": ("gearbox", "gear box"),
}


def _segment_terms(part: str) -> list[str]:
    """一个产品名的可匹配写法：原名、去修饰前缀后的本体、英文写法。"""
    out = [part]
    for m in _MODIFIERS:
        if part.startswith(m) and len(part) - len(m) >= 2:
            out.append(part[len(m):])
    for zh in list(out):
        out.extend(_EN_SYNONYMS.get(zh, ()))
    return list(dict.fromkeys(out))


def _match_len(text: str, low: str, part: str) -> int:
    """该产品名在资料里能匹配到的最长写法的长度（英文按 1/3 折算，与中文字数大致可比）；没匹配到为 0。"""
    best = 0
    for t in _segment_terms(part):
        if t.isascii():
            if t in low:
                best = max(best, max(2, len(t) // 3))
        elif t in text:
            best = max(best, len(t))
    return best


def infer_category_among(text: str, categories: list[str]) -> tuple[str | None, float, str]:
    """在「需求模板」的全部产品类型里判定资料属于哪一个。返回 (类型路径, 置信度, 依据)。

    打分（全部可解释）：
      · 末级名称（按「+」拆开的每一项）在资料里出现：+ 匹配长度 × 3；组合类型缺一项 −2
      · 中间各级名称出现：+ 匹配长度
      · 中间级恰好是内置大类（如「矫直设备」）：+ 内置关键词得分（矫直机/延伸率/leveler…）
    并列时优先「常规」类型、再优先组成项少的（只提到圆盘剪就不选「圆盘剪+碎边剪」）。
    """
    if not categories:
        return None, 0.0, ""
    low = text.lower()
    builtin, _ = _builtin_scores(text)
    scored: list[tuple[float, int, int, str, str]] = []
    for cat in categories:
        segs = [s.strip() for s in cat.split("/") if s.strip()]
        if not segs:
            continue
        parts = [p.strip() for p in segs[-1].split("+") if p.strip()]
        score = 0.0
        why: list[str] = []
        for part in parts:
            m = _match_len(text, low, part)
            if m:
                score += m * 3
                why.append(part)
            elif len(parts) > 1:
                score -= 2
        for mid in segs[:-1]:
            m = _match_len(text, low, mid)
            if m:
                score += m
            if mid in builtin:
                score += builtin[mid]
                why.append(f"{mid}关键词")
        prefer = 1 if segs[-1].startswith("常规") else 0
        scored.append((score, prefer, -len(parts), cat, "、".join(why)))
    scored.sort(key=lambda x: (x[0], x[1], x[2]), reverse=True)
    if not scored or scored[0][0] <= 0:
        return None, 0.0, ""
    best = scored[0]
    conf = min(0.5 + 0.03 * best[0], 0.95)
    if len(scored) > 1 and best[0] - scored[1][0] <= 2:
        # 与第二名分差很小（如 常规联轴器 / 特殊联轴器 只靠「联轴器」区分不开）：降置信，提示人确认
        conf *= 0.75
    return best[3], round(conf, 2), best[4]
