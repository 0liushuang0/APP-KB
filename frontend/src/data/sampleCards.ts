export type FieldLevel = 'green' | 'yellow' | 'red' | 'empty'

export interface SingleField {
  type: 'single'
  key: string
  label: string
  value: string | number | null
  unit?: string
  level: FieldLevel
  source: 'ai' | 'manual' | 'rule' | 'default'
  confidence: number
  evidence?: string
}

export interface PairedField {
  type: 'paired'
  key: string
  label: string
  min: { value: string | number | null; level: FieldLevel; confidence: number }
  max: { value: string | number | null; level: FieldLevel; confidence: number }
  unit?: string
  source: 'ai' | 'manual' | 'rule'
  evidence?: string
}

export type CardCell = SingleField | PairedField

export interface CardSection {
  title: string
  defaultOpen: boolean
  cells: CardCell[]
}

export interface MissingField {
  field: string
  label: string
  severity: 'high' | 'medium'
  hint: string
}

export interface SampleCardV2 {
  product_category: string
  category_confidence: number
  overall_confidence: number
  llm_used: boolean
  sections: CardSection[]
  missing: MissingField[]
}

const ai = (key: string, label: string, value: string | number, unit?: string, evidence?: string): SingleField => ({
  type: 'single', key, label, value, unit, level: 'green', source: 'ai', confidence: 1.0, evidence,
})

const empty = (key: string, label: string, unit?: string): SingleField => ({
  type: 'single', key, label, value: null, unit, level: 'empty', source: 'ai', confidence: 0,
})

const missing = (key: string, label: string, unit?: string): SingleField => ({
  type: 'single', key, label, value: null, unit, level: 'red', source: 'ai', confidence: 0,
})

const rule = (key: string, label: string, value: string | number, unit?: string): SingleField => ({
  type: 'single', key, label, value, unit, level: 'yellow', source: 'rule', confidence: 0.5,
})

const def = (key: string, label: string, value: string | number, unit?: string): SingleField => ({
  type: 'single', key, label, value, unit, level: 'yellow', source: 'default', confidence: 0.5,
})

const pairAI = (key: string, label: string, minVal: number, maxVal: number, unit: string, evidence?: string): PairedField => ({
  type: 'paired', key, label, unit, source: 'ai', evidence,
  min: { value: minVal, level: 'green', confidence: 1.0 },
  max: { value: maxVal, level: 'green', confidence: 1.0 },
})

const pairEmpty = (key: string, label: string, unit?: string): PairedField => ({
  type: 'paired', key, label, unit, source: 'ai',
  min: { value: null, level: 'empty', confidence: 0 },
  max: { value: null, level: 'empty', confidence: 0 },
})

export const SAMPLE_CARDS: Record<string, SampleCardV2> = {
  矫直设备: {
    product_category: '矫直设备',
    category_confidence: 0.9,
    overall_confidence: 0.88,
    llm_used: true,
    sections: [
      {
        title: '一、来料信息',
        defaultOpen: true,
        cells: [
          missing('material_type', '来料材质'),
          empty('material_grade', '牌号/种类'),
          rule('coil_condition', '钢卷状况', '下端卷(卷眼水平)'),
          pairAI('strip_width', '板带宽度', 600, 1370, 'mm', '技术规格书: 板带宽度600-1370mm'),
          pairAI('strip_thickness', '板带厚度', 0.1, 1.2, 'mm', '技术规格书: 厚度0.1-1.2mm'),
          pairEmpty('strip_temp', '板带温度', '°C'),
          pairAI('yield_strength', '屈服强度', 250, 550, 'MPa', '技术规格书: 屈服强度250-550MPa'),
          pairAI('tensile_strength', '抗拉强度', 300, 650, 'MPa', '技术规格书: 抗拉强度300-650MPa'),
          ai('surface_condition', '表面状态', '镀锌', undefined, '技术规格书: 表面状态涂层钢卷(镀锌)'),
          empty('surface_cleanliness', '表面清洁度'),
          empty('incoming_strip_quality', '来料带钢质量'),
          empty('camber', '镰刀弯允许值', 'mm/m'),
          empty('flatness_incoming', '来料平直度', 'I值'),
        ],
      },
      {
        title: '二、设备信息',
        defaultOpen: true,
        cells: [
          ai('requirement_type', '需求类别', '新增新建', undefined, '需求描述: 新建项目'),
          ai('line_type', '产线类型', '拉弯矫直机组', undefined, '需求标题: JSW拉弯矫直机组'),
          empty('strip_direction', '带钢运行方向'),
          ai('max_line_speed', '最高线速', 500, 'm/min', '技术规格书: 最高线速500m/min'),
          rule('threading_speed', '穿带速度', 20, 'm/min'),
          empty('tension_entry_low', '入口张力(低)', 'kN'),
          empty('tension_entry_high', '入口张力(高)', 'kN'),
          empty('tension_exit', '出口张力', 'kN'),
          rule('pass_line_height', '轧制线标高', 1100, 'mm'),
          empty('annual_output', '年产量目标', 't/y'),
          empty('floor_space', '设备空间(长x宽x高)', 'm'),
        ],
      },
      {
        title: '三、成品参数',
        defaultOpen: true,
        cells: [
          missing('product_flatness', '成品平直度', 'I值'),
          ai('elongation', '延伸率', '0-2%', '%', '技术规格书: 延伸率0-2%'),
          def('surface_quality_req', '表面质量要求', '不产生新擦划伤、皱折'),
        ],
      },
      {
        title: '四、电源及公用工程',
        defaultOpen: false,
        cells: [
          def('voltage', '供电电压', 'AC 380V', 'V'),
          def('frequency', '电源频率', 50, 'Hz'),
          def('phase_wiring', '相数及接线', '三相三线制+PE'),
          def('grounding', '接地方式', 'TN-C-S'),
          empty('compressed_air', '压缩空气压力', 'MPa'),
          empty('cooling_water', '冷却水压力/水质', 'MPa'),
        ],
      },
      {
        title: '五、现场环境',
        defaultOpen: false,
        cells: [
          empty('altitude', '海拔高度', 'm'),
          empty('ambient_temp_min', '最低环境温度', '°C'),
          empty('ambient_temp_max', '最高环境温度', '°C'),
          empty('humidity', '相对湿度', '%RH'),
          empty('special_env', '其他环境要求'),
        ],
      },
      {
        title: '六、配套设备及配置',
        defaultOpen: false,
        cells: [
          def('hydraulic_unit', '液压泵站', '卖家提供'),
          def('hydraulic_valve', '液压阀台', '卖家提供'),
          def('electrical_control', '电控系统配置', '电控柜'),
          def('tensiometer', '张力计', '配置'),
          def('edge_trim', '边丝处理方式', '碎断'),
          def('automation_level', '自动化等级', '半自动'),
          def('install_material', '机械安装材料', '卖家提供'),
          def('commissioning', '调试工作', '卖家负责'),
          def('component_brand', '配件品牌', '标准配置'),
        ],
      },
      {
        title: '通用',
        defaultOpen: false,
        cells: [
          def('quantity', '数量', 1, '套'),
          missing('delivery_location', '交货地点'),
          empty('delivery_date', '交期'),
          empty('special_req', '其他特殊要求'),
        ],
      },
    ],
    missing: [
      { field: 'material_type', label: '来料材质', severity: 'high', hint: '需确认材质(冷轧钢/热轧钢/不锈钢等)' },
      { field: 'product_flatness', label: '成品平直度', severity: 'high', hint: '需确认平直度要求(I≤5?)' },
      { field: 'delivery_location', label: '交货地点', severity: 'high', hint: '需确认交货地点' },
      { field: 'surface_cleanliness', label: '表面清洁度', severity: 'medium', hint: '需确认表面清洁度要求' },
      { field: 'strip_direction', label: '带钢运行方向', severity: 'medium', hint: '需确认运行方向(左→右? 右→左?)' },
    ],
  },

  剪切设备: {
    product_category: '剪切设备',
    category_confidence: 0.9,
    overall_confidence: 0.85,
    llm_used: true,
    sections: [
      {
        title: '一、来料信息',
        defaultOpen: true,
        cells: [
          missing('material_type', '来料材质'),
          empty('material_grade', '牌号/种类'),
          ai('surface_condition', '表面状态', '镀锌', undefined, '采集表: 涂层钢卷Coating coils'),
          pairAI('strip_width', '板带宽度', 600, 1370, 'mm', '采集表: Min 600～Max 1370mm'),
          pairAI('strip_thickness', '板带厚度', 0.1, 1.2, 'mm', '采集表: Min 0.1～Max 1.2mm'),
          ai('gauge_variation', '厚度误差', '±6%', undefined, '采集表: 中间部分带材厚度允许±6%偏差'),
          pairAI('yield_strength', '屈服强度', 250, 550, 'MPa', '采集表: Min 250～Max 550 MPa'),
          pairAI('tensile_strength', '抗拉强度', 300, 650, 'MPa', '采集表: Min 300～Max 650 MPa'),
          pairAI('strip_temp', '板带温度', 10, 55, '°C', '采集表: Min 10～Max 55°C'),
          ai('camber', '镰刀弯允许值', '≤2/2000', 'mm/m', '采集表: ≤2/2000 mm/m'),
          missing('flatness_incoming', '浪形/平直度', 'I值'),
          empty('surface_cleanliness', '表面清洁度(残油)', 'mg/m²'),
          ai('weld_width_diff', '焊缝前后宽度差', '单边Max 150', 'mm', '采集表: 单边Max 150mm'),
          ai('crescent_notch', '月牙口尺寸', '100≤深≤200, 300≤宽≤500', 'mm', '采集表: 100≤深度≤200, 300≤宽度≤500mm'),
          ai('edge_guide_accuracy', '圆盘剪前纠偏精度', '±1', 'mm', '采集表: ±1mm'),
          ai('strip_surface_quality', '带钢表面质量', '不得有任何严重缺陷', undefined, '采集表: 表面不得有分层/严重厚度不均/结疤/塔叠'),
        ],
      },
      {
        title: '二、设备信息',
        defaultOpen: true,
        cells: [
          missing('requirement_type', '需求类别'),
          missing('line_type', '生产线名称/类型'),
          missing('strip_direction', '钢带运行方向'),
          ai('threading_speed', '穿带速度', 20, 'm/min', '采集表: 0~20 m/min'),
          ai('max_line_speed', '最高线速', 500, 'm/min', '采集表: Max 500 m/min'),
          ai('shear_entry_tension', '剪切段入口张力', 20, 'kN', '采集表: Max 20 kN'),
          ai('shear_tension', '剪切段张力', 130, 'kN', '采集表: Max 130 kN'),
          ai('pass_line_height', '轧制线标高', 1100, 'mm', '采集表: 1100mm'),
          empty('floor_space', '设备空间(长x宽x高)', 'm'),
          empty('annual_output', '年产量目标', 't/y'),
        ],
      },
      {
        title: '三、成品参数',
        defaultOpen: true,
        cells: [
          pairAI('trim_width', '切边宽度', 5, 50, 'mm', '采集表: 单侧Min 5～Max 50mm'),
          ai('edge_quality', '边部质量', '无新增缺陷', undefined, '采集表: 无新增缺陷'),
          ai('shearing_accuracy', '剪切精度', '0～1', undefined, '采集表: 0～1'),
          ai('shearing_burr', '剪切毛刺', '≤5%板厚', undefined, '采集表: ≤5%板厚'),
        ],
      },
      {
        title: '四、电源及公用工程',
        defaultOpen: false,
        cells: [
          def('voltage', '变压器二次侧低压', 'AC 380V', 'V'),
          def('frequency', '电源频率', 50, 'Hz'),
          def('phase_wiring', '相数及接线', '三相三线制+PE'),
          def('grounding', '接地方式', 'TN-C-S'),
          empty('compressed_air', '压缩空气压力', 'MPa'),
          empty('cooling_water', '冷却水压力/水质', 'MPa'),
        ],
      },
      {
        title: '五、现场气候与环境条件',
        defaultOpen: false,
        cells: [
          empty('altitude', '海拔高度', 'm'),
          empty('ambient_temp_min', '最低环境温度', '°C'),
          empty('ambient_temp_max', '最高环境温度', '°C'),
          empty('rainfall', '年均/最大降水量', 'mm'),
          empty('humidity', '相对湿度', '%RH'),
        ],
      },
      {
        title: '六、配套设备及配置选项',
        defaultOpen: false,
        cells: [
          empty('knife_box_config', '刀箱配置'),
          empty('accessories', '附件配置'),
          missing('scrap_handling', '废边处理方式'),
          def('hydraulic_unit', '液压泵站', '卖家提供'),
          def('hydraulic_valve', '液压阀台', '卖家提供'),
          def('pneumatic_unit', '气动泵站', '卖家提供'),
          def('pneumatic_valve', '气动阀台', '卖家提供'),
          def('electrical_control', '电控系统', '电控柜'),
          def('install_material_mech', '机械安装材料', '卖家提供'),
          def('install_material_fluid', '流体安装材料', '卖家提供'),
          def('install_material_elec', '电气安装材料', '卖家提供'),
          empty('civil_foundation', '设备土建基础及施工'),
          def('commissioning', '调试工作内容', '卖家负责'),
          def('component_brand', '配件品牌', '标准配置'),
        ],
      },
      {
        title: '通用',
        defaultOpen: false,
        cells: [
          def('quantity', '数量', 1, '套'),
          missing('delivery_location', '交货地点'),
          empty('delivery_date', '交期'),
          empty('special_req', '其他特殊要求'),
        ],
      },
    ],
    missing: [
      { field: 'material_type', label: '来料材质', severity: 'high', hint: '需确认材质(冷轧钢/热轧钢/不锈钢等)' },
      { field: 'requirement_type', label: '需求类别', severity: 'high', hint: '需确认是新增新建还是改造升级' },
      { field: 'line_type', label: '生产线名称/类型', severity: 'high', hint: '需确认机组类型(纵剪/横剪/拉弯矫直等)' },
      { field: 'scrap_handling', label: '废边处理方式', severity: 'high', hint: '需确认废边处理(碎边剪/在线废边卷/离线废边卷)' },
      { field: 'delivery_location', label: '交货地点', severity: 'high', hint: '需确认交货地点' },
      { field: 'strip_direction', label: '钢带运行方向', severity: 'medium', hint: '需确认运行方向(左→右? 右→左?)' },
      { field: 'flatness_incoming', label: '浪形/平直度', severity: 'medium', hint: '需确认来料浪形和平直度要求' },
    ],
  },

  液压锁紧装置: {
    product_category: '液压锁紧装置',
    category_confidence: 0.85,
    overall_confidence: 0.7,
    llm_used: true,
    sections: [
      {
        title: '技术参数',
        defaultOpen: true,
        cells: [
          ai('tonnage', '锁紧力/吨位', 50, '吨'),
          ai('stroke', '行程', 200, 'mm'),
          ai('pressure', '系统压力', 21, 'MPa'),
          rule('cylinder_bore', '缸径', 160, 'mm'),
          ai('requirement_type', '需求类别', '新增新建'),
        ],
      },
    ],
    missing: [
      { field: 'rod_diameter', label: '活塞杆直径', severity: 'high', hint: '需确认活塞杆直径' },
      { field: 'mounting', label: '安装方式', severity: 'high', hint: '需确认安装方式' },
    ],
  },

  燃油输送装置: {
    product_category: '燃油输送装置',
    category_confidence: 0.85,
    overall_confidence: 0.7,
    llm_used: true,
    sections: [
      {
        title: '技术参数',
        defaultOpen: true,
        cells: [
          ai('flow_rate', '流量', 60, 'm³/h'),
          ai('head', '扬程', 45, 'm'),
          ai('medium', '介质', '航空煤油'),
          rule('power', '电机功率', 22, 'kW'),
          ai('requirement_type', '需求类别', '改造升级'),
        ],
      },
    ],
    missing: [
      { field: 'viscosity', label: '介质粘度', severity: 'high', hint: '需确认介质粘度' },
      { field: 'temperature', label: '工作温度', severity: 'medium', hint: '需确认工作温度范围' },
    ],
  },

  辊涂设备: {
    product_category: '辊涂设备',
    category_confidence: 0.9,
    overall_confidence: 0.85,
    llm_used: true,
    sections: [
      {
        title: '一、来料信息',
        defaultOpen: true,
        cells: [
          ai('material_type', '来料材质', '普碳钢系列', undefined, '采集表: A.普碳钢系列'),
          ai('material_category', '来料种类', '退火料、平整料、冷轧料', undefined, '采集表: 需提供产品大纲'),
          ai('prior_process', '来料前道工艺', '平整、镀锌', undefined, '采集表: D.退火 E.平整'),
          pairAI('strip_width', '板带宽度', 700, 1250, 'mm', '采集表: 700~1250mm'),
          pairAI('strip_thickness', '板带厚度', 0.2, 1.0, 'mm', '采集表: 0.2~1.0mm'),
          ai('gauge_variation', '板带厚度偏差', '±10%', undefined, '采集表: Max ±10%'),
          pairAI('yield_strength', '屈服强度', 200, 780, 'MPa', '采集表: 200~780 MPa'),
          pairAI('tensile_strength', '抗拉强度', 300, 980, 'MPa', '采集表: 300~980 MPa'),
          pairAI('strip_temp', '板带温度', 50, 90, '°C', '采集表: Min 50~Max 90°C'),
          ai('surface_cleanliness', '表面清洁度(残油)', '100', 'mg/m²', '采集表: 残油100mg/m²单面'),
          ai('flatness_incoming', '板带平直度', '≤40或≤15', 'mm/m', '采集表: ≤40或≤15mm/m'),
          ai('camber', '镰刀弯', '≤2', 'mm/2m', '采集表: Max 2mm/2m'),
        ],
      },
      {
        title: '二、成品参数',
        defaultOpen: true,
        cells: [
          pairAI('coating_thickness', '涂层厚度', 10, 20, 'μm', '采集表: 10~20μm单侧'),
          ai('coating_uniformity', '涂层厚度均匀性', '±10%', '%', '采集表: ±10%'),
          ai('uncoated_weld_length', '焊缝前后不涂层长度', '≤4', 'm', '采集表: ≤4m(焊缝前后各2米)'),
          ai('surface_quality', '表面质量', '无色差/色斑/漏涂点', undefined, '采集表: 无任何色差、色斑、无任何漏涂点'),
        ],
      },
      {
        title: '三、生产线信息',
        defaultOpen: true,
        cells: [
          ai('requirement_type', '需求类别', '新增新建', undefined, '采集表: A.新增新建'),
          ai('line_type', '生产线名称', '彩涂', undefined, '采集表: C.彩涂'),
          ai('strip_direction', '钢带运行方向', '垂直进料', undefined, '采集表: C.垂直进料'),
          ai('threading_speed', '穿带速度', 20, 'm/min', '采集表: B.0~20m/min'),
          ai('coating_position', '涂覆位置', '正面+反面', undefined, '采集表: A.板带正面 B.板带反面'),
          ai('coating_speed', '涂覆段线速度', 150, 'm/min', '采集表: Max 150m/min'),
          ai('coating_tension', '辊涂段张力', 80, 'kN', '采集表: Max 80kN'),
          ai('pass_line_height', '工作线标高', 1100, 'mm', '采集表: B.1100mm'),
          ai('floor_space', '设备空间', '长5×宽7×高3', 'm', '采集表: 长Max5 宽Max7 高Max3'),
        ],
      },
      {
        title: '四、电源及公用工程',
        defaultOpen: false,
        cells: [
          ai('voltage', '电源电压', 'AC 380±10%', 'V'),
          ai('frequency', '电源频率', 50, 'Hz'),
          ai('phase_wiring', '相数', '三相三线制+PE'),
          ai('grounding', '接地方式', 'TN-C-S'),
          empty('compressed_air', '压缩空气压力', 'MPa'),
          empty('cooling_water', '冷却水压力/水质', 'MPa'),
        ],
      },
      {
        title: '五、现场气候条件',
        defaultOpen: false,
        cells: [
          ai('altitude', '海拔高度', 100, 'm', '采集表: 100米'),
          pairAI('ambient_temp', '环境温度', -10, 45, '°C', '采集表: Min -10~Max 45°C'),
          ai('rainfall', '年均/最大降水量', '平均1000, Max1800', 'mm'),
          ai('humidity', '相对湿度', 80, '%RH'),
        ],
      },
      {
        title: '六、配套设备及配置选项',
        defaultOpen: false,
        cells: [
          ai('coating_head_type', '涂头结构', '两辊式', undefined, '采集表: A.两辊式'),
          ai('pressure_adjust', '压力调整系统', '手动调整', undefined, '采集表: A.手动调整'),
          ai('fluid_circulation', '供液循环系统', '卖家提供'),
          ai('hydraulic_unit', '液压泵站', '卖家提供'),
          ai('hydraulic_valve', '液压阀台', '客户提供'),
          ai('air_source', '气源', '客户提供'),
          ai('pneumatic_valve', '气动阀台', '客户提供'),
          ai('electrical_control', '电控系统', '卖家提供'),
          ai('install_material_mech', '机械安装材料', '客户提供'),
          ai('install_material_fluid', '流体安装材料', '客户提供'),
          ai('install_material_elec', '电气安装材料', '客户提供'),
          ai('civil_foundation', '设备土建基础', '客户负责'),
          ai('commissioning', '调试工作内容', '客户主导/卖家协助'),
          ai('component_brand', '配件品牌', '标准配置'),
        ],
      },
      {
        title: '通用',
        defaultOpen: false,
        cells: [
          def('quantity', '数量', 1, '套'),
          missing('delivery_location', '交货地点'),
          empty('delivery_date', '交期'),
          empty('special_req', '其他特殊要求'),
        ],
      },
    ],
    missing: [
      { field: 'delivery_location', label: '交货地点', severity: 'high', hint: '需确认交货地点(越南?)' },
    ],
  },

  开收卷设备: {
    product_category: '开收卷设备',
    category_confidence: 0.9,
    overall_confidence: 0.85,
    llm_used: true,
    sections: [
      {
        title: '一、来料信息',
        defaultOpen: true,
        cells: [
          ai('material_type', '来料材质', '普碳钢系列', undefined, '采集表: A.普碳钢系列'),
          ai('material_category', '来料种类/状态', '退火料、平整料、冷轧料', undefined, '采集表: 需提供产品大纲'),
          ai('prior_process', '来料前道工艺', '退火、平整', undefined, '采集表: D.退火 E.平整'),
          pairAI('strip_width', '板带宽度', 700, 1250, 'mm', '采集表: 700~1250mm'),
          pairAI('strip_thickness', '板带厚度', 0.2, 2.0, 'mm', '采集表: 0.2~2.0mm'),
          ai('gauge_variation', '板带厚度偏差', '±10%', undefined, '采集表: Max ±10%'),
          pairAI('yield_strength', '屈服强度', 200, 780, 'MPa', '采集表: 200~780 MPa'),
          pairAI('tensile_strength', '抗拉强度', 300, 980, 'MPa', '采集表: 300~980 MPa'),
          pairAI('coil_od', '钢卷外径', 800, 2000, 'mm', '采集表: Min 800~Max 2000mm'),
          pairAI('coil_weight', '钢卷重量', 3, 25, '吨', '采集表: Min 3~Max 25吨'),
          pairAI('strip_temp', '板带温度', 50, 90, '°C', '采集表: 50~90°C'),
          ai('surface_cleanliness', '表面清洁度(残油)', '100', 'mg/m²', '采集表: 残油100mg/m²单面'),
          ai('flatness_incoming', '板带平直度', '≤40或≤15', 'mm/m', '采集表: ≤40或≤15mm/m'),
          ai('camber', '镰刀弯', '≤2', 'mm/2m', '采集表: Max 2mm/2m'),
        ],
      },
      {
        title: '二、成品参数',
        defaultOpen: true,
        cells: [
          ai('mandrel_diameter', '卷筒直径', 'Φ508', 'mm', '采集表: Φ508mm'),
          ai('mandrel_expansion', '卷筒胀缩范围', 'Φ480~Φ508', 'mm', '采集表: Φ480~Φ508mm'),
          ai('mandrel_jaw', '卷筒钳口', '含钳口', undefined, '采集表: 含钳口'),
          pairAI('product_coil_od', '成品钢卷外径', 800, 2000, 'mm', '采集表: Min 800~Max 2000mm'),
          pairAI('product_coil_weight', '成品钢卷重量', 3, 25, '吨', '采集表: Min 3~Max 25吨'),
          ai('telescoping', '错层公差', '±1', 'mm', '采集表: ±1mm(两圈之间)'),
          ai('tower_tolerance', '塔形公差', '≤3', 'mm', '采集表: ≤3mm(整卷,初始10圈及结尾5圈不大于5mm)'),
          ai('expansion_method', '扩径方式', '纸套筒', undefined, '采集表: B.纸套筒'),
          ai('expanded_diameter', '扩径后直径', 'Φ610', 'mm', '采集表: Φ610mm'),
          ai('surface_quality', '表面质量', '不产生新皱折/擦划伤', undefined, '采集表: 上下表面不产生新的皱折、擦划伤'),
        ],
      },
      {
        title: '三、生产线信息',
        defaultOpen: true,
        cells: [
          ai('requirement_type', '需求类别', '改造升级', undefined, '采集表: B.改造升级'),
          ai('line_type', '生产线名称', '镀锌', undefined, '采集表: D.镀锌'),
          ai('strip_direction', '钢带运行方向', '左→右', undefined, '采集表: A.从左至右'),
          ai('uncoil_method', '开卷方式', '上开卷', undefined, '采集表: A.上开卷'),
          ai('recoil_method', '收卷方式', '上收卷', undefined, '采集表: A.上开卷'),
          ai('threading_speed', '穿带速度', 20, 'm/min', '采集表: B.0~20m/min'),
          ai('uncoil_speed', '开卷段速度', 200, 'm/min', '采集表: Max 200m/min'),
          ai('recoil_speed', '卷取段速度', 200, 'm/min', '采集表: Max 200m/min'),
          ai('uncoil_tension', '开卷段张力', 30, 'kN', '采集表: Max 30kN'),
          ai('recoil_tension', '卷取段张力', 50, 'kN', '采集表: Max 50kN'),
          missing('pass_line_height', '工作线标高', 'mm'),
          ai('floor_space', '设备空间', '长5×宽6×高4', 'm', '采集表: 长Max5 宽Max6 高Max4'),
        ],
      },
      {
        title: '四、电源及公用工程',
        defaultOpen: false,
        cells: [
          ai('voltage', '电源电压', 'AC 380±10%', 'V'),
          ai('frequency', '电源频率', 50, 'Hz'),
          ai('phase_wiring', '相数', '三相三线制+PE'),
          ai('grounding', '接地方式', 'TN-C-S'),
          empty('compressed_air', '压缩空气压力', 'MPa'),
          empty('cooling_water', '冷却水压力/水质', 'MPa'),
        ],
      },
      {
        title: '五、现场气候条件',
        defaultOpen: false,
        cells: [
          empty('altitude', '海拔高度', 'm'),
          empty('ambient_temp_min', '最低环境温度', '°C'),
          empty('ambient_temp_max', '最高环境温度', '°C'),
          empty('rainfall', '年均/最大降水量', 'mm'),
          empty('humidity', '相对湿度', '%RH'),
        ],
      },
      {
        title: '六、配套设备及配置选项',
        defaultOpen: false,
        cells: [
          ai('hydraulic_unit', '液压泵站', '卖家提供'),
          ai('hydraulic_valve', '液压阀台', '客户提供'),
          ai('air_source', '气源', '客户提供'),
          ai('pneumatic_valve', '气动阀台', '客户提供'),
          ai('electrical_control', '电控系统', '卖家提供'),
          ai('install_material_mech', '机械安装材料', '客户提供'),
          ai('install_material_fluid', '流体安装材料', '客户提供'),
          ai('install_material_elec', '电气安装材料', '客户提供'),
          ai('civil_foundation', '设备土建基础', '客户负责'),
          ai('commissioning', '调试工作内容', '客户主导/卖家协助'),
          ai('component_brand', '配件品牌', '标准配置'),
        ],
      },
      {
        title: '通用',
        defaultOpen: false,
        cells: [
          def('quantity', '数量', 1, '套'),
          missing('delivery_location', '交货地点'),
          empty('delivery_date', '交期'),
          empty('special_req', '其他特殊要求'),
        ],
      },
    ],
    missing: [
      { field: 'pass_line_height', label: '工作线标高', severity: 'medium', hint: '需确认线标高(1000/1100/1200/1300?)' },
      { field: 'delivery_location', label: '交货地点', severity: 'high', hint: '需确认交货地点' },
    ],
  },
}
