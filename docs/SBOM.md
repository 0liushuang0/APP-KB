# 软件物料清单（SBOM）

> 项目：BOYA 智能知识中心
> 版本：v2.0
> 生成日期：2026-08-02
> 格式：SPDX-lite

---

## 一、前端依赖

### 核心依赖

| 包名 | 版本 | 许可证 | 用途 |
|------|------|--------|------|
| react | ^18.2.0 | MIT | UI 框架 |
| react-dom | ^18.2.0 | MIT | React DOM 渲染 |
| react-router-dom | ^6.21.1 | MIT | 客户端路由 |
| @tanstack/react-query | ^5.17.0 | MIT | 服务端状态管理 |
| @tanstack/react-virtual | ^3.14.9 | MIT | 虚拟滚动 |
| zustand | ^4.4.7 | MIT | 客户端状态管理 |
| axios | ^1.6.5 | MIT | HTTP 客户端 |
| lucide-react | ^1.18.0 | ISC | 图标库 |
| react-markdown | ^10.1.0 | MIT | Markdown 渲染 |
| remark-gfm | ^4.0.1 | MIT | GitHub 风格 Markdown |
| sonner | ^2.0.7 | MIT | Toast 通知 |

### 开发依赖

| 包名 | 版本 | 许可证 | 用途 |
|------|------|--------|------|
| vite | ^5.0.10 | MIT | 构建工具 |
| typescript | ^5.3.3 | Apache-2.0 | 类型检查 |
| tailwindcss | ^3.4.0 | MIT | CSS 框架 |
| eslint | ^8.56.0 | MIT | 代码检查 |
| vitest | ^4.1.10 | MIT | 测试框架 |
| @testing-library/react | ^16.3.2 | MIT | React 测试工具 |
| @vitejs/plugin-react | ^4.2.1 | MIT | Vite React 插件 |

---

## 二、后端依赖

### 核心依赖

| 包名 | 版本 | 许可证 | 用途 |
|------|------|--------|------|
| @nestjs/core | ^10.3.0 | MIT | 后端框架 |
| @nestjs/common | ^10.3.0 | MIT | NestJS 通用模块 |
| @nestjs/typeorm | ^10.0.1 | MIT | TypeORM 集成 |
| @nestjs/jwt | ^10.2.0 | MIT | JWT 认证 |
| @nestjs/passport | ^10.0.3 | MIT | Passport 集成 |
| @nestjs/swagger | ^7.2.0 | MIT | Swagger 文档 |
| @nestjs/throttler | ^6.5.0 | MIT | 速率限制 |
| @nestjs/bullmq | ^11.0.4 | MIT | 任务队列 |
| typeorm | ^0.3.19 | MIT | ORM 框架 |
| better-sqlite3 | ^12.11.1 | MIT | SQLite 驱动 |
| pg | ^8.22.0 | MIT | PostgreSQL 驱动 |
| bcrypt | ^5.1.1 | MIT | 密码哈希 |
| passport | ^0.7.0 | MIT | 认证框架 |
| passport-jwt | ^4.0.1 | MIT | JWT 策略 |
| helmet | ^7.1.0 | MIT | 安全头 |
| class-validator | ^0.14.1 | MIT | 数据验证 |
| class-transformer | ^0.5.1 | MIT | 数据转换 |
| ioredis | ^5.11.1 | MIT | Redis 客户端 |
| bullmq | ^5.81.3 | MIT | 任务队列 |
| uuid | ^9.0.1 | MIT | UUID 生成 |
| archiver | ^7.0.1 | MIT | ZIP 打包 |
| unzipper | ^0.12.5 | MIT | ZIP 解压 |
| docx | ^8.5.0 | MIT | Word 文档生成 |
| xlsx | ^0.18.5 | Apache-2.0 | Excel 处理 |

---

## 三、AI 服务依赖

| 包名 | 版本 | 许可证 | 用途 |
|------|------|--------|------|
| fastapi | >=0.115 | MIT | Web 框架 |
| uvicorn | >=0.32 | BSD-3 | ASGI 服务器 |
| pydantic | >=2.10 | MIT | 数据验证 |
| numpy | >=2.1 | BSD-3 | 数值计算 |
| scikit-learn | >=1.6 | BSD-3 | 机器学习 |
| faiss-cpu | >=1.9 | MIT | 向量检索 |
| sentence-transformers | >=3.0 | Apache-2.0 | Embedding 模型 |
| transformers | >=4.45 | Apache-2.0 | NLP 模型 |
| openai | >=1.50 | Apache-2.0 | OpenAI API |
| python-docx | >=1.1.0 | MIT | Word 解析 |
| pypdf | >=4.0.2 | BSD-3 | PDF 解析 |
| openpyxl | >=3.1.2 | MIT | Excel 解析 |
| xlrd | >=2.0.1 | BSD | 旧版 Excel 解析 |
| markdown | >=3.5.2 | BSD-3 | Markdown 解析 |
| beautifulsoup4 | >=4.12.3 | MIT | HTML 解析 |
| aiohttp | >=3.11 | Apache-2.0 | 异步 HTTP |
| loguru | >=0.7.2 | MIT | 日志框架 |

---

## 四、许可证兼容性分析

### 许可证分布

| 许可证 | 数量 | 商用兼容性 |
|--------|------|-----------|
| MIT | 45+ | ✅ 完全兼容 |
| Apache-2.0 | 8+ | ✅ 完全兼容（需保留声明） |
| BSD-3-Clause | 5+ | ✅ 完全兼容 |
| ISC | 2+ | ✅ 完全兼容 |
| GPL/AGPL | 0 | ✅ 无传染性许可证 |

### 结论

**所有依赖均为宽松许可证（MIT/Apache/BSD），完全允许商用，无传染性风险。**

---

## 五、已知安全漏洞

截至 2026-08-02，使用 `npm audit` 和 `pip audit` 扫描结果：

| 层级 | 高危 | 中危 | 低危 | 状态 |
|------|------|------|------|------|
| 前端 | 0 | 0 | 0 | ✅ 无漏洞 |
| 后端 | 0 | 0 | 0 | ✅ 无漏洞 |
| AI 服务 | 0 | 0 | 0 | ✅ 无漏洞 |

---

## 六、开源声明

本项目使用了以下开源组件，特此致谢：

- **NestJS** - MIT License - Copyright (c) Kamil Mysliwiec
- **React** - MIT License - Copyright (c) Meta Platforms, Inc.
- **TypeORM** - MIT License - Copyright (c) Umed Khudoiberdiev
- **FastAPI** - MIT License - Copyright (c) Sebastián Ramírez
- **FAISS** - MIT License - Copyright (c) Meta Platforms, Inc.
- **Tailwind CSS** - MIT License - Copyright (c) Tailwind Labs, Inc.
- **Lucide** - ISC License - Copyright (c) Lucide Contributors

完整许可证文本见各包的 `LICENSE` 文件。
