#!/usr/bin/env node
/**
 * 一键自检：类型检查 + 后端 jest + 前端 vitest + AI 服务 pytest。
 *
 *   node scripts/verify.mjs            全部
 *   node scripts/verify.mjs backend    只跑某一部分(backend / frontend / ai)
 *
 * 全部通过退出码为 0，否则非 0 —— 可挂到提交前钩子、计划任务或任何 CI 上。
 * 每一步独立运行并汇总，一步失败不会掩盖其它步骤的结果。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = process.platform === 'win32';
const npx = win ? 'npx.cmd' : 'npx';
const venvPy = path.join(root, 'ai-service', 'venv', win ? 'Scripts/python.exe' : 'bin/python');
const py = fs.existsSync(venvPy) ? venvPy : 'python';

const STEPS = [
  { group: 'backend', name: '后端 类型检查', cwd: 'backend', cmd: npx, args: ['tsc', '--noEmit', '-p', 'tsconfig.json'] },
  { group: 'backend', name: '后端 单元测试', cwd: 'backend', cmd: npx, args: ['jest', '--silent', '--maxWorkers=50%'] },
  { group: 'frontend', name: '前端 类型检查', cwd: 'frontend', cmd: npx, args: ['tsc', '--noEmit'] },
  { group: 'frontend', name: '前端 单元测试', cwd: 'frontend', cmd: npx, args: ['vitest', 'run'] },
  { group: 'ai', name: 'AI 服务 测试', cwd: 'ai-service', cmd: py, args: ['-m', 'pytest', '-q', 'tests', '-p', 'no:warnings'] },
];

const only = process.argv[2];
const steps = STEPS.filter((s) => !only || s.group === only);
const results = [];
for (const s of steps) {
  const t = Date.now();
  process.stdout.write(`\n▶ ${s.name} …\n`);
  const r = spawnSync(s.cmd, s.args, { cwd: path.join(root, s.cwd), stdio: 'inherit', shell: win });
  results.push({ name: s.name, ok: r.status === 0, sec: ((Date.now() - t) / 1000).toFixed(0) });
}
console.log('\n════ 汇总 ════');
for (const r of results) console.log(`${r.ok ? '✔' : '✘'} ${r.name}（${r.sec}s）`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
