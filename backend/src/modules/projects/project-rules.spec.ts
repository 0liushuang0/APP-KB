import { evaluateHealth } from './project-health';
import { buildProjectDraft, parseStageTemplate, projectTypeFrom, DEFAULT_STAGE_TEMPLATE } from './project-draft';

const now = new Date('2026-10-16T10:00:00');

describe('evaluateHealth', () => {
  it('a project past its planned end with 0% progress is red (it used to stay "healthy")', () => {
    const r = evaluateHealth({ status: 'ongoing', progress: 0, endDate: '2026-10-13', now });
    expect(r.health).toBe('red');
    expect(r.reason).toContain('计划完工已过 3 天');
  });

  it('overdue unfinished stage or open high risk is red', () => {
    expect(evaluateHealth({ endDate: '2027-01-01', stages: [{ status: 'pending', endDate: '2026-10-01' }], now }).health).toBe('red');
    expect(evaluateHealth({ endDate: '2027-01-01', risks: [{ level: 'high' }], now }).health).toBe('red');
  });

  it('within 7 days of the end with progress < 80% is yellow; medium risk is yellow', () => {
    expect(evaluateHealth({ endDate: '2026-10-20', progress: 40, now }).health).toBe('yellow');
    expect(evaluateHealth({ endDate: '2026-10-20', progress: 90, now }).health).toBe('green');
    expect(evaluateHealth({ endDate: '2027-01-01', risks: [{ level: 'medium' }], now }).health).toBe('yellow');
  });

  it('completed projects are always green, even if late', () => {
    expect(evaluateHealth({ status: 'completed', endDate: '2026-01-01', now }).health).toBe('green');
    expect(evaluateHealth({ progress: 100, endDate: '2026-01-01', now }).health).toBe('green');
  });

  it('a project ending today is not yet overdue', () => {
    expect(evaluateHealth({ endDate: '2026-10-16', progress: 90, now }).health).toBe('green');
  });
});

describe('buildProjectDraft', () => {
  it('start = signed date, end = contract delivery date, stages follow the template and cover the whole span', () => {
    const d = buildProjectDraft({ title: 'PL-单塔圆盘剪', signedDate: '2026-10-01', deliveryDate: '2027-01-29', requirementType: '新设备采购' });
    expect(d.startDate).toBe('2026-10-01');
    expect(d.endDate).toBe('2027-01-29');
    expect(d.projectType).toBe('设备制造');
    expect(d.stages.map((s) => s.name)).toEqual(['设计', '采购', '制造', '装配', '出厂验收', '发运', '安装调试', '终验收']);
    expect(d.stages[0].startDate).toBe('2026-10-01');
    expect(d.stages[d.stages.length - 1].endDate).toBe('2027-01-29');
    for (let i = 1; i < d.stages.length; i++) expect(d.stages[i].startDate).toBe(d.stages[i - 1].endDate);
    expect(d.sources).toEqual({ startDate: '合同签约日', endDate: '合同交货期' });
  });

  it('without a delivery date, end = start + quotation delivery days', () => {
    const d = buildProjectDraft({ signedDate: '2026-10-01', deliveryDays: 90 });
    expect(d.endDate).toBe('2026-12-30');
    expect(d.sources.endDate).toContain('90 天');
  });

  it('without any dates, starts today and leaves stage dates blank', () => {
    const d = buildProjectDraft({ today: now });
    expect(d.startDate).toBe('2026-10-16');
    expect(d.endDate).toBe('');
    expect(d.stages.every((s) => s.startDate === '' && s.endDate === '')).toBe(true);
  });

  it('template parsing tolerates Chinese punctuation and falls back to the default', () => {
    expect(parseStageTemplate('设计：30，制造：70').map((x) => x.name)).toEqual(['设计', '制造']);
    expect(parseStageTemplate('')).toEqual(parseStageTemplate(DEFAULT_STAGE_TEMPLATE));
    expect(projectTypeFrom('技改升级')).toBe('技改');
    expect(projectTypeFrom('维修服务')).toBe('服务');
  });
});
