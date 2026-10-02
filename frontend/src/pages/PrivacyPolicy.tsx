import { Shield, FileText, Eye, Lock, Database, Globe, ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export default function PrivacyPolicy() {
  const navigate = useNavigate()

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} title="返回上一页" className="text-muted hover:text-ink transition-colors">
          <ArrowLeft size={20} />
        </button>
        <Shield size={24} className="text-accent-600" />
        <h1 className="font-serif text-2xl font-semibold text-ink">隐私政策</h1>
      </div>

      <div className="bg-info-bg border border-info-line rounded-lg p-4 text-sm text-info-fg">
        <p className="font-medium mb-1">数据安全承诺</p>
        <p>本系统遵循"本地优先、最小上传"原则。您的业务资料默认存储在本地设备，仅在您主动使用 AI 功能时，相关文本片段才会加密传输至云端 AI 服务。</p>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
          <Database size={18} className="text-accent-600" />
          一、数据存储位置
        </h2>
        <div className="bg-surface border border-border rounded-lg p-4 space-y-3 text-sm text-ink-soft">
          <p><strong>本地存储（您的设备上）：</strong></p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>所有业务数据（客户、需求、方案、报价、项目）</li>
            <li>上传的文档原件（PDF、Word、Excel 等）</li>
            <li>文档向量索引（用于语义检索）</li>
            <li>AI 对话历史</li>
            <li>系统配置和用户偏好</li>
          </ul>
          <p className="mt-3"><strong>云端处理（临时）：</strong></p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>仅当您使用 AI 问答/生成功能时，相关文本片段会发送至云端 AI 服务</li>
            <li>发送的内容经过 PII 脱敏处理（自动隐藏手机号、身份证号、邮箱等）</li>
            <li>原始文档<strong>不会</strong>上传至云端</li>
          </ul>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
          <Eye size={18} className="text-accent-600" />
          二、数据使用方式
        </h2>
        <div className="bg-surface border border-border rounded-lg p-4 space-y-3 text-sm text-ink-soft">
          <p>我们收集和使用数据的方式：</p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li><strong>AI 调用日志</strong>：记录每次 AI 调用的模块、耗时、Token 用量（不含业务内容）</li>
            <li><strong>出境台账</strong>：记录数据出境的元数据（发送目标、字符数、脱敏次数）</li>
            <li><strong>审计日志</strong>：记录用户操作（登录、创建、修改、删除）用于安全审计</li>
            <li><strong>错误日志</strong>：记录系统错误用于问题排查（不含敏感业务数据）</li>
          </ul>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
          <Globe size={18} className="text-accent-600" />
          三、数据传输与第三方服务
        </h2>
        <div className="bg-surface border border-border rounded-lg p-4 space-y-3 text-sm text-ink-soft">
          <p>当您使用 AI 功能时，数据可能传输至以下第三方服务：</p>
          <table className="w-full text-sm mt-2">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2">服务</th>
                <th className="text-left py-2">用途</th>
                <th className="text-left py-2">数据类型</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border">
                <td className="py-2">DeepSeek</td>
                <td>报价分析、文档问答</td>
                <td>文本片段（脱敏后）</td>
              </tr>
              <tr className="border-b border-border">
                <td className="py-2">智谱 GLM</td>
                <td>方案生成、客户分析</td>
                <td>文本片段（脱敏后）</td>
              </tr>
              <tr className="border-b border-border">
                <td className="py-2">OpenAI</td>
                <td>可选，通用 AI 能力</td>
                <td>文本片段（脱敏后）</td>
              </tr>
              <tr>
                <td className="py-2">Ollama（本地）</td>
                <td>离线 AI 降级</td>
                <td>数据不出设备</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-muted text-caption">
            所有云端传输均使用 HTTPS/TLS 加密。您可以在 AI 配置中切换为"本地模式"，此时所有数据完全不出设备。
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
          <Lock size={18} className="text-accent-600" />
          四、数据安全措施
        </h2>
        <div className="bg-surface border border-border rounded-lg p-4 space-y-3 text-sm text-ink-soft">
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>API Key 使用 AES-256-GCM 加密存储（机器特征派生密钥）</li>
            <li>用户密码使用 bcrypt 哈希存储</li>
            <li>JWT 令牌通过 httpOnly Cookie 传输（防止 XSS 窃取）</li>
            <li>文件上传路径经过安全校验（防止目录穿越）</li>
            <li>所有 API 请求经过速率限制和权限校验</li>
            <li>自动备份机制（默认每 6 小时，可配置）</li>
            <li>数据出境前自动进行 PII 脱敏</li>
          </ul>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
          <FileText size={18} className="text-accent-600" />
          五、您的权利
        </h2>
        <div className="bg-surface border border-border rounded-lg p-4 space-y-3 text-sm text-ink-soft">
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li><strong>数据导出</strong>：可随时导出全部数据（JSON 格式，34 张表）</li>
            <li><strong>数据删除</strong>：可彻底删除本地数据和向量索引</li>
            <li><strong>云端数据删除</strong>：可请求删除已发送至云端的数据</li>
            <li><strong>AI 功能关闭</strong>：可完全禁用 AI 功能，仅使用本地知识库</li>
            <li><strong>本地模式</strong>：可切换为本地模式，所有数据不出设备</li>
            <li><strong>出境台账</strong>：可查看所有数据出境记录（时间、目标、字符数）</li>
          </ul>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-ink">六、联系我们</h2>
        <div className="bg-surface border border-border rounded-lg p-4 text-sm text-ink-soft">
          <p>如您对本隐私政策有任何疑问，请通过以下方式联系我们：</p>
          <ul className="list-disc list-inside space-y-1 ml-4 mt-2">
            <li>系统内置反馈入口（设置 → 系统信息 → 问题反馈）</li>
            <li>GitHub Issues：项目仓库地址</li>
          </ul>
        </div>
      </section>

      <div className="text-caption text-muted text-center pt-4 border-t border-border">
        本隐私政策最后更新于 2026 年 8 月 2 日。如有重大变更，系统将主动通知您。
      </div>
    </div>
  )
}
