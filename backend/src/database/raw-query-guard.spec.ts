import * as fs from 'fs';
import * as path from 'path';

/**
 * 守卫：裸 createQueryBuilder 里的驼峰 SQL 别名。
 *
 * 2026-10-14 一次性修了 60+ 处 `AS customerName` 没加引号的问题 ——
 * PG 会把不带引号的别名折叠成小写，getRawOne 回来全是 undefined，
 * 界面上客户/项目名整片变空。SQLite 不折叠所以切库前无感，集中爆发。
 *
 * 别名这条规则零误报可静态判定：带实体 qb 的 select 全用属性名或
 * `AS "xxx"`（双引号），出现 `AS camelCase'`（引号字符串里裸驼峰）
 * 一律是裸 qb 的写法。join/where 的驼峰列引用存在合法的带实体用法，
 * 不在此扫描（靠人工评审 + 契约测试兜底）。
 */

const SRC_ROOT = path.resolve(__dirname, '..', 'src');

function* walk(dir: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // 无权限/特殊目录（IDE 缓存等）不阻塞扫描
  }
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) yield p;
  }
}

/** `AS xxx'` 中 xxx 含大写字母且整体没被双引号包住（"xxx" 形式是正确写法） */
const UNQUOTED_CAMEL_ALIAS = /AS\s+[A-Za-z]+[A-Z][A-Za-z]*'/g;

describe('守卫：裸查询的驼峰别名必须加引号（PG 折叠小写问题）', () => {
  it('src 下不存在 `AS camelCase\'` 形式的别名', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC_ROOT)) {
      const rel = path.relative(SRC_ROOT, file);
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        // 排除注释行与正确写法 AS "xxx"
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        const matches = line.match(UNQUOTED_CAMEL_ALIAS);
        if (matches) offenders.push(`${rel}:${i + 1}  ${matches.join(' , ')}`);
      });
    }
    if (offenders.length) {
      throw new Error(
        `发现 ${offenders.length} 处未加引号的驼峰别名（PG 下会折叠成小写，查询结果键名对不上）：\n` +
          offenders.join('\n') +
          `\n改法：AS customerName → AS "customerName"`,
      );
    }
  });
});
