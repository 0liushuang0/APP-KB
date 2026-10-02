# 依赖安全审计记录

> 2026-09-29 · registry: registry.npmjs.org（npmmirror 镜像不支持 audit 接口，需 `--registry=https://registry.npmjs.org`）

## 结果总览

| 端 | 修复前 | 修复后 | 处置 |
|---|---|---|---|
| backend | 47（1 critical / 24 high） | **35（0 critical / 15 high）** | `npm audit fix` + tar 强制升级到 7.5.22（devDependencies 直接依赖 + `overrides: {"tar": "$tar"}` 供 bcrypt→node-pre-gyp 去重回指） |
| frontend | 19（12 high） | **11（8 high）** | `npm audit fix` |

## 已消除的最高危项

- **tar ≤7.5.20（critical）**：8 条路径穿越/任意文件覆盖通告。运行时 tar 实际只被 bcrypt 的原生二进制预下载器 node-pre-gyp 使用（构建期），但按 critical 处理：全树统一 7.5.22。
- 其余 safe-fix 级别（qs DoS、@mapbox/node-pre-gyp 等 12 项）随 `audit fix` 一并解决。

## 剩余项说明（均为破坏性升级，本轮不动）

- backend 15 high：@typescript-eslint 全家桶（jest/eslint 传递，升级需整套 ESLint 大版本）、multer 2.x（Nest 10 适配待验证）、xlsx 原型污染（上游无补丁版本，SheetJS 官方源另行评估）、lodash/glob/minimatch 旧版本（dev 工具链传递）。
- frontend 8 high：vite/rollup 传递链（升级需 Vite 6 大版本迁移）。
- 处置策略：随下一次框架大版本升级（Nest 11 / Vite 6 / ESLint 9）一次性解决；CI 中已加入 `npm audit --audit-level=critical` 门禁（critical 出现即阻断）。

## 复测命令

```bash
cd backend  && npm audit --registry=https://registry.npmjs.org
cd frontend && npm audit --registry=https://registry.npmjs.org
```
