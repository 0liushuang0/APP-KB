# AI 业务知识库系统

> 面向装备制造企业（以博亚精工产品线为原型）的 AI 驱动型业务知识库与 CRM 系统。以客户、需求、方案、报价、产品、项目为核心业务对象，结合 AI 需求结构化、智能匹配、RAG 语义检索，实现业务知识的统一沉淀、检索与复用。

---

## 目录

- [技术栈](#技术栈)
- [系统架构](#系统架构)
- [项目结构](#项目结构)
- [核心功能模块](#核心功能模块)
- [AI 服务能力](#ai-服务能力)
- [快速启动](#快速启动)
- [配置说明](#配置说明)
- [单用户模式 vs 团队模式](#单用户模式-vs-团队模式)
- [数据库](#数据库)
- [前端设计系统](#前端设计系统)
- [测试脚本](#测试脚本)
- [当前开发状态](#当前开发状态)

---

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **前端** | React 18 + TypeScript 5 + Vite 5 | SPA 单页应用，路由懒加载 |
| **样式** | Tailwind CSS 3 + 自定义设计系统 | 品牌紫主色，浅色主题 |
| **状态管理** | Zustand（Auth Store）+ TanStack Query v5 | 客户端状态 + 服务端状态分离 |
| **HTTP** | Axios | 带请求/响应拦截、401 静默刷新、刷新令牌互斥 |
| **后端** | NestJS 10 + TypeORM 0.3 | 企业级 Node.js 框架 |
| **数据库** | SQLite（better-sqlite3，默认） / PostgreSQL（可选） | 双模式配置，一键切换 |
| **AI 服务** | Python 3.11 + FastAPI | 独立微服务，端口 8000 |
| **向量检索** | FAISS + scikit-learn | 本地向量索引 + 关键词混合检索 |
| **LLM 路由** | DeepSeek + 智谱 GLM + Ollama（离线降级） | 按业务模块自动路由，支持云端降级本地 |
| **安全** | JWT + Passport + Helmet + Throttler | 认证/授权/限流/安全头/数据出境管控 |
| **任务队列** | BullMQ + ioredis（可选） | 后台异步任务，单机默认关闭 |

---

## 系统架构

```
┌──────────────┐      ┌──────────────────┐      ┌─────────────────┐
│   Frontend   │─────▶│    Backend API   │─────▶│   AI Service    │
│  (Vite/React)│      │   (NestJS/TS)    │      │ (FastAPI/Py)    │
│  Port: 5274  │      │   Port: 3101     │      │  Port: 8100     │
└──────────────┘      └────────┬─────────┘      └───────┬─────────┘
                               │                        │
                     ┌─────────┴─────────┐    ┌─────────┴─────────┐
                     │                    │    │                    │
                ┌────▼────┐         ┌────▼───▼───┐          ┌──────▼──────┐
                │ SQLite  │         │ PostgreSQL │          │   FAISS     │
                │(app.db) │         │ + pgvector │          │ (vectors.db)│
                └─────────┘         └────────────┘          └─────────────┘
                                          │
                                    ┌─────▼─────┐
                                    │   Redis   │
                                    │ (可选)    │
                                    └───────────┘
```

**数据流**: 前端 → NestJS API → (业务数据 CRUD) SQLite/PostgreSQL + (AI 操作) Python FastAPI → (LLM) DeepSeek/GLM/Ollama + (语义检索) FAISS

---

## 项目结构

```
08AI-Knowledge-Base/
├── backend/                         # NestJS 后端
│   ├── src/
│   │   ├── main.ts                  # 入口（密钥引导、遗留库纳管、备份还原）
│   │   ├── app.module.ts            # 根模块（32 业务模块 + 公共模块）
│   │   ├── config/                  # 配置（app.config, database.config, secrets.bootstrap）
│   │   ├── common/                  # 公共服务
│   │   │   ├── guards/              # JWT守卫、角色守卫、Throttler守卫
│   │   │   ├── decorators/          # @CurrentUser、@Public、@Roles
│   │   │   ├── interceptors/        # 响应转换、审计日志拦截器
│   │   │   ├── filters/             # 全局异常过滤器
│   │   │   ├── services/            # 权限、事务、脱敏、加密、归档、监控、任务队列
│   │   │   └── utils/               # 路径安全、日志轮转等工具
│   │   ├── database/                # 迁移目录（16 个迁移）+ 遗留库纳管
│   │   └── modules/                 # 32 个业务模块（见下表）
│   ├── data/                        # SQLite 数据库 + 上传文件
│   └── package.json
│
├── frontend/                        # React 前端
│   ├── src/
│   │   ├── main.tsx                 # 入口
│   │   ├── App.tsx                  # 根组件
│   │   ├── router/                  # 路由（42 页面，含管理员守卫）
│   │   ├── pages/                   # 页面组件（含 settings/ 子目录）
│   │   ├── components/              # 57 个公共组件
│   │   ├── api/                     # API 客户端 + 服务定义
│   │   ├── store/                   # Zustand 状态管理（auth/theme/systemName）
│   │   ├── hooks/                   # 自定义 Hooks（分页、防抖、自动保存等）
│   │   ├── types/                   # TypeScript 类型定义
│   │   └── index.css               # 全局样式 + 设计系统
│   └── package.json
│
├── ai-service/                      # Python AI 微服务
│   ├── main.py                      # FastAPI 入口（14 个路由已全部注册）
│   ├── app/
│   │   ├── core/                    # 核心能力
│   │   │   ├── config.py            # Pydantic 配置（动态 get_settings 热更新）
│   │   │   ├── embeddings.py        # 4种 Embedding 方案（含维度校验）
│   │   │   ├── rag.py               # FAISS 向量检索 + 混合检索
│   │   │   ├── llm_router.py        # 多LLM路由 + Ollama 降级 + 出境管控
│   │   │   ├── egress.py            # 数据出境边界（脱敏/台账/阻断）
│   │   │   ├── auth.py              # API Key 常量时间校验
│   │   │   ├── parser.py            # 文档解析 (PDF/DOCX/XLSX)
│   │   │   ├── translation.py       # 多语言翻译
│   │   │   ├── customer_matching.py # 客户匹配引擎
│   │   │   ├── json_utils.py        # LLM JSON 提取
│   │   │   ├── media/               # OCR (PaddleOCR) + ASR (Whisper)
│   │   │   └── requirement_engine/  # 需求结构化引擎（LLM + 规则兜底）
│   │   └── routers/                 # 14 个 API 路由
│   ├── data/                        # 向量数据库 + OCR模型
│   ├── Dockerfile                   # 容器化部署
│   └── requirements.txt             # 依赖（核心 + 可选分组）
│
├── scripts/                         # 工具脚本
│   ├── test-all.py                  # 全量自动化测试
│   ├── init-db.sql                  # PostgreSQL 初始化
│   ├── migrate-sqlite-to-postgres.mjs  # SQLite → PostgreSQL 迁移
│   └── migrate-v1-to-v2.py          # V1 → V2 数据迁移
│
├── docker-compose.yml               # 生产编排（5 服务）
├── docker-compose.dev.yml           # 基础设施（PostgreSQL + Redis）
├── .env                             # 环境变量（含 LLM Key，已被 gitignore）
├── .env.example                     # 环境变量模板
├── run.bat                          # Windows 一键启动
└── README.md                        # 本文件
```

---

## 核心功能模块

### 后端业务模块（32 个 + 公共模块）

| 模块 | 功能 |
|------|------|
| **auth** | JWT 认证、刷新令牌轮换（一次性 + 重用检测）、httpOnly Cookie |
| **users** / **departments** / **user-groups** / **roles** | 用户/部门/用户组/角色 RBAC |
| **system** / **system-config** | 系统信息/仪表盘统计、键值配置存储 |
| **customers** | 客户 + 联系人 + 跟进记录，含 `getCustomer360()` 全景视图 |
| **requirements** | 需求管理 + AI 结构化参数提取 + 版本/变更日志 |
| **proposals** | 方案管理 + 版本控制 + AI 生成 |
| **quotations** | 报价管理 + 明细 + AI 定价建议 + 打印 |
| **contracts** / **after-sales** | 合同管理 + 售后工单 |
| **projects** | 项目 + 阶段 + 风险 + 时间线 + 文档关联 |
| **products** | 产品 + BOM + 附件（博亚精工产品树） |
| **suppliers** | 供应商 + 能力 + 产品 + 报价 + 对比 |
| **documents** | 文档管理 + 解析/审批 + 文档链 + 实体关联 |
| **approvals** | 审批流程 |
| **search** | 全局搜索 + RAG 语义检索 + 权限过滤 |
| **solutions** / **param-templates** | 方案模板/参数模板 |
| **calc-tools** | 计算工具（含公式引擎 + Luckysheet 在线表格） |
| **ai** | AI 调用日志 + 引擎配置 + 反馈 + 预算 + 匹配代理 |
| **files** | 受控文件下载（每次校验登录态 + 行级权限） |
| **audit-logs** / **tags** / **recycle-bin** / **notifications** | 审计/标签/回收站/通知 |
| **backup** / **data-portability** / **numbering** / **client-errors** | 备份还原/数据导出/编号规则/前端错误收集 |

**公共服务**: 权限服务（行级可见性下沉 SQL）、事务封装、文件加密 (AES-256-GCM)、数据脱敏、文件归档、文件夹监控 (Chokidar)、任务队列 (BullMQ，按需启用)、密钥链

---

## AI 服务能力

### 已注册路由（14 个）

| 路由前缀 | 能力 | 关键端点 |
|----------|------|----------|
| `/health` | 健康检查 | `GET /` |
| `/embeddings` | 向量生成 | `POST /`（批量）、`POST /parse`（文档解析） |
| `/rag` | 语义检索 | `POST /search`、`POST /hybrid-search`（向量+关键词混合）、`POST /chunks`、`POST /delete-by-source` |
| `/llm` | LLM 对话 | `POST /chat`、`POST /rag-chat`（SSE 流式）、`GET /health` |
| `/translate` | 多语言翻译 | `POST /`、`POST /document`、`POST /batch` |
| `/customers` | 客户匹配 | `POST /similar`、`POST /cross-sell` |
| `/requirement` | 需求结构化 | `POST /structure`、`POST /followup-draft`、`GET /templates` |
| `/matching` | 智能匹配 | `POST /similar`、`POST /analyze`、`POST /param-diff` |
| `/ai/solutions` | 方案匹配 | `POST /match-explanation`、`POST /compare` |
| `/ai/customer` | 客户画像 | `POST /profile` |
| `/ai/documents` | 文档 AI | `POST /classify`、`POST /generate-pdf`、`POST /generate-docx` |
| `/ai/requirements` | DXF 解析 | `POST /parse-dxf` |
| `/ai/media` | OCR/ASR | `POST /ocr`、`POST /asr` |
| `/config` | 配置热更新 | 热重载 embedding/LLM 配置 |

### Embedding 方案（4 选 1）

| Provider | 维度 | 说明 | 是否需要网络 |
|----------|------|------|-------------|
| `basic`（默认） | 768 | scikit-learn HashingVectorizer | 否 |
| `mock` | 768 | 全零向量，测试用 | 否 |
| `local` | 512 | sentence-transformers (BAAI/bge-small-zh-v1.5) | 首次下载 |
| `openai` | 1536 | OpenAI text-embedding-3-small API | 是 |

> 注意：不同 provider 维度不同，切换后需清空向量库重建索引（代码会在写入时检测维度不一致并报错）。

### LLM 多模块路由策略

| 业务模块 | 默认 Provider | 原因 |
|----------|--------------|------|
| 方案生成 / 客户分析 | 智谱 GLM | 长文本生成、语义理解 |
| 报价定价 / 文档问答 / 产品分析 / 需求结构化 | DeepSeek | 数理/结构化稳定 |
| 任一云端不可用 | Ollama 本地 | 离线降级 |

### 数据出境管控（egress）

- `cloud` 模式：允许调用云端大模型，出境前脱敏（联系方式 + 自定义敏感词）
- `local_only` 模式：硬性阻断出网，只允许回环地址
- 出境台账：只记元数据，不记正文

### 文档解析与高级能力

- **文档解析**: PDF (pypdf + PyMuPDF OCR 回退) / DOCX / XLSX / XLS / Markdown / TXT
- **可选能力（按需安装依赖）**: OCR (PaddleOCR)、ASR (faster-whisper)、DXF (ezdxf)、PDF 生成 (reportlab)、DOCX 生成 (python-docx)

### 文件在线预览

系统内置应用内文件预览（无需下载即可查看）：

| 文件类型 | 预览方式 |
|----------|----------|
| **PDF** | 浏览器原生 iframe 渲染 |
| **图片** (png/jpg/gif/webp/svg/bmp) | 内嵌展示，支持缩放/旋转 |
| **Office** (doc/docx/xls/xlsx/ppt/pptx/odt/ods/odp/rtf) | 后端 LibreOffice 转 PDF 后高保真预览 |
| **文本/代码/Markdown** | 语法展示 / Markdown 渲染 |

> **Office 预览依赖**：需在部署机安装 LibreOffice（soffice 在 PATH，或标准安装路径）：
> - Windows：安装 [LibreOffice](https://www.libreoffice.org/)（默认路径会被自动识别）
> - Linux：`apt install libreoffice`（Docker 镜像需在 Dockerfile 中添加）
> - macOS：`brew install --cask libreoffice`
>
> 未安装时 Office 文件预览会提示"服务不可用，请下载"，图片/PDF/文本预览不受影响。
> 转换结果按源文件改动自动失效重转，重复预览不重复转换。

---

## 快速启动

### 方式一：Windows 本机开发/个人模式

```bash
run.bat
```

该脚本使用当前开发配置，启动 AI 服务（8100）、后端（3101）和 Vite 前端（5274），仅供本机开发/个人模式。公司员工多机协作请使用下方的团队部署流程。

### 方式二：手动分别启动

```bash
# 1. AI 服务
cd ai-service
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8100

# 2. 后端
cd backend
npm install
npm run start:dev

# 3. 前端
cd frontend
npm install
npm run dev
```

### 方式三：Docker 一键部署

公司内网多人协作请按 [Windows 内网团队版部署与验收](docs/TEAM_DEPLOYMENT.md) 操作：先生成专用密钥和 HTTPS 证书，再启动五个服务。直接使用根目录开发 `.env` 启动 Docker 会使用单人模式，无法供其他电脑登录。

### 访问地址

| 服务 | 地址 |
|------|------|
| 前端 | http://localhost:5274 |
| 后端 API | http://localhost:3101/api |
| Swagger 文档 | http://localhost:3101/api/docs（仅非生产） |
| AI 服务 | http://localhost:8100 |

---

## 配置说明

本机开发配置位于根目录 `.env`；Docker 团队版使用独立的 `deploy/team.env`，由部署脚本生成。

### 关键配置项

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `APP_MODE` | `single` | `single`=自动登录管理员；`team`=完整认证/RBAC |
| `DB_TYPE` | `sqlite` | `sqlite` 或 `postgres` |
| `SQLITE_PATH` | `./data/app.db` | SQLite 数据库文件路径 |
| `PORT` | `3001` | 后端端口 |
| `JWT_EXPIRES_IN` | `2h` | 访问令牌有效期（短，防 XSS 接管） |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | 刷新令牌有效期（轮换式） |
| `REDIS_ENABLED` | `false` | 是否启用 Redis（任务队列），单机默认关 |
| `AI_SERVICE_URL` | `http://localhost:8100` | AI 服务地址 |
| `EMBEDDING_PROVIDER` | `basic` | Embedding 方案 |
| `DEEPSEEK_API_KEY` / `GLM_API_KEY` | — | LLM 密钥（缺失则降级 Ollama） |
| `FILE_ENCRYPTION_ENABLED` | `false` | 是否启用 AES-256 文件加密 |

> **密钥安全**：首次启动时 `secrets.bootstrap.ts` 会自动生成随机 `JWT_SECRET`、`AI_SERVICE_API_KEY`、`FILE_ENCRYPTION_KEY` 并写入 `.env`；生产环境若密钥不安全会拒绝启动。

---

## 单用户模式 vs 团队模式

| 特性 | `single` 模式 | `team` 模式 |
|------|---------------|------------|
| 登录 | 自动以管理员登录（仅本机回环） | 需手动登录 |
| 组织架构 | 隐藏 | 显示部门/用户组 |
| 权限控制 | 隐藏 RBAC | 完整角色权限（前端管理员守卫 + 后端 RBAC） |
| 审批流程 | 自动通过 | 走审批流 |

当前配置：`APP_MODE=single`

---

## 数据库

### SQLite（默认）

- 驱动：`better-sqlite3`（原生文件型，支持 WAL 与 ACID 事务）
- 路径：`backend/data/app.db`
- 全环境关闭 `synchronize`，统一走迁移（`migrationsRun: true`）
- 启用 WAL、外键约束、busy_timeout

### PostgreSQL（可选）

```bash
docker-compose -f docker-compose.dev.yml up -d
# 修改 .env: DB_TYPE=postgres
```

迁移工具：`node scripts/migrate-sqlite-to-postgres.mjs`

---

## 前端设计系统

基于 Tailwind CSS 的自定义设计令牌系统（"eo-" 前缀组件类）：

| 设计元素 | 值 | 说明 |
|----------|-----|------|
| **主色** | `#7c3aed`（accent-500） | 品牌紫，主操作/当前导航 |
| **文字色** | `ink` / `muted` | 主文字/次要文字 |
| **页面背景** | `canvas` | 暖白 |
| **卡片背景** | `surface` | 纯白 |
| **字体** | Inter（正文）/ Fraunces（标题）/ JetBrains Mono（代码） | |
| **圆角** | `12px`（xl） | |
| **主题** | 浅色为主，支持 dark/system 切换（themeStore） | |

数据可视化调色板（色盲友好）：`#7c3aed, #0891b2, #ff5b1f, #059669, #b45309`

---

## 测试脚本

```bash
# 全量 API 自动化测试
python scripts/test-all.py
# → test-report.json / TEST_REPORT.md

# 后端单元测试（14 个 spec）
cd backend && npm test

# 前端单元测试（vitest）
cd frontend && npm test
```

---

## 当前开发状态

### 已完成

- **系统底座**: 认证（JWT + 刷新令牌轮换）、用户/角色/部门/用户组（RBAC）、系统配置、审计日志、备份还原、回收站、标签、编号规则
- **CRM 核心链路**: 客户 → 需求 → 方案 → 报价 → 合同 → 项目 → 售后
- **客户 360 知识中心**: 全景视图（统计 + 项目 + 文档 + 需求 + 按阶段文档分布）
- **AI 需求结构化**: LLM 提取技术参数 → 结构化规格 → 匹配推荐（含规则兜底）
- **AI 方案/报价**: 方案 AI 生成、报价 AI 定价建议
- **智能匹配引擎**: 向量 + 关键词混合检索、参数差异对比、需求-产品匹配
- **RAG 语义检索**: 文档上传 → 解析 → 分块 → 向量索引 → 语义问答
- **产品管理**: 博亚精工产品树 + BOM
- **供应商管理**: 供应商能力评估、产品对比、报价历史
- **文档管理**: 文档上传/解析/审批、文档链、按实体关联、受控下载
- **计算工具**: 公式引擎 + Luckysheet 在线表格 + 模板化计算
- **安全**: 文件加密、数据脱敏、限流、安全头、数据出境管控、行级文件权限
- **前端**: 42 个页面、57 个组件、完整设计系统、管理员路由守卫
- **Docker 部署**: 完整编排（含健康检查与依赖顺序启动）

### 待完成

- CI/CD 流水线
- 测试覆盖率提升（API 层、权限服务、文件控制器等核心路径补单测）
- 部分大型页面组件拆分（ParamTemplates / KnowledgeBase 等超 1000 行）

---

## 平台工作流导入（2026-10）

平台启动入口：在平台根目录执行 `python launcher/zh.py start ai-kb`。前端为
`http://127.0.0.1:3101`，`/api` 由前端代理到知识库后端。真实探活路径为
`GET /api/health`，只有后端及数据库就绪才返回成功，不能使用 SPA 首页代替探活。

服务接口 `PUT /api/zh/v1/documents` 使用平台启动器注入的 `ZH_SERVICE_TOKEN`。
调用时发送 `X-ZH-Service-Token` 请求头；兼容 `Authorization: Bearer ...`。
令牌缺失或错误返回 401，服务没有配置令牌返回 503。此令牌不代替用户登录，
资料库查看和文件下载仍使用现有账号与权限。

```json
{
  "items": [
    {
      "id": "md-001",
      "title": "项目技术记录",
      "content": "# 项目技术记录\n\nMarkdown 正文。\n",
      "source": "doc-md-merger",
      "updated_at": "2026-10-03T00:00:00Z",
      "project_ref": "project-01"
    }
  ]
}
```

响应为未包装的 `{"results":[{"id":"md-001","local_id":"知识库文档 ID","action":"created"}]}`。
每批最多 100 项；正文最多 4,000,000 字符，请求体最多 8 MB。每项独立校验，
错误项返回 `action: "error"` 和 `error`，其余项继续处理。

- 通过 `source + id` 识别来源文档。重复内容返回 `skipped`，较旧来源时间返回
  `skipped`，不会重复建文档或回退资料。
- 第一次导入返回 `created`。后续来源内容变更返回 `updated`，生成单独的待审批
  新版本和新 `local_id`；已审批文档及人工修改不被覆盖。
- Markdown 文件、真实文档记录、来源映射和审批单共同保存；数据库事务失败会
  清理孤立文件。文档在资料库的“工作流导入”分类可见，可通过正常文件接口查看和下载。
- 所有导入都处于待审批状态，仅责任人及有权限的管理员/审批人可见。
  不自动公开、不自动加入 AI 索引，也不调用付费模型。待审批文档禁止 AI 索引；
  审批后仍需用户主动执行索引。
- `project_ref` 仅记录来源项目标识，不假定该标识是本地项目 ID。

导入责任人使用已有活跃系统管理员；可配置 `ZH_KB_IMPORT_OWNER` 为已有活跃
账号名称，该账号必须有真实管理员/审批角色及审批权限。接口不会创建通用管理员。
没有合适责任人时，逐项返回错误，等待管理员配置后重试。

验证命令（隔离测试库，不改真实资料）：

```powershell
cd apps/ai-kb/backend
npm.cmd test -- --runInBand --runTestsByPath src/modules/documents/zh-documents.service.spec.ts
npm.cmd run build
```

测试覆盖缺失/错误/正确服务头、DTO 校验、幂等、待审批与正常受控下载、人工及审批
成果保护、逐项错误、事务回滚、实际 SQLite 迁移，以及待审批期间没有 AI 调用。

*最后更新：2026-10*
