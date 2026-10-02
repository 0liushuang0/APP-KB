# 商用就绪度审计：前端 / 后端 / 数据库

> 对象：博亚精工 AI 业务知识库（后端 15,576 行 · 前端 15,852 行 · AI 服务 4,847 行）
> 评审目标：**能否作为产品交付给客户安装使用并收费**
> 日期：2026-08-01

---

## 0. 结论

**当前是一套"能演示的内部原型"，距离"可交付的商用产品"还有明确差距。**

功能覆盖度已经不错（23 个后端模块、29 个前端页面、完整 RBAC + 审批 + 审计），
但有 **4 个硬阻断项** —— 不解决就无法交付：

| # | 阻断项 | 后果 |
|---|-------|------|
| 🚫 1 | **零数据库迁移** | `NODE_ENV=production` 时 synchronize 关闭、migrations 目录为空 → **生产环境启动后是一张表都没有的空库** |
| 🚫 2 | **文件上传路径穿越** | 客户端可控的 `originalname` 直接进 `path.join`，实测可写出上传目录之外 |
| 🚫 3 | **零服务端分页** | 8 个列表接口全部 `find()` 返回整表，前端再切片。数据过万即不可用 |
| 🚫 4 | **零跨表事务** | 报价+明细、供应商+产品等多表写入无原子性，中途失败留下孤儿数据 |

另有 **36,000 行代码仅 1 个测试文件**（我写的公式引擎，40 个用例）。
按商用标准，这个覆盖率不足以支撑对外承诺。

下面按层展开。

---

## 一、数据库层

### 1.1 🚫 阻断｜生产环境无法建表

```ts
// database.config.ts
synchronize: process.env.NODE_ENV !== 'production',   // 生产 = false
migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
```

```
src/database/
└── data-source.ts        ← 只有这一个文件
                          ← migrations/ 目录根本不存在
```

**开发时靠 `synchronize: true` 自动建表，生产时它被关掉，而迁移一个都没有。**
结果：客户拿到程序，连上空数据库，启动成功但所有接口报"表不存在"。

37 个实体全部没有版本化的 DDL。这也意味着**没有升级路径** ——
客户用了半年后你发新版加了字段，没有迁移脚本就只能让客户手工改库或清库重来。

**必须做**：
```bash
npm run migration:generate -- src/database/migrations/InitialSchema
```
生成初始迁移后，把 `synchronize` 在所有环境都设为 `false`，一律走迁移。
`package.json` 里 `migration:generate / migration:run / migration:revert` 三条命令已经写好了，只是从没用过。

### 1.2 🚫 阻断｜零事务

全库检索 `transaction` / `queryRunner` —— **0 处**。

典型风险点：
```ts
// quotations.service.ts create()
const saved = await this.quotationRepository.save(quotation);   // ① 报价头
await this.itemRepository.save(itemEntities);                    // ② 明细（若此处失败）
await this.approvalsService.create({...});                       // ③ 审批流
await this.sync(saved);                                          // ④ 知识库同步
```
②失败 → 库里留下一张没有明细的报价单，金额还在，业务上是脏数据。
同样的模式在 suppliers（+capabilities +products）、proposals（+versions）、
customers（+contacts +followUps）、requirements（+attachments）全都存在。

**必须做**：多表写入包进 `dataSource.transaction()`，AI 同步等非关键副作用移到事务外。

### 1.3 🔴 高｜索引严重不足

37 个实体，**14 个 `@Index`**，且其中 11 个是我在 P2/P3/P4 新加的。

缺索引的高频查询字段：
- `documents.customerId`（资料按客户过滤，最高频）
- `quotations.customerId` / `proposalId`
- `proposals.customerId` / `requirementId`
- `requirements.customerId` / `isCurrent`
- 所有表的 `status`、`createdAt`（列表默认按创建时间倒序）

SQLite 下几千行感觉不出来，切 PostgreSQL 上量后全表扫描会立刻暴露。

### 1.4 🔴 高｜仍在 SQLite(sqljs)，且没有备份机制

`sqljs` 是**把整个数据库读进内存**、靠 `autoSave` 定期落盘的驱动。
- 进程崩溃 = 最后一次 autoSave 之后的数据全丢
- 无并发写入能力
- 数据库文件损坏无检测、无恢复

`system/export` 只能导出 Excel（客户/方案/报价等几张表的部分字段），**不是备份** ——
它导不出附件、审计日志、计算记录，也无法还原。

**必须做**：
1. 切 PostgreSQL（compose 文件和迁移脚本我已备好，见 `scripts/migrate-sqlite-to-postgres.mjs`）
2. 加定时 `pg_dump` + 上传目录打包，保留 N 份
3. 提供"一键备份 / 一键还原"给客户自助操作

### 1.5 🟡 中｜JSON 存成字符串，无法查询

`structuredSpec`、`inputData`、`resultData`、`schema`、`costBreakdown`、`defaultConfig`
全是 `@Column({type:'text'})` 存 `JSON.stringify` 的结果。

后果：无法用 SQL 查"公称力大于 200 吨的需求"，只能全部取出来在 JS 里 parse 再过滤。
切 PG 后应改 `jsonb` + GIN 索引。

---

## 二、后端层

### 2.1 🚫 阻断｜文件上传路径穿越（已实测复现）

```ts
// documents.service.ts:136
this.validateFileExtension(file.originalname);          // 只查扩展名
const fileName = `${Date.now()}_${file.originalname}`;  // originalname 客户端可控
const filePath = path.join(this.uploadDir, fileName);   // 直接拼接
```

实测结果：

| originalname | 落盘路径 |
|---|---|
| `report.pdf` | `…/uploads/documents/1785…_report.pdf` ✓ |
| `../../../../Windows/Temp/evil.pdf` | **`D:\app\data\Windows\Temp\evil.pdf`** ⚠ 逃逸出上传目录 |

扩展名白名单挡不住这个 —— 攻击载荷本身就是 `.pdf` 结尾。
同样的代码在 `documents.service.ts` 出现 2 次，`requirements`、`products` 的附件上传也是同一写法。

**必须做**：
```ts
const safe = path.basename(file.originalname).replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
const filePath = path.join(this.uploadDir, `${Date.now()}_${safe}`);
// 落盘前再断言：path.resolve(filePath).startsWith(path.resolve(this.uploadDir))
```

### 2.2 🚫 阻断｜零服务端分页

8 个核心列表接口全部是：
```ts
const rows = await this.repository.find({ where, order });   // 整表
return rows.filter(r => this.permission.canAccess(user, r)); // JS 过滤
```
前端 `DataTable` 再 `data.slice((page-1)*size, page*size)` 客户端切片。

- 1 万条资料 = 每次打开资料中心传输 1 万行 JSON
- 权限过滤在应用层，所以**无法**简单加 `take/skip`（会导致过滤后不足一页）

**必须做**：把 `visibility` 规则下沉成 SQL 条件（`WHERE visibility='public' OR departmentId=... OR ...`），
再用 `findAndCount` + `take/skip`，返回 `{ list, total, page, pageSize }`。
这是本次改造里工作量最大的一项，但绕不过去。

### 2.3 🔴 高｜开放注册未关闭

```ts
@Public()
@Post('register')     // 任何人可注册，自动获得 viewer 角色
```
对内部系统这是个洞：知道地址就能注册进来看知识库。
商用交付时应默认关闭，或改为"管理员邀请制"。

### 2.4 🔴 高｜单用户模式免密登录

```ts
@Public()
@Post('single-mode-login')   // 无需任何凭据，直接返回 admin 令牌
```
`APP_MODE=single` 时（当前 `.env` 正是 single），**任何能访问到端口的人都能拿到管理员令牌**。
个人客户端场景下若只监听 `127.0.0.1` 尚可接受，但现在监听的是 `0.0.0.0`，
同一局域网内任何机器都能登录。

**必须做**：single 模式强制绑定 `127.0.0.1`，或加一次性本地配对码。

### 2.5 🔴 高｜配置项有不安全的兜底默认值

```ts
password: process.env.DEFAULT_ADMIN_PASSWORD || 'admin123',
secret:   process.env.JWT_SECRET || 'change-this-secret-in-production',
apiKey:   process.env.AI_SERVICE_API_KEY || 'dev-api-key',
```
客户如果没配 `.env`（`run.bat` 会自动从 `.env.example` 复制），
就跑在**已知的默认 JWT 密钥**上 —— 任何人都能伪造任意用户的令牌。

**必须做**：生产环境这三项缺失时**启动即失败**，不给兜底；首次启动生成随机密钥写入 `.env`。

### 2.6 🟡 中｜令牌存在 localStorage

`accessToken` / `refreshToken` 都在 `localStorage`，任何 XSS 都能读走。
7 天有效期 + 可刷新 = 一次 XSS 等于长期接管账号。
商用建议改 httpOnly Cookie + CSRF token；至少把 accessToken 有效期压到 15 分钟。

### 2.7 🟡 中｜N+1 查询

`customers.service` 的 360 视图、`documents` 的链路查询等处存在循环内查库。
我在 `document-links.service` 里用 `In()` 批量取回避免了 N+1，但其他模块没有统一处理。

### 2.8 ✅ 做得好的部分

- bcrypt(10) 存密码、refresh token 可撤销、全局 JwtAuthGuard + RolesGuard
- ThrottlerGuard 限流（10s/50、60s/500）
- 全局 ValidationPipe（`whitelist` + `forbidNonWhitelisted`）—— 这个配置很严格，是加分项
- AI 调用有 60s 超时、健康检查 3s 超时、失败降级返回而非抛错
- 19 个模块用了 NestJS `Logger`，只有 1 个文件在用 `console`
- 审计日志拦截器 + AI 调用追踪（traceId）

---

## 三、前端层

### 3.1 🔴 高｜没有错误边界

全局检索 `ErrorBoundary` / `componentDidCatch` —— **0 处**。

任何一个组件渲染时抛异常（后端返回意外结构、数组变 null、日期解析失败），
**整个应用白屏**，用户只能刷新。商用产品不能这样。

**必须做**：根组件包 ErrorBoundary，展示"出错了 + 重试 + 复制错误信息"，
并把错误上报到后端便于售后定位。

### 3.2 🔴 高｜无前端错误上报

客户那边白屏了，你没有任何日志。
建议接入轻量的错误采集（自建 `/api/client-errors` 端点即可，不必上第三方）。

### 3.3 🟡 中｜设计系统仍有 110 处原始调色板

上次审计已列，未修：`text-red-600`(27)、`text-red-700`(22)、`text-green-600`(7)…
同一"危险"语义三种写法，改品牌色要动 110 处。

### 3.4 🟡 中｜两套字号体系

任意值 `text-[13px]` 等 262 处（12 种尺寸）+ 语义值 `text-sm/xs` 314 处，
`text-sm`(14px) 与 `text-[13px]` 在同一卡片内混用。

### 3.5 🟡 中｜详情页三种形态

需求 = 独立路由 + 标签页；方案/报价/项目 = 520px 抽屉；产品 = 三栏树。
同样是"看一条记录"，三种交互心智。方案详情要装 5 块内容，抽屉只放得下 2 块。

### 3.6 🟡 中｜平板适配不足

响应式断点：`md:` 76 处、`lg:` 41 处、`sm:` 仅 9 处、`xl:` 仅 3 处。
另有 20+ 处 `w-[520px]`～`w-[720px]` 固定宽抽屉，768px 平板上会溢出。

### 3.7 ✅ 做得好的部分

- 401 自动刷新令牌并重放原请求，刷新失败才登出
- 全局 `focus-visible` 焦点环 + `prefers-reduced-motion`
- 骨架屏、空状态带主行动、错误状态带重试
- 打包已分 chunk（411 kB 主包 + 3 个 vendor），gzip 后 104 kB
- viz 配色通过色觉安全校验

---

## 四、AI 服务层

### 4.1 🔴 高｜完全依赖外部 LLM API

`llm_router.py` 路由到 DeepSeek / 智谱 GLM，都是**联网调用**。

对"个人客户端"形态这是关键约束：
- 客户断网 → 结构化解析、方案生成、知识问答全部不可用
- 客户的**需求文件、报价数据会发送到第三方 LLM** —— 装备制造业客户对此非常敏感，
  很可能是采购时的一票否决项
- API Key 由谁付费？内置你的 key = 你承担成本且可被滥用；让客户自备 = 提高使用门槛

**必须决策**：
1. 提供本地模型选项（Ollama + Qwen2.5-14B 之类），牺牲效果换数据不出内网
2. 或在合同/界面明确告知数据出境范围，并支持客户填自己的 key
3. 加"敏感数据脱敏后再送 LLM"开关（`sanitizer.service` 已有基础）

### 4.2 🟡 中｜FAISS 索引不持久化

向量索引在内存，服务重启需全量重建。数据量上来后启动会很慢。
切 pgvector 可解决（`docker-compose.dev.yml` 用的已经是 `pgvector/pgvector:pg16` 镜像）。

---

## 五、交付与运维

### 5.1 🚫 无生产部署方案

现有：`backend/Dockerfile`、`frontend/Dockerfile`、`docker-compose.dev.yml`（只含 PG/Redis/MinIO）。
**没有把应用本身编排进去的 `docker-compose.yml`**。

客户拿到的是 `run.bat` —— 需要本机装 Node + Python + 依赖，属于开发方式而非交付方式。

**必须做**：一份完整的 `docker-compose.yml`（app + ai + pg + redis + nginx），
客户 `docker compose up -d` 即可；或做成 Windows 安装包（Electron 壳 + 内嵌服务）。

### 5.2 🚫 无升级机制

没有迁移 = 没有升级路径。客户从 v1 升 v2 时数据怎么办，目前无解。

### 5.3 🔴 无授权/许可机制

商用要考虑：授权码、有效期、功能分级、机器绑定。
项目里完全没有这部分（同目录下有个 `00Offline_Activator` 项目，或可复用）。

### 5.4 🔴 测试覆盖 ≈ 0

36,000 行代码，1 个测试文件，40 个用例，全部集中在公式引擎。
**核心业务逻辑（权限判定、报价计算、审批流转、全链路关联）零测试。**

商用底线建议：
- 权限服务 `canAccess` 的 5 种 visibility × 4 种角色 = 20 个用例
- 报价金额/毛利计算
- 需求版本链
- 关键接口的 e2e 冒烟（登录 → 建需求 → 解析 → 建方案 → 报价 → 审批）

---

## 六、修复优先级与排期

### 第一梯队：不做就不能交付（14 天）

| 项 | 层 | 天 |
|---|---|---|
| 生成初始迁移，全环境关闭 synchronize | DB | 2 |
| 文件上传路径穿越修复（3 处上传点） | 后端 | 1 |
| 服务端分页 + 权限下沉 SQL | 后端 | 5 |
| 多表写入加事务 | 后端 | 2 |
| 前端 ErrorBoundary + 错误上报 | 前端 | 1 |
| 关闭开放注册 / single 模式绑定 127.0.0.1 | 后端 | 1 |
| 生产环境缺密钥则启动失败 + 首启生成随机密钥 | 后端 | 1 |
| 完整 docker-compose.yml | 交付 | 1 |

### 第二梯队：影响可用性与口碑（12 天）

| 项 | 层 | 天 |
|---|---|---|
| 切 PostgreSQL + 补索引 + JSON→jsonb | DB | 4 |
| 备份/还原（含附件） | 运维 | 2 |
| 核心业务单测（权限/报价/版本链） | 测试 | 4 |
| 令牌改 httpOnly Cookie | 后端 | 2 |

### 第三梯队：产品化打磨（16 天）

| 项 | 层 | 天 |
|---|---|---|
| 本地 LLM 选项 + 数据脱敏开关 | AI | 5 |
| 详情页形态统一（方案/报价/项目） | 前端 | 4 |
| 设计 token 补完 + 字号刻度冻结 | 前端 | 2 |
| 平板适配 | 前端 | 3 |
| 授权/许可机制 | 交付 | 2 |

**合计约 42 天。** 第一梯队 14 天是硬门槛，不完成不建议对外交付。

---

## 七、需要你先决策的四件事

1. **数据能不能出内网？** 这决定 AI 架构走云端 API 还是本地模型 —— 是最大的架构分叉，
   越早定越好，晚了要返工。

2. **交付形态是什么？** Docker Compose（客户有运维）/ Windows 安装包（客户零运维）/ SaaS？
   三者的打包、升级、授权方案完全不同。

3. **单机还是多人？** 现在 `.env` 是 `APP_MODE=single`（免密登录）。
   如果卖给企业多人用，必须走 team 模式并补齐上面的认证加固。

4. **LLM 成本谁承担？** 内置你的 API Key 还是客户自备？影响定价模型和限流设计。

前三条定了，第一梯队就能直接开工。
