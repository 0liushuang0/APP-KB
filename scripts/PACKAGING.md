# Windows 打包指南

## 方案概述

提供两种打包方式，根据客户需求选择：

| 方式 | 适用场景 | 优点 | 缺点 |
|------|---------|------|------|
| **Docker Desktop** | 客户有 IT 运维 | 一键部署、环境隔离 | 需安装 Docker |
| **绿色免安装包** | 零运维客户 | 双击即用、无需 Docker | 包体较大（~500MB） |

---

## 方式一：Docker Desktop 部署（推荐）

### 前置条件
- Windows 10/11 64位
- 安装 Docker Desktop（https://docker.com/products/docker-desktop）

### 部署步骤
```powershell
# 1. 解压产品包到目标目录
Expand-Archive -Path aikb-release.zip -DestinationPath C:\AIKnowledgeBase

# 2. 进入目录
cd C:\AIKnowledgeBase

# 3. 复制并编辑配置
Copy-Item .env.docker .env
# 用记事本打开 .env，填写 LLM API Key
notepad .env

# 4. 一键启动
docker compose up -d

# 5. 访问 http://localhost
```

---

## 方式二：绿色免安装包

### 打包脚本

运行 `scripts/package-windows.ps1` 生成免安装包：

```powershell
.\scripts\package-windows.ps1 -OutputDir .\release
```

### 打包产物结构

```
aikb-windows-x64/
├── start.bat                    # 一键启动
├── stop.bat                     # 一键停止
├── .env                         # 配置文件
├── node/                        # 内嵌 Node.js 20 LTS
├── python/                      # 内嵌 Python 3.11
├── backend/                     # 后端（已编译）
├── frontend/                    # 前端（已构建）
├── ai-service/                  # AI 服务
├── data/                        # 数据目录（运行时生成）
└── README.txt                   # 使用说明
```

### 自动安装依赖

首次运行 `start.bat` 时自动：
1. 检测 Node.js / Python 是否存在
2. 如不存在，从内嵌目录复制
3. 安装 npm / pip 依赖
4. 启动三个服务
5. 打开浏览器

---

## Inno Setup 安装包（可选）

如需制作标准 Windows 安装程序（.exe 安装向导），使用 Inno Setup：

1. 安装 Inno Setup 6（https://jrsoftware.org/isinfo.php）
2. 打开 `scripts/aikb-installer.iss`
3. 编译生成安装程序

---

## 数据目录说明

所有用户数据存储在 `data/` 目录下：

```
data/
├── app.db                       # SQLite 数据库
├── uploads/documents/           # 上传的文档
├── backups/                     # 备份文件
├── ai/vectors.db                # 向量索引
└── ai/egress.log                # 出境台账
```

**重要提示**：升级时只需替换程序目录，`data/` 目录保持不变。
