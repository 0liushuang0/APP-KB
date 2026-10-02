/**
 * 博亚精工产品树种子数据
 *
 * 产品分类层级（使用 parent/child 格式）：
 * 1. 板带精整装备
 *    - 矫直设备（拉弯矫直）
 *    - 剪切设备（圆盘剪、飞剪）
 *    - 辊涂设备（镀锌辊涂、彩涂辊涂）
 * 2. 精密零部件
 *    - 辊系零部件
 *    - 联轴器
 *    - 液压锁紧装置
 * 3. 燃油输送装置
 */

export interface ProductSeedData {
  code: string;
  name: string;
  category: string;
  description: string;
  specifications: Record<string, any>;
  features?: string[];
  price: number;
  unit: string;
  status: 'active' | 'inactive';
}

export const PRODUCT_TREE_SEED: ProductSeedData[] = [
  // ============================================================
  // 1. 板带精整装备 / 矫直设备
  // ============================================================
  {
    code: 'BY-SJ-01',
    name: '酸洗/酸轧线-破鳞拉矫机',
    category: '板带精整装备/矫直设备',
    description: '应用于酸洗或酸轧产线入口，通过弯曲-拉伸变形破碎氧化铁皮，提升酸洗效率',
    specifications: {
      line_type: '酸洗/酸轧线',
      strip_width_max: '2080mm',
      strip_thickness_range: '1.0~6.0mm',
      max_line_speed: '180m/min',
      elongation: '0.5%~3.0%',
      tension: '150kN',
      roller_diameter: 'Φ1200mm',
    },
    features: ['破鳞效率高', '带钢对中控制', '张力闭环调节', '快速换辊'],
    price: 2800000,
    unit: '套',
    status: 'active',
  },
  {
    code: 'BY-SJ-02',
    name: '镀锌线-拉矫机（干式）',
    category: '板带精整装备/矫直设备',
    description: '用于镀锌线入口干式拉弯曲矫直，消除带钢波浪边、改善板形',
    specifications: {
      line_type: '镀锌线',
      mode: '干式',
      strip_width_max: '1850mm',
      strip_thickness_range: '0.3~2.5mm',
      max_line_speed: '200m/min',
      elongation: '0.2%~2.0%',
      tension: '80kN',
      roller_count: '5辊弯辊',
    },
    features: ['干式除鳞', '弯辊调节', '板形改善', '适应高速线'],
    price: 2200000,
    unit: '套',
    status: 'active',
  },
  {
    code: 'BY-SJ-03',
    name: '镀锌线-拉矫机（湿式）',
    category: '板带精整装备/矫直设备',
    description: '用于镀锌线湿式拉伸弯曲矫直，配合清洗段使用，适合高质量镀锌板生产',
    specifications: {
      line_type: '镀锌线',
      mode: '湿式',
      strip_width_max: '1850mm',
      strip_thickness_range: '0.25~2.0mm',
      max_line_speed: '220m/min',
      elongation: '0.2%~2.5%',
      tension: '70kN',
      roller_diameter: 'Φ800mm',
    },
    features: ['湿式清洗一体化', '高精度延伸率控制', '适合薄板', '在线板形监测'],
    price: 2600000,
    unit: '套',
    status: 'active',
  },
  {
    code: 'BY-SJ-04',
    name: '镀锡线-拉矫机',
    category: '板带精整装备/矫直设备',
    description: '用于镀锡/镀铬基板产线的高精度拉伸弯曲矫直，满足极薄板板形要求',
    specifications: {
      line_type: '镀锡线',
      strip_width_max: '1200mm',
      strip_thickness_range: '0.15~0.55mm',
      max_line_speed: '600m/min',
      elongation: '0.5%~2.0%',
      tension: '30kN',
      roller_diameter: 'Φ400mm',
    },
    features: ['超薄板专用', '高速运行', '精密延伸率控制', '低张力稳定'],
    price: 1900000,
    unit: '套',
    status: 'active',
  },
  {
    code: 'BY-SJ-05',
    name: '多辊矫直机',
    category: '板带精整装备/矫直设备',
    description: '适用于中厚板及薄板的辊式连续矫直，消除板面翘曲和波浪形缺陷',
    specifications: {
      line_type: '通用矫直线',
      strip_width_max: '2000mm',
      strip_thickness_range: '0.5~12mm',
      max_line_speed: '150m/min',
      roller_count: '17辊',
      roller_diameter: 'Φ240mm',
      drive_mode: '全主动',
    },
    features: ['全主动辊驱动', '刚度框架', '在线调参', '多规格兼容'],
    price: 850000,
    unit: '套',
    status: 'active',
  },

  // ============================================================
  // 1. 板带精整装备 / 剪切设备
  // ============================================================
  {
    code: 'BY-QJ-01',
    name: '圆盘剪切边机（含碎边剪）',
    category: '板带精整装备/剪切设备',
    description: '用于连续酸洗/冷轧/镀锌线中的带钢切边及碎边，保证成品宽度精度',
    specifications: {
      line_type: '酸洗/冷轧/镀锌线',
      strip_width_max: '2080mm',
      strip_thickness_range: '0.3~6.0mm',
      max_line_speed: '200m/min',
      cut_width_accuracy: '±0.15mm',
      edge_quality: '无毛刺',
      knife_material: '高速钢/硬质合金',
    },
    features: ['碎边剪一体化', '精密刀盘间隙调节', '在线换刀', '低噪音碎边'],
    price: 680000,
    unit: '套',
    status: 'active',
  },
  {
    code: 'BY-QJ-02',
    name: '连续线-飞剪',
    category: '板带精整装备/剪切设备',
    description: '用于冷轧连续线出口或酸轧线中间段，实现不停机动态分卷剪切',
    specifications: {
      line_type: '冷轧/酸轧线',
      strip_width_max: '2080mm',
      strip_thickness_range: '0.3~3.0mm',
      max_line_speed: '400m/min',
      cut_accuracy: '±50mm',
      shear_force: '120kN',
      drive_mode: '伺服电机',
    },
    features: ['动态同步剪切', '伺服高精度', '不停机换卷', '适应高速线'],
    price: 1200000,
    unit: '套',
    status: 'active',
  },

  // ============================================================
  // 1. 板带精整装备 / 辊涂设备
  // ============================================================
  {
    code: 'BY-GT-01',
    name: '镀锌线-辊涂机',
    category: '板带精整装备/辊涂设备',
    description: '用于镀锌线后处理化学钝化/耐指纹涂层，辊涂方式均匀高效',
    specifications: {
      line_type: '镀锌线',
      coating_type: '铬化/无铬钝化·耐指纹',
      strip_width_max: '1850mm',
      strip_thickness_range: '0.3~2.5mm',
      coating_speed: '200m/min',
      coating_thickness_range: '0.5~3μm',
      coating_uniformity: '±5%',
      roller_config: '三辊式（沾料/计量/涂覆）',
    },
    features: ['三辊精密涂覆', '无铬环保兼容', '在线厚度监测', '快速换辊'],
    price: 580000,
    unit: '套',
    status: 'active',
  },
  {
    code: 'BY-GT-02',
    name: '彩涂线-辊涂机',
    category: '板带精整装备/辊涂设备',
    description: '用于彩涂板生产线正/背面精涂与底涂，适配两涂两烘工艺',
    specifications: {
      line_type: '彩涂线',
      coating_type: '聚酯/氟碳/硅改性',
      strip_width_max: '1600mm',
      strip_thickness_range: '0.3~1.5mm',
      coating_speed: '120m/min',
      coating_thickness_range: '5~30μm',
      coating_uniformity: '±3%',
      roller_config: '两辊/三辊可切换',
    },
    features: ['正背面双涂', '两涂两烘', '换色快速清洗', '辊系温度控制'],
    price: 890000,
    unit: '套',
    status: 'active',
  },

  // ============================================================
  // 2. 精密零部件 / 辊系零部件
  // ============================================================
  {
    code: 'BY-GJ-01',
    name: '工作辊总成',
    category: '精密零部件/辊系零部件',
    description: '用于冷轧/拉矫/辊涂等设备的工作辊组件，含辊身、轴承座、密封系统',
    specifications: {
      application: '冷轧/拉矫/辊涂线',
      roller_diameter: 'Φ60~Φ1200mm',
      roller_length: '300~2800mm',
      material: '9Cr2Mo / 高速钢 / 碳化钨',
      surface_hardness: 'HRC58~65',
      surface_treatment: '镀硬铬',
      runout: '≤0.005mm',
    },
    features: ['高精度动平衡', '镜面级表面', '耐磨耐腐蚀', '定制化设计'],
    price: 85000,
    unit: '件',
    status: 'active',
  },
  {
    code: 'BY-GJ-02',
    name: '中间辊总成',
    category: '精密零部件/辊系零部件',
    description: '多辊轧机的中间过渡辊组件，实现轧制力均匀传递与板形调节',
    specifications: {
      application: '二十辊/十二辊轧机',
      roller_diameter: 'Φ40~Φ300mm',
      roller_length: '300~2000mm',
      material: '9Cr2Mo / 高速钢',
      surface_hardness: 'HRC60~65',
      runout: '≤0.003mm',
    },
    features: ['超高同轴度', '轴向窜辊设计', '精密磨削', '长寿命'],
    price: 62000,
    unit: '件',
    status: 'active',
  },
  {
    code: 'BY-GJ-03',
    name: '夹送辊总成',
    category: '精密零部件/辊系零部件',
    description: '用于连续产线各段的带钢夹送与导向，保证穿带和稳定运行',
    specifications: {
      application: '连续酸洗/镀锌/彩涂线',
      roller_diameter: 'Φ150~Φ400mm',
      roller_length: '400~2100mm',
      surface_treatment: '覆胶/镀硬铬',
      surface_hardness: '橡胶HS70~85 / 镀铬HRC60',
      bearing: '高精度调心滚子轴承',
    },
    features: ['覆胶/镀铬可选', '间隙在线调节', '高承载轴承', '耐磨设计'],
    price: 38000,
    unit: '件',
    status: 'active',
  },

  // ============================================================
  // 2. 精密零部件 / 联轴器
  // ============================================================
  {
    code: 'BY-LZ-01',
    name: '球笼式等速万向联轴器（标准型）',
    category: '精密零部件/联轴器',
    description: '适用于冶金设备传动系统的球笼式等速联轴器，传递扭矩平稳、寿命长',
    specifications: {
      type: '球笼式等速万向',
      torque_max: '500kN·m',
      speed_max: '300r/min',
      shaft_diameter: 'Φ100~Φ400mm',
      angular_misalignment: '≤18°',
      material: '42CrMo',
      surface_treatment: '渗碳淬火',
    },
    features: ['等速传动', '大角度补偿', '低磨损', '免维护'],
    price: 75000,
    unit: '套',
    status: 'active',
  },
  {
    code: 'BY-LZ-02',
    name: '球笼式等速万向联轴器（重载型）',
    category: '精密零部件/联轴器',
    description: '重载型球笼联轴器，适用于大扭矩轧机主传动和飞剪传动',
    specifications: {
      type: '球笼式等速万向（重载）',
      torque_max: '1500kN·m',
      speed_max: '200r/min',
      shaft_diameter: 'Φ200~Φ600mm',
      angular_misalignment: '≤15°',
      material: '34CrNiMo6',
      surface_treatment: '渗碳淬火',
    },
    features: ['超大扭矩承载', '抗冲击设计', '精密锻造', '长寿命'],
    price: 168000,
    unit: '套',
    status: 'active',
  },

  // ============================================================
  // 2. 精密零部件 / 液压锁紧装置
  // ============================================================
  {
    code: 'BY-YS-01',
    name: '液压锁紧装置（标准型）',
    category: '精密零部件/液压锁紧装置',
    description: '用于轧机换辊、牌坊锁紧的液压锁紧缸，实现快速可靠锁紧',
    specifications: {
      application: '轧机/牌坊/滑轨锁紧',
      clamping_force: '200kN',
      stroke: '50mm',
      working_pressure: '25MPa',
      medium: '液压油',
      control: '电液比例',
    },
    features: ['电液比例控制', '快速锁紧/释放', '位置反馈', '安全冗余'],
    price: 58000,
    unit: '套',
    status: 'active',
  },
  {
    code: 'BY-YS-02',
    name: '液压锁紧装置（重载型）',
    category: '精密零部件/液压锁紧装置',
    description: '重载型液压锁紧装置，适用于大型轧机牌坊和重型设备定位锁紧',
    specifications: {
      application: '大型轧机/重型设备锁紧',
      clamping_force: '500kN',
      stroke: '120mm',
      working_pressure: '31.5MPa',
      medium: '液压油',
      control: 'PLC闭环',
    },
    features: ['PLC闭环控制', '高压密封', '重载导向', '在线监测'],
    price: 125000,
    unit: '套',
    status: 'active',
  },

  // ============================================================
  // 3. 燃油输送装置
  // ============================================================
  {
    code: 'BY-RY-01',
    name: '燃油输送泵组（轻油型）',
    category: '燃油输送装置',
    description: '适用于柴油/煤油的成套输送泵组系统，含泵、阀门、过滤和控制',
    specifications: {
      flow_rate: '50m³/h',
      head: '35m',
      medium: '柴油/煤油',
      power: '7.5kW',
      filtration: '10μm',
      control: '变频恒压',
    },
    features: ['变频恒压控制', '多级过滤', '防爆设计', '撬装一体化'],
    price: 65000,
    unit: '套',
    status: 'active',
  },
  {
    code: 'BY-RY-02',
    name: '航空燃油输送系统',
    category: '燃油输送装置',
    description: '适用于航空煤油（Jet A-1）的高洁净度专用输送系统，满足航空级洁净要求',
    specifications: {
      flow_rate: '100m³/h',
      head: '45m',
      medium: '航空煤油',
      power: '15kW',
      filtration: '5μm / 1μm 双级',
      control: 'PLC全自动',
    },
    features: ['航空级洁净度', '双级精密过滤', '全自动PLC控制', '防静电设计'],
    price: 185000,
    unit: '套',
    status: 'active',
  },
];

/**
 * 产品分类（扁平，保持兼容）
 */
export const PRODUCT_CATEGORIES = [
  {
    code: 'SJ',
    name: '板带精整装备/矫直设备',
    description: '拉弯矫直、破鳞、多辊矫直',
    sortOrder: 1,
  },
  {
    code: 'QJ',
    name: '板带精整装备/剪切设备',
    description: '圆盘剪、飞剪、碎边剪',
    sortOrder: 2,
  },
  {
    code: 'GT',
    name: '板带精整装备/辊涂设备',
    description: '镀锌辊涂、彩涂辊涂',
    sortOrder: 3,
  },
  {
    code: 'GJ',
    name: '精密零部件/辊系零部件',
    description: '工作辊、中间辊、夹送辊',
    sortOrder: 4,
  },
  {
    code: 'LZ',
    name: '精密零部件/联轴器',
    description: '球笼式等速万向联轴器',
    sortOrder: 5,
  },
  {
    code: 'YS',
    name: '精密零部件/液压锁紧装置',
    description: '液压锁紧缸',
    sortOrder: 6,
  },
  {
    code: 'RY',
    name: '燃油输送装置',
    description: '燃油/航空煤油输送系统',
    sortOrder: 7,
  },
];
