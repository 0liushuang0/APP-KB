import { useState } from 'react'
import { Shield, ExternalLink, CheckCircle } from 'lucide-react'

/**
 * 隐私政策同意弹窗。
 *
 * 首次使用时显示，用户必须同意后才能使用系统。
 * 同意记录保存在 localStorage 中。
 */
export default function PrivacyConsent({
  onAccept,
}: {
  onAccept: () => void
}) {
  const [agreed, setAgreed] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleAccept = () => {
    setLoading(true)
    localStorage.setItem('aikb-privacy-consent', JSON.stringify({
      version: '1.0',
      acceptedAt: new Date().toISOString(),
    }))
    onAccept()
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-surface rounded-xl shadow-2xl max-w-lg w-full overflow-hidden">
        <div className="bg-accent-50 p-6 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-accent-100 flex items-center justify-center">
            <Shield size={24} className="text-accent-600" />
          </div>
          <div>
            <h2 className="font-serif text-lg font-semibold text-ink">数据安全与隐私</h2>
            <p className="text-sm text-muted">使用前请了解我们的数据处理方式</p>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="space-y-3 text-sm text-ink-soft">
            <div className="flex items-start gap-2">
              <CheckCircle size={16} className="text-success-fg shrink-0 mt-0.5" />
              <span><strong>本地优先</strong>：业务资料存储在您的设备上，不会自动上传</span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle size={16} className="text-success-fg shrink-0 mt-0.5" />
              <span><strong>最小上传</strong>：仅 AI 功能使用时，文本片段加密传输至云端（原文不上传）</span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle size={16} className="text-success-fg shrink-0 mt-0.5" />
              <span><strong>自动脱敏</strong>：传输前自动隐藏手机号、身份证号等个人信息</span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle size={16} className="text-success-fg shrink-0 mt-0.5" />
              <span><strong>可选本地模式</strong>：可完全禁用云端 AI，所有数据不出设备</span>
            </div>
          </div>

          <div className="bg-canvas rounded-lg p-3 text-caption text-muted">
            点击"同意并继续"即表示您已阅读并同意我们的隐私政策和用户协议。
            <div className="flex gap-3 mt-1">
              <a href="/privacy" target="_blank" className="text-accent-600 hover:underline inline-flex items-center gap-1">
                隐私政策 <ExternalLink size={10} />
              </a>
              <a href="/terms" target="_blank" className="text-accent-600 hover:underline inline-flex items-center gap-1">
                用户协议 <ExternalLink size={10} />
              </a>
            </div>
          </div>

          <label className="flex items-start gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 rounded border-border"
            />
            <span className="text-sm text-ink">我已阅读并同意隐私政策和用户协议</span>
          </label>
        </div>

        <div className="px-6 pb-6">
          <button
            onClick={handleAccept}
            disabled={!agreed || loading}
            className="w-full py-2.5 bg-accent-600 text-white rounded-lg font-medium hover:bg-accent-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? '处理中...' : '同意并继续'}
          </button>
        </div>
      </div>
    </div>
  )
}
