import type { CalcSchema } from '../entities/calc.entity';

/**
 * 内置计算模板种子数据。
 *
 * ⚠️ 重要：以下公式与系数为**占位示例**，依据公开经验公式编写，
 * 上线前必须由博亚精工技术部逐条核对并书面确认。
 * 模板可在「计算工具 → 管理模板」中直接编辑公式，无需改代码。
 *
 * 每条 notes 都标注了公式来源与待确认项。
 */

export interface CalcTemplateSeed {
  code: string;
  name: string;
  category: string;
  icon: string;
  description: string;
  sortOrder: number;
  schema: CalcSchema;
}

export const CALC_TEMPLATE_SEEDS: CalcTemplateSeed[] = [
  // ══════════════════════════════════════════════════════════
  // 1. 产能计算 —— 全产品线通用
  // ══════════════════════════════════════════════════════════
  {
    code: 'line_capacity',
    name: '产能计算',
    category: '通用',
    icon: 'Gauge',
    description: '按带钢规格与线速度计算产线理论产能，含作业率与机时利用率修正',
    sortOrder: 1,
    schema: {
      inputs: [
        { key: 'thickness', label: '带钢厚度', type: 'number', unit: 'mm', min: 0.1, max: 25, required: true, group: '来料参数', hint: '按典型规格取值，非极限值' },
        { key: 'width', label: '带钢宽度', type: 'number', unit: 'mm', min: 100, max: 2500, required: true, group: '来料参数' },
        { key: 'density', label: '材料密度', type: 'number', unit: 'kg/m³', default: 7850, required: true, group: '来料参数', hint: '碳钢 7850，不锈钢 7930，铝 2700' },
        { key: 'lineSpeed', label: '平均线速度', type: 'number', unit: 'm/min', min: 1, max: 1200, required: true, group: '工艺参数', hint: '取平均值而非最高速度' },
        { key: 'utilization', label: '机时利用率', type: 'number', unit: '%', default: 85, min: 1, max: 100, required: true, group: '工艺参数', hint: '扣除换辊、待料等停机' },
        { key: 'yieldRate', label: '成材率', type: 'number', unit: '%', default: 97, min: 1, max: 100, group: '工艺参数' },
        { key: 'shiftHours', label: '班次工时', type: 'number', unit: 'h', default: 8, required: true, group: '生产制度' },
        { key: 'shiftsPerDay', label: '每日班次', type: 'number', unit: '班', default: 3, required: true, group: '生产制度' },
        { key: 'workDays', label: '年工作日', type: 'number', unit: '天', default: 330, required: true, group: '生产制度' },
      ],
      formulas: [
        { key: 'weightPerMeter', label: '每米重量', unit: 'kg/m', expr: 'thickness * width * density / 1000000', digits: 3 },
        { key: 'theoreticalHourly', label: '理论小时产量', unit: 't/h', expr: 'weightPerMeter * lineSpeed * 60 / 1000', digits: 2 },
        { key: 'actualHourly', label: '有效小时产量', unit: 't/h', expr: 'theoreticalHourly * utilization / 100 * yieldRate / 100', digits: 2 },
        { key: 'perShift', label: '班产量', unit: 't/班', expr: 'actualHourly * shiftHours', digits: 1 },
        { key: 'perDay', label: '日产量', unit: 't/天', expr: 'perShift * shiftsPerDay', digits: 1 },
        { key: 'annual', label: '年产能', unit: '万吨/年', expr: 'round(perDay * workDays / 10000, 2)', digits: 2 },
      ],
      outputs: ['actualHourly', 'perShift', 'perDay', 'annual'],
      notes: '公式来源：质量流量基本关系式（断面积 × 密度 × 线速度）。⚠️ 机时利用率与成材率的取值口径待技术部确认。',
    },
  },

  // ══════════════════════════════════════════════════════════
  // 2. 矫直机配置计算 —— 对应 STRAIGHTENING 参数模板
  // ══════════════════════════════════════════════════════════
  {
    code: 'straightener_config',
    name: '矫直机配置计算',
    category: '矫直设备',
    icon: 'Ruler',
    description: '按来料规格与屈服强度估算矫直力、压下量、驱动扭矩与电机功率',
    sortOrder: 2,
    schema: {
      inputs: [
        { key: 'thickness', label: '带钢厚度', type: 'number', unit: 'mm', min: 0.1, max: 25, required: true, group: '来料参数' },
        { key: 'width', label: '带钢宽度', type: 'number', unit: 'mm', min: 100, max: 2500, required: true, group: '来料参数' },
        { key: 'yieldStrength', label: '屈服强度', type: 'number', unit: 'MPa', min: 100, max: 1500, default: 345, required: true, group: '来料参数', hint: '按上限牌号取值' },
        { key: 'elasticModulus', label: '弹性模量', type: 'number', unit: 'MPa', default: 206000, required: true, group: '来料参数' },
        { key: 'rollDiameter', label: '矫直辊直径', type: 'number', unit: 'mm', min: 20, max: 600, required: true, group: '设备参数' },
        { key: 'rollPitch', label: '辊距', type: 'number', unit: 'mm', min: 20, max: 800, required: true, group: '设备参数' },
        { key: 'rollCount', label: '矫直辊数', type: 'number', unit: '辊', default: 9, min: 5, max: 23, required: true, group: '设备参数' },
        { key: 'lineSpeed', label: '矫直速度', type: 'number', unit: 'm/min', default: 60, required: true, group: '工艺参数' },
        { key: 'frictionCoef', label: '传动摩擦系数', type: 'number', default: 0.05, group: '工艺参数', hint: '含轴承与传动损失' },
        { key: 'efficiency', label: '传动效率', type: 'number', unit: '%', default: 85, min: 30, max: 100, group: '工艺参数' },
      ],
      formulas: [
        { key: 'sectionModulus', label: '截面抗弯模量', unit: 'mm³', expr: 'width * thickness ^ 2 / 6', digits: 1 },
        { key: 'yieldMoment', label: '弹性极限弯矩', unit: 'N·m', expr: 'yieldStrength * sectionModulus / 1000', digits: 1 },
        { key: 'plasticMoment', label: '全塑性弯矩', unit: 'N·m', expr: 'yieldMoment * 1.5', digits: 1 },
        { key: 'curvatureRatio', label: '相对曲率比', expr: 'round(rollPitch ^ 2 * yieldStrength / (elasticModulus * thickness * rollDiameter) * 100, 3)', digits: 3 },
        // 4·M/L：M 为 N·m、L 为 mm，两次单位换算（mm→m、N→kN）恰好抵消
        { key: 'singleRollForce', label: '单辊矫直力', unit: 'kN', expr: 'round(4 * plasticMoment / rollPitch, 2)', digits: 2 },
        { key: 'totalForce', label: '总矫直力', unit: 'kN', expr: 'round(singleRollForce * (rollCount - 2), 1)', digits: 1 },
        { key: 'reduction', label: '首辊压下量', unit: 'mm', expr: 'round(rollPitch ^ 2 * yieldStrength / (2 * elasticModulus * thickness), 3)', digits: 3 },
        { key: 'torque', label: '驱动扭矩', unit: 'N·m', expr: 'round(totalForce * 1000 * frictionCoef * rollDiameter / 2000, 1)', digits: 1 },
        { key: 'power', label: '电机功率', unit: 'kW', expr: 'round(torque * lineSpeed / (rollDiameter / 1000 * PI) / 9550 / (efficiency / 100), 2)', digits: 2, warnAbove: 500 },
      ],
      outputs: ['totalForce', 'singleRollForce', 'reduction', 'torque', 'power'],
      notes: '公式来源：弹塑性弯曲理论（全塑性弯矩取弹性极限弯矩 1.5 倍，矩形截面理论值）。⚠️ 摩擦系数、压下量分配曲线、辊数修正系数均需技术部按实际机型标定。',
    },
  },

  // ══════════════════════════════════════════════════════════
  // 3. 圆盘剪配置计算 —— 对应 SHEARING 参数模板
  // ══════════════════════════════════════════════════════════
  {
    code: 'disc_shear_config',
    name: '圆盘剪配置计算',
    category: '剪切设备',
    icon: 'Scissors',
    description: '按带钢规格计算刀片侧间隙、重合量、剪切力、刀轴扭矩与电机功率',
    sortOrder: 3,
    schema: {
      inputs: [
        { key: 'thickness', label: '带钢厚度', type: 'number', unit: 'mm', min: 0.1, max: 20, required: true, group: '来料参数' },
        { key: 'width', label: '带钢宽度', type: 'number', unit: 'mm', min: 100, max: 2500, group: '来料参数' },
        { key: 'tensileStrength', label: '抗拉强度', type: 'number', unit: 'MPa', min: 150, max: 1800, default: 450, required: true, group: '来料参数' },
        { key: 'shearCoef', label: '抗剪系数', type: 'number', default: 0.6, min: 0.4, max: 0.9, required: true, group: '来料参数', hint: '抗剪强度 / 抗拉强度，碳钢约 0.6' },
        { key: 'clearanceRatio', label: '侧间隙系数', type: 'number', default: 0.08, min: 0.02, max: 0.2, required: true, group: '刀具参数', hint: '侧间隙 = 系数 × 板厚' },
        { key: 'overlapRatio', label: '重合量系数', type: 'number', default: 0.15, min: 0, max: 0.5, group: '刀具参数' },
        { key: 'bladeDiameter', label: '刀片直径', type: 'number', unit: 'mm', min: 50, max: 800, default: 250, required: true, group: '刀具参数' },
        { key: 'cutCount', label: '同时剪切边数', type: 'number', unit: '边', default: 2, min: 1, max: 4, required: true, group: '刀具参数' },
        { key: 'lineSpeed', label: '剪切线速度', type: 'number', unit: 'm/min', default: 80, required: true, group: '工艺参数' },
        { key: 'efficiency', label: '传动效率', type: 'number', unit: '%', default: 85, min: 30, max: 100, group: '工艺参数' },
      ],
      formulas: [
        { key: 'shearStrength', label: '抗剪强度', unit: 'MPa', expr: 'tensileStrength * shearCoef', digits: 1 },
        { key: 'clearance', label: '刀片侧间隙', unit: 'mm', expr: 'round(thickness * clearanceRatio, 3)', digits: 3 },
        { key: 'overlap', label: '刀片重合量', unit: 'mm', expr: 'round(thickness * overlapRatio, 3)', digits: 3 },
        { key: 'contactLength', label: '剪切接触弧长', unit: 'mm', expr: 'round(sqrt(bladeDiameter * thickness), 2)', digits: 2 },
        { key: 'singleForce', label: '单边剪切力', unit: 'kN', expr: 'round(shearStrength * thickness * contactLength / 1000, 2)', digits: 2 },
        { key: 'totalForce', label: '总剪切力', unit: 'kN', expr: 'round(singleForce * cutCount, 2)', digits: 2 },
        { key: 'torque', label: '刀轴扭矩', unit: 'N·m', expr: 'round(totalForce * 1000 * bladeDiameter / 2000, 1)', digits: 1 },
        { key: 'rpm', label: '刀轴转速', unit: 'r/min', expr: 'round(lineSpeed * 1000 / (PI * bladeDiameter), 1)', digits: 1 },
        { key: 'power', label: '电机功率', unit: 'kW', expr: 'round(torque * rpm / 9550 / (efficiency / 100), 2)', digits: 2, warnAbove: 400 },
      ],
      outputs: ['clearance', 'overlap', 'totalForce', 'torque', 'rpm', 'power'],
      notes: '公式来源：金属塑性加工剪切力经验式（接触弧长按 √(D·t) 近似）。⚠️ 抗剪系数、侧间隙系数需按具体钢种与刀具材质由技术部标定。',
    },
  },

  // ══════════════════════════════════════════════════════════
  // 4. 液压螺母设计计算 —— 对应 HYDRAULIC_LOCKING 参数模板
  // ══════════════════════════════════════════════════════════
  {
    code: 'hydraulic_nut_design',
    name: '液压螺母设计计算',
    category: '液压锁紧装置',
    icon: 'Lock',
    description: '按锁紧力反算所需油压、活塞面积、螺纹应力与密封选型',
    sortOrder: 4,
    schema: {
      inputs: [
        { key: 'lockForce', label: '所需锁紧力', type: 'number', unit: 'kN', min: 10, max: 20000, required: true, group: '设计要求' },
        { key: 'safetyFactor', label: '安全系数', type: 'number', default: 1.25, min: 1, max: 3, required: true, group: '设计要求' },
        { key: 'workPressure', label: '系统工作压力', type: 'number', unit: 'MPa', default: 63, min: 5, max: 200, required: true, group: '液压参数', hint: '常用 63 / 70 / 100 MPa' },
        { key: 'pistonOuterD', label: '活塞外径', type: 'number', unit: 'mm', min: 20, max: 1500, required: true, group: '结构参数' },
        { key: 'pistonInnerD', label: '活塞内径', type: 'number', unit: 'mm', min: 10, max: 1400, required: true, group: '结构参数' },
        { key: 'stroke', label: '设计行程', type: 'number', unit: 'mm', default: 6, min: 1, max: 100, group: '结构参数' },
        { key: 'threadMajorD', label: '螺纹公称直径', type: 'number', unit: 'mm', min: 10, max: 1200, required: true, group: '螺纹参数' },
        { key: 'threadPitch', label: '螺距', type: 'number', unit: 'mm', default: 4, min: 0.5, max: 20, required: true, group: '螺纹参数' },
        { key: 'threadAllowStress', label: '螺纹许用应力', type: 'number', unit: 'MPa', default: 180, min: 50, max: 600, group: '螺纹参数' },
      ],
      formulas: [
        { key: 'designForce', label: '设计锁紧力', unit: 'kN', expr: 'round(lockForce * safetyFactor, 2)', digits: 2 },
        { key: 'pistonArea', label: '活塞有效面积', unit: 'mm²', expr: 'round(PI / 4 * (pistonOuterD ^ 2 - pistonInnerD ^ 2), 1)', digits: 1 },
        { key: 'requiredPressure', label: '所需油压', unit: 'MPa', expr: 'round(designForce * 1000 / pistonArea, 2)', digits: 2 },
        { key: 'pressureMargin', label: '压力裕度', unit: '%', expr: 'round((workPressure - requiredPressure) / workPressure * 100, 1)', digits: 1, warnBelow: 10 },
        { key: 'actualForce', label: '额定压力下出力', unit: 'kN', expr: 'round(workPressure * pistonArea / 1000, 2)', digits: 2 },
        { key: 'threadStressArea', label: '螺纹应力截面积', unit: 'mm²', expr: 'round(PI / 4 * (threadMajorD - 0.9382 * threadPitch) ^ 2, 1)', digits: 1 },
        { key: 'threadStress', label: '螺纹拉应力', unit: 'MPa', expr: 'round(designForce * 1000 / threadStressArea, 2)', digits: 2 },
        { key: 'threadSafety', label: '螺纹安全系数', expr: 'round(threadAllowStress / threadStress, 2)', digits: 2, warnBelow: 1.2 },
        { key: 'oilVolume', label: '单次充油量', unit: 'mL', expr: 'round(pistonArea * stroke / 1000, 2)', digits: 2 },
      ],
      outputs: ['designForce', 'pistonArea', 'requiredPressure', 'pressureMargin', 'threadStress', 'threadSafety', 'oilVolume'],
      notes: '公式来源：液压缸出力公式 F=p·A；螺纹应力截面积按 GB/T 16823.1 近似式 (d - 0.9382P)。⚠️ 许用应力需按实际材质与热处理状态取值，密封形式选型未纳入本表。',
    },
  },

  // ══════════════════════════════════════════════════════════
  // 5. 联轴器选型计算 —— 对应 BY-LZ 球笼式等速万向联轴器
  // ══════════════════════════════════════════════════════════
  {
    code: 'coupling_selection',
    name: '联轴器选型计算',
    category: '联轴器',
    icon: 'Link',
    description: '按传递功率与转速计算理论扭矩、工况修正扭矩与所需许用扭矩',
    sortOrder: 5,
    schema: {
      inputs: [
        { key: 'power', label: '传递功率', type: 'number', unit: 'kW', min: 0.1, max: 20000, required: true, group: '传动参数' },
        { key: 'rpm', label: '工作转速', type: 'number', unit: 'r/min', min: 1, max: 20000, required: true, group: '传动参数' },
        {
          key: 'serviceFactor',
          label: '工况系数 K',
          type: 'enum',
          default: 1.5,
          required: true,
          group: '工况参数',
          options: [
            { value: 1.0, label: '1.0 均匀载荷（离心泵、风机）' },
            { value: 1.3, label: '1.3 轻微冲击（压缩机、机床）' },
            { value: 1.5, label: '1.5 中等冲击（轧机辅传动）' },
            { value: 1.8, label: '1.8 较大冲击（轧机主传动）' },
            { value: 2.5, label: '2.5 强冲击（剪切机、破碎机）' },
          ],
          hint: '按 GB/T 12458 载荷分类选取',
        },
        { key: 'startFactor', label: '启动系数', type: 'number', default: 1.2, min: 1, max: 3, group: '工况参数', hint: '频繁启停取大值' },
        { key: 'tempFactor', label: '温度系数', type: 'number', default: 1.0, min: 1, max: 1.5, group: '工况参数' },
        { key: 'angleDeg', label: '工作偏角', type: 'number', unit: '°', default: 3, min: 0, max: 45, group: '安装参数' },
        { key: 'shaftDistance', label: '轴间距', type: 'number', unit: 'mm', default: 500, group: '安装参数' },
        { key: 'candidateTorque', label: '待校核型号许用扭矩', type: 'number', unit: 'N·m', group: '选型校核', hint: '填入候选型号的额定扭矩以计算实际安全系数' },
      ],
      formulas: [
        { key: 'theoreticalTorque', label: '理论扭矩', unit: 'N·m', expr: 'round(9550 * power / rpm, 2)', digits: 2 },
        { key: 'calcTorque', label: '计算扭矩', unit: 'N·m', expr: 'round(theoreticalTorque * serviceFactor * startFactor * tempFactor, 2)', digits: 2 },
        { key: 'angleLoss', label: '偏角效率损失', unit: '%', expr: 'round((1 - cos(angleDeg * PI / 180)) * 100, 2)', digits: 2, warnAbove: 5 },
        { key: 'axialOffset', label: '偏角轴向补偿量', unit: 'mm', expr: 'round(shaftDistance * (1 - cos(angleDeg * PI / 180)), 2)', digits: 2 },
        { key: 'requiredTorque', label: '所需许用扭矩', unit: 'N·m', expr: 'round(calcTorque * 1.1, 2)', digits: 2 },
        { key: 'actualSafety', label: '实际安全系数', expr: 'round(if(candidateTorque > 0, candidateTorque / calcTorque, 0), 2)', digits: 2, warnBelow: 1.1, hint: '需 ≥ 1.1；填了候选型号扭矩才有意义' },
      ],
      outputs: ['theoreticalTorque', 'calcTorque', 'requiredTorque', 'angleLoss', 'axialOffset', 'actualSafety'],
      notes: '公式来源：T=9550·P/n；工况系数分类参考 GB/T 12458。⚠️ 球笼式等速万向联轴器的偏角-寿命修正曲线未纳入，重载工况请另行校核。',
    },
  },
];
