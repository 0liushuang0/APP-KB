#!/usr/bin/env node
/**
 * 本地一站式校验（提交前跑一遍 = CI 同款）：
 *   后端 tsc + jest + build；前端 tsc + build。
 * 修复了本会话多次出现的"改了后端忘 rebuild/忘重启"类隐患。
 *
 * 用法：node scripts/verify-all.mjs [--skip-tests]
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skipTests = process.argv.includes('--skip-tests');

const steps = [];
const be = (name, cmd) => steps.push({ name, cwd: path.join(root, 'backend'), cmd });
const fe = (name, cmd) => steps.push({ name, cwd: path.join(root, 'frontend'), cmd });

be('后端类型检查', 'npx tsc -p tsconfig.json --noEmit');
if (!skipTests) be('后端测试', 'npx jest --no-coverage');
be('后端构建', 'npm run build');
fe('前端类型检查', 'npx tsc --noEmit');
fe('前端构建', 'npm run build');

let failed = 0;
for (const s of steps) {
  process.stdout.write(`\n▶ ${s.name} … `);
  const r = spawnSync(s.cmd, { cwd: s.cwd, shell: true, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`✗ ${s.name} 失败（退出码 ${r.status}）`);
    failed = r.status ?? 1;
    break;
  } else {
    console.log('✓');
  }
}
console.log(failed ? `\n✗ 校验未通过` : `\n✓ 全部通过（${steps.length} 步）`);
process.exit(failed);
