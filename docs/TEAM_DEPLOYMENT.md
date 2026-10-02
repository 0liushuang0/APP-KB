# Windows 内网团队版部署与验收

适用场景：公司一台 Windows 电脑作为服务器，员工从其他电脑的浏览器访问并协同处理同一项目。服务器需安装并运行 Docker Desktop；员工电脑不需要安装本系统。部署时使用 PostgreSQL 和 HTTPS。开发用 `run.bat` 是单人本机模式，不能作为团队版入口。

## 首次部署

1. 为服务器固定一个局域网 IPv4 地址，并在 Windows 防火墙中只向公司可信网段开放 TCP 80、443。不要把这两个端口直接映射到公网。
2. 在服务器上安装并启动 Docker Desktop。若使用脚本自动生成内网证书，另需 Git for Windows（提供 Git Bash 和 OpenSSL）。有企业 CA 证书时，可将 PEM 格式证书与私钥放在 `deploy/tls/aikb-server.crt`、`deploy/tls/aikb-server.key`。
3. 在项目根目录的 PowerShell 执行：

   ```powershell
   .\scripts\setup-team.ps1 -LanIp 192.168.1.50
   .\scripts\start-team.ps1
   ```

   将示例 IP 换成服务器实际地址。`setup-team.ps1` 只在首次运行时生成 `deploy/team.env`，包含随机数据库密码、JWT 密钥、AI 内部密钥和初始管理员密码；请在安全位置记录初始密码。脚本不会覆盖已有配置。

4. 每台员工电脑由管理员导入 `deploy/tls/aikb-server.crt` 到受信任的根证书存储，再访问 `https://<服务器IP>`。企业 CA 证书按企业现有信任策略分发。若地址改变，应重新签发包含新 IP 的证书，并更新 `PUBLIC_ORIGIN`。
5. 管理员首次登录后立即修改密码，创建用户与部门，并为评审部门配置代码：`sales`、`engineering`、`production`、`procurement`、`quality`、`finance`、`service`。评审人须有审批角色并被加入相应制造项目。

配置位于 `deploy/team.env`，不应提交到版本库。再次启动使用 `start-team.ps1`；停止服务可在项目根目录执行 `docker compose --env-file deploy/team.env down`。普通升级前先下载一份全量备份，再拉取新版本并运行启动脚本；数据库迁移随后端启动自动执行。

## 数据保护与恢复

- 系统定时生成数据库备份及全量备份；管理员可在“设置 → 备份还原”手动生成并下载。备份默认加密，**必须把备份文件和加密密钥分开放在服务器以外的位置**。密钥在后端容器 `/app/data/.backup-key`，可用 `docker cp aikb-backend:/app/data/.backup-key .\backup-key.txt` 导出并妥善保管。
- PostgreSQL 模式的应用内“一键还原”暂不支持；恢复需由管理员停机操作。先保留当前数据快照，用 `node scripts/decrypt-backup.mjs <备份.zip.enc> <输出.zip> --key <密钥文件>` 解密并检查 `manifest.json`，再通过 `pg_restore` 恢复 `pgdump.dump`，同时恢复 `uploads/` 到后端数据卷。只使用数据库备份不会恢复附件。
- 每次版本升级前及每季度，建议在**独立测试实例**演练一次完整恢复，核对客户、报价、附件和结项报告。切勿在生产库上直接演练覆盖恢复。

## 现场验收清单

1. 从两台不同员工电脑访问 HTTPS，分别以管理员、业务员、评审员登录；确认普通账号不能查看未被分配的制造项目或下载其资料。
2. 建立四类业务各一单；成套设备单录入技术符合性、各部门评审、报价审批、合同审批与签订日期，关联由该合同派生的执行项目。
3. 让第二位成员在项目中登记交付节点；未完成节点不能结项。完成“客户验收”节点并填凭据后再结项，生成项目结项报告和制造项目 CSV 报表。
4. 两人同时编辑一条项目，确认旧版本提交收到冲突提示。测试失单原因、跨客户单据关联拒绝、非本部门评审拒绝。
5. 手动生成并下载全量备份，确认文件不为零字节，并把 `.backup-key` 单独导出；检查自动备份日志是否成功。
6. 重启 Docker Desktop 和服务器后，确认容器自动恢复，员工仍能登录、查看原有数据和附件。

本开发机没有 Docker，不能代替现场完成容器启动、客户端证书信任、局域网访问和真实备份恢复验收；这些步骤是投入实际使用的最后准入条件。
