/**
 * date 列的显示格式化。
 *
 * PG 的 date 列经实体 hydrate / 驱动读取会变成带时区的 Date（本地零点 →
 * UTC 前一天 16:00Z），JSON 序列化后前端 slice(0,10) 会**差一天**。
 * 列表接口对 date 类字段统一转成本地时区 YYYY-MM-DD 字符串输出，
 * 与录入值严格一致；raw 查询侧则直接用 SQL to_char 达到同样效果。
 */
export const toLocalDate = (v: unknown): string | null => {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v as string);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
