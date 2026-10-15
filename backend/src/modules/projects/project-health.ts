/**
 * 项目健康度规则（纯函数，编辑时重算与每日定时重算共用一份）。
 *
 * 原规则只看"阶段逾期 / 风险等级 / 7 天内到期"，而且只在编辑项目时才算：
 * 计划完工日早已过去、进度 0% 的项目照样显示"健康"；健康度为空的也被页面当成健康。
 *
 *   红：项目计划完工已过且未完成 · 有阶段逾期未完成 · 有未关闭的高风险
 *   黄：距计划完工 ≤ 7 天且进度 < 80% · 有未关闭的中风险
 *   绿：其余；已完成的项目一律绿
 */
export type Health = 'red' | 'yellow' | 'green';

export interface HealthInput {
  status?: string | null;
  progress?: number | null;
  endDate?: Date | string | null;
  stages?: Array<{ status?: string | null; endDate?: Date | string | null }>;
  /** 只传未关闭的风险 */
  risks?: Array<{ level?: string | null }>;
  now?: Date;
}

const DONE = new Set(['done', 'completed', '已完成']);
const DAY = 86400000;

export function evaluateHealth(p: HealthInput): { health: Health; reason: string } {
  const now = (p.now ?? new Date()).getTime();
  const progress = Number(p.progress || 0);
  if (DONE.has(String(p.status || '')) || progress >= 100) return { health: 'green', reason: '已完成' };

  const end = p.endDate ? new Date(p.endDate).getTime() : NaN;
  if (!Number.isNaN(end) && end < now - DAY / 2) {
    const days = Math.floor((now - end) / DAY);
    return { health: 'red', reason: `计划完工已过 ${Math.max(days, 1)} 天，进度 ${progress}%` };
  }
  const overdueStage = (p.stages || []).find(
    (s) => s.endDate && new Date(s.endDate).getTime() < now - DAY / 2 && !DONE.has(String(s.status || '')),
  );
  if (overdueStage) return { health: 'red', reason: '有阶段逾期未完成' };
  if ((p.risks || []).some((r) => r.level === 'high' || r.level === '严重' || r.level === '高')) {
    return { health: 'red', reason: '有未关闭的高风险' };
  }
  if (!Number.isNaN(end) && end - now <= 7 * DAY && progress < 80) {
    return { health: 'yellow', reason: `距计划完工不足 7 天，进度 ${progress}%` };
  }
  if ((p.risks || []).some((r) => r.level === 'medium' || r.level === '中')) {
    return { health: 'yellow', reason: '有未关闭的中风险' };
  }
  return { health: 'green', reason: '' };
}
