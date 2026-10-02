/**
 * 可选唯一字段的空值归一化。
 *
 * 「产品编号」这类字段是 `nullable: true` + `unique`。表单不填时前端送来的是
 * 空字符串 `''` —— 而 `''` 在数据库看来是一个**具体的值**，不是空：
 * 第一条空编号能存进去，第二条就撞 UNIQUE 约束，用户得到一句
 * 「Internal server error」，而他其实只是没填一个选填项。
 *
 * NULL 则不参与唯一性比较（SQLite 与 PostgreSQL 都是如此），
 * 所以留空必须转成 NULL，多少条都不冲突。
 */
export function normalizeUniqueOptional(value?: string | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}
