# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-03

### Added

#### AI & Knowledge
- **AI 智能问答**：基于 RAG 的流式问答，支持全部业务数据检索与引用溯源
- **知识库管理**：文档上传、AI 自动索引、分块检索、分类管理
- **需求 AI 分析**：自动提取需求参数、生成结构化需求卡
- **方案 AI 生成**：基于历史方案和产品模板自动生成技术方案
- **报价 AI 辅助**：智能成本估算与报价建议
- **Ollama 本地模型**：断网时自动降级到本地模型，数据不出设备

#### 业务流程
- **流程工作台**：需求 → 方案 → 报价 → 成交的看板式流水线管理
- **客户中心**：客户 360° 视图，含需求、方案、报价、资料全链路回查
- **需求管理**：需求登记、版本管理、补问草稿、AI 结构化分析
- **方案管理**：标准方案模板库、配置选项、价格表
- **报价管理**：报价编制、审核、PDF 导出
- **项目跟踪**：项目阶段管理、时间线、风险登记

#### 产品与供应链
- **产品管理**：产品目录、BOM 物料清单、附件管理
- **供应比价**：供应商管理、多维比价表、价格历史追踪
- **参数模板**：按产品类别定义参数模板，支持 AI 匹配
- **工程计算**：计算工具模板库、计算记录、关联到业务对象

#### 文档与资料
- **资料中心**：业务资料上传、分类、全链路关联
- **文档链路**：资料与客户/需求/方案/报价/项目的多维关联
- **全链路回查**：按业务阶段查看客户完整资料链
- **文件预览**：支持图片、PDF、文本/代码、Markdown 内容预览

#### 系统功能
- **用户认证**：基于 httpOnly Cookie 的安全认证，支持单人/团队模式
- **权限管理**：角色与部门权限控制
- **全局搜索**：跨模块全文检索
- **数据备份**：完整数据备份与还原，JSON 数据迁移
- **审计日志**：操作记录追踪
- **系统配置**：大模型配置、RAG 参数、Embedding 模型
- **性能监控**：AI 调用统计、知识健康度、使用趋势
- **浏览器通知**：关键事件（备份完成、AI 回答、文档索引）的桌面通知
- **深色模式**：支持浅色/深色/跟随系统三种主题切换

#### 技术架构
- React 18 + TypeScript + Vite 构建
- Tailwind CSS 设计系统，含语义色 token 体系
- Zustand 状态管理
- TanStack Query 数据获取
- lucide-react 图标库
- sonner Toast 通知
- react-markdown Markdown 渲染

### Changed
- 设计系统统一：~35 处硬编码颜色已替换为 Tailwind 语义 token
- Markdown 样式改用 CSS 变量，支持深色模式
- DEAL_STAGES 颜色引用 CSS 变量，适配主题切换
- 工作台看板列头和统计卡片使用 token 类名替代内联样式

### Fixed
- 文档详情抽屉中预览按钮功能修复
- 知识库文档列表操作栏布局优化

### Security
- 文件访问全部走 `/api/files/*` 受保护路由，不再暴露静态目录
- API Key 在 UI 中默认隐藏，需手动点击查看
- httpOnly Cookie 认证，JavaScript 无法读取令牌
