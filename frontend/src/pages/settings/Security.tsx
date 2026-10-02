import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ShieldCheck, ShieldOff, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import apiClient from '../../api/client'
import { useAuthStore } from '../../store/authStore'
import FormInput from '../../components/FormInput'
import Button from '../../components/Button'

/**
 * 安全设置：双因素认证（TOTP）自助绑定/解绑。
 *
 * 绑定流程（两步，防绑错）：
 *   1. 生成密钥 → 页面展示 Base32 密钥与 otpauth 链接，
 *      用户在认证器 App（Google Authenticator / Microsoft Authenticator /
 *      iOS 密码自带验证码等）里"手动添加账号"粘贴密钥；
 *   2. 输入认证器当前显示的 6 位码验证通过 → 正式启用。
 * 启用后登录页在密码之后会要求动态码（商用安全底线的 MFA 要件）。
 */
export default function SecuritySettings() {
  const user = useAuthStore((s) => s.user)
  const [setupInfo, setSetupInfo] = useState<{ secret: string; otpauthUrl: string } | null>(null)
  const [enableCode, setEnableCode] = useState('')
  const [disableForm, setDisableForm] = useState({ password: '', code: '' })
  // 当前启用状态：authStore 里的 user 是登录快照，重新拉一次保新鲜
  const [enabled, setEnabled] = useState<boolean | null>(null)
  if (enabled === null && user?.id) {
    apiClient.get(`/users/${user.id}`).then((res: any) => {
      setEnabled(!!res.data?.totpEnabled)
    }).catch(() => setEnabled(false))
  }

  const setupMutation = useMutation({
    mutationFn: () => apiClient.post('/auth/totp/setup'),
    onSuccess: (res: any) => {
      setSetupInfo(res.data)
      setEnableCode('')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || '生成密钥失败'),
  })

  const enableMutation = useMutation({
    mutationFn: () => apiClient.post('/auth/totp/enable', { code: enableCode }),
    onSuccess: () => {
      toast.success('双因素认证已启用，登录时将要求动态验证码')
      setEnabled(true)
      setSetupInfo(null)
      setEnableCode('')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || '验证失败'),
  })

  const disableMutation = useMutation({
    mutationFn: () => apiClient.post('/auth/totp/disable', disableForm),
    onSuccess: () => {
      toast.success('已关闭双因素认证')
      setEnabled(false)
      setDisableForm({ password: '', code: '' })
    },
    onError: (e: any) => toast.error(e.response?.data?.message || '操作失败'),
  })

  return (
    <div className="max-w-2xl">
      <h2 className="font-serif text-heading-lg font-medium text-ink mb-2">安全设置</h2>
      <p className="text-sm text-muted mb-6">
        双因素认证（TOTP）：密码之外再加一道动态码，防密码泄露导致的账号被盗。
        建议管理员账号务必开启。
      </p>

      <div className="eo-card p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {enabled ? <ShieldCheck size={16} className="text-success-fg" /> : <ShieldOff size={16} className="text-muted" />}
            <span className="text-sm font-medium text-ink">
              双因素认证{enabled === null ? '' : enabled ? ' · 已启用' : ' · 未启用'}
            </span>
          </div>
        </div>

        {enabled === false && !setupInfo && (
          <div>
            <p className="text-sm text-muted mb-3">
              当前仅使用密码登录。开启后，登录需要额外输入认证器 App 中的 6 位动态码。
            </p>
            <Button variant="secondary" size="sm" loading={setupMutation.isPending} onClick={() => setupMutation.mutate()}>
              <KeyRound size={14} className="mr-1" /> 开始绑定
            </Button>
          </div>
        )}

        {setupInfo && (
          <div className="space-y-3">
            <p className="text-sm text-ink-soft">第一步：把下面的密钥添加到认证器 App（选择"手动输入设置密钥"）。</p>
            <div className="bg-canvas rounded-md p-3 space-y-2">
              <div>
                <div className="eo-label mb-1">Base32 密钥（整行复制）</div>
                <code className="text-sm font-mono text-ink break-all select-all">{setupInfo.secret}</code>
              </div>
              <div>
                <div className="eo-label mb-1">otpauth 链接（部分 App 支持直接打开）</div>
                <code className="text-caption font-mono text-muted break-all select-all">{setupInfo.otpauthUrl}</code>
              </div>
            </div>
            <p className="text-sm text-ink-soft">第二步：输入认证器当前显示的 6 位动态码完成验证。</p>
            <div className="flex gap-2 items-end">
              <div className="w-40">
                <FormInput
                  label="动态验证码"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={enableCode}
                  onChange={(e) => setEnableCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="6 位数字"
                />
              </div>
              <Button size="sm" disabled={enableCode.length !== 6} loading={enableMutation.isPending} onClick={() => enableMutation.mutate()}>
                验证并启用
              </Button>
            </div>
          </div>
        )}

        {enabled && (
          <div className="space-y-3">
            <p className="text-sm text-muted">关闭双因素需要密码与当前动态码双重确认（防止会话被盗后直接摘除防护）。</p>
            <div className="grid grid-cols-2 gap-3">
              <FormInput
                label="登录密码"
                type="password"
                value={disableForm.password}
                onChange={(e) => setDisableForm((p) => ({ ...p, password: e.target.value }))}
              />
              <FormInput
                label="动态验证码"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={disableForm.code}
                onChange={(e) => setDisableForm((p) => ({ ...p, code: e.target.value.replace(/\D/g, '') }))}
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={!disableForm.password || disableForm.code.length !== 6}
              loading={disableMutation.isPending}
              onClick={() => disableMutation.mutate()}
            >
              关闭双因素认证
            </Button>
          </div>
        )}
      </div>

      <div className="eo-card p-5">
        <h3 className="text-sm font-semibold text-ink mb-2">其它安全建议</h3>
        <ul className="text-sm text-muted space-y-1.5 list-disc pl-5">
          <li>密码定期更换，不与其它系统复用（长度 ≥ 8，含字母与数字）。</li>
          <li>正式多人部署请启用 HTTPS（见 docs/备份与恢复.md 的 TLS 部署章节），并在 .env 打开 COOKIE_SECURE。</li>
          <li>操作记录（设置 → 操作记录）完整留存所有增删改与审批行为，异常时可回查。</li>
        </ul>
      </div>
    </div>
  )
}
