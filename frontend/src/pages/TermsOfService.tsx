import { FileText, ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export default function TermsOfService() {
  const navigate = useNavigate()

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} title="返回上一页" className="text-muted hover:text-ink transition-colors">
          <ArrowLeft size={20} />
        </button>
        <FileText size={24} className="text-accent-600" />
        <h1 className="font-serif text-2xl font-semibold text-ink">用户协议</h1>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-ink">一、服务说明</h2>
        <div className="bg-surface border border-border rounded-lg p-4 space-y-3 text-sm text-ink-soft">
          <p>BOYA 智能知识中心（以下简称"本系统"）是一款面向装备制造企业的 AI 驱动型业务知识库与 CRM 系统，主要功能包括：</p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>客户、需求、方案、报价、项目全链路管理</li>
            <li>AI 智能问答、需求结构化、方案生成</li>
            <li>文档解析、向量检索、知识库管理</li>
            <li>供应商管理、产品管理、计算工具</li>
          </ul>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-ink">二、使用规范</h2>
        <div className="bg-surface border border-border rounded-lg p-4 space-y-3 text-sm text-ink-soft">
          <p>您同意：</p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>妥善保管您的账号和密码，不与他人共享</li>
            <li>不利用本系统从事违法违规活动</li>
            <li>不尝试攻击、破解或破坏系统安全机制</li>
            <li>不上传含有恶意代码或病毒的文件</li>
            <li>遵守 AI 服务提供商的使用条款</li>
          </ul>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-ink">三、知识产权</h2>
        <div className="bg-surface border border-border rounded-lg p-4 space-y-3 text-sm text-ink-soft">
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>本系统软件的知识产权归开发者所有</li>
            <li>您上传的业务数据和文档的知识产权归您所有</li>
            <li>AI 生成的内容仅供参考，不构成专业建议</li>
            <li>您应确保上传的资料不侵犯第三方知识产权</li>
          </ul>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-ink">四、免责声明</h2>
        <div className="bg-surface border border-border rounded-lg p-4 space-y-3 text-sm text-ink-soft">
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>AI 生成的内容可能存在错误，请自行核实关键数据</li>
            <li>系统按"现状"提供，不保证无中断或无错误</li>
            <li>因不可抗力导致的服务中断，我们不承担责任</li>
            <li>您应定期备份数据，因未备份导致的数据丢失由您自行承担</li>
          </ul>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-ink">五、协议变更</h2>
        <div className="bg-surface border border-border rounded-lg p-4 text-sm text-ink-soft">
          <p>我们可能会不时更新本协议。如有重大变更，系统将主动通知您。继续使用本系统即表示您同意更新后的协议。</p>
        </div>
      </section>

      <div className="text-caption text-muted text-center pt-4 border-t border-border">
        本用户协议最后更新于 2026 年 8 月 2 日。
      </div>
    </div>
  )
}
