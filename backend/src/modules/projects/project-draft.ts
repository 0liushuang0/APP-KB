/**
 * 合同 → 项目的草稿（纯函数，可测）。
 *
 * 原来立项弹窗里开工日、计划完工、项目类型、阶段全空。现在：
 *   开工日 = 合同签约日（没有用生效日、再没有用今天）
 *   计划完工 = 合同交货期（没有就按报价的交货期天数从开工日推算）
 *   项目类型 = 按需求类型映射（含「技改」→ 技改；含「服务/维修」→ 服务；其余 → 设备制造）
 *   阶段 = 系统设置「project_stage_template」的标准阶段，按占比把开工→完工切开
 */
export const DEFAULT_STAGE_TEMPLATE = '设计:15, 采购:20, 制造:25, 装配:10, 出厂验收:5, 发运:5, 安装调试:15, 终验收:5';

export function parseStageTemplate(raw?: string | null): Array<{ name: string; weight: number }> {
  const src = (raw || '').trim() || DEFAULT_STAGE_TEMPLATE;
  const rows = src
    .split(/[,，\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const [name, w] = x.split(/[:：]/).map((y) => y.trim());
      return { name, weight: Math.max(Number(w) || 1, 0.1) };
    })
    .filter((x) => x.name);
  return rows.length ? rows : parseStageTemplate(DEFAULT_STAGE_TEMPLATE);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function projectTypeFrom(requirementType?: string | null): string {
  const t = requirementType || '';
  if (t.includes('技改')) return '技改';
  if (t.includes('服务') || t.includes('维修')) return '服务';
  return '设备制造';
}

export function buildProjectDraft(input: {
  title?: string | null;
  customerId?: string | null;
  signedDate?: any;
  effectiveDate?: any;
  deliveryDate?: any;
  deliveryDays?: number | null;
  requirementType?: string | null;
  template?: string | null;
  today?: Date;
}) {
  const today = input.today ?? new Date();
  const startRaw = input.signedDate || input.effectiveDate;
  const start = startRaw ? new Date(startRaw) : today;
  let end: Date | null = input.deliveryDate ? new Date(input.deliveryDate) : null;
  if (!end && input.deliveryDays && input.deliveryDays > 0) end = new Date(start.getTime() + input.deliveryDays * 86400000);

  const tpl = parseStageTemplate(input.template);
  const total = tpl.reduce((s, x) => s + x.weight, 0);
  const span = end ? Math.max(end.getTime() - start.getTime(), 86400000) : 0;
  let cursor = start.getTime();
  const stages = tpl.map((x, i) => {
    if (!end) return { name: x.name, startDate: '', endDate: '', status: 'pending', description: '' };
    const len = i === tpl.length - 1 ? end.getTime() - cursor : Math.round((span * x.weight) / total);
    const s = new Date(cursor);
    const e = new Date(cursor + Math.max(len, 0));
    cursor = e.getTime();
    return { name: x.name, startDate: iso(s), endDate: iso(e), status: 'pending', description: '' };
  });

  return {
    name: input.title || '',
    customerId: input.customerId || '',
    startDate: iso(start),
    endDate: end ? iso(end) : '',
    projectType: projectTypeFrom(input.requirementType),
    stages,
    sources: {
      startDate: input.signedDate ? '合同签约日' : input.effectiveDate ? '合同生效日' : '今天',
      endDate: input.deliveryDate ? '合同交货期' : end ? `开工日 + 报价交货期 ${input.deliveryDays} 天` : '',
    },
  };
}
