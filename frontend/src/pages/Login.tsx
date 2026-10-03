import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Zap, Loader2, Eye, EyeOff, Shield } from 'lucide-react'
import apiClient from '../api/client'
import { useSystemNameStore } from '../store/systemNameStore'
import { useAuthStore } from '../store/authStore'
import FormInput from '../components/FormInput'
import { zhSso } from '../lib/zh-embed'

const MAX_CONNECT_ATTEMPTS = 5

export default function Login() {
  const navigate = useNavigate()
  const { setAuth } = useAuthStore()
  // 登录页也读配置：/system/info 是公开接口，未登录也能拿到系统名
  const systemName = useSystemNameStore((s) => s.name)
  const systemSubtitle = useSystemNameStore((s) => s.subtitle)
  const fetchSystemName = useSystemNameStore((s) => s.fetchName)

  useEffect(() => {
    fetchSystemName()
  }, [fetchSystemName])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [isConnError, setIsConnError] = useState(false)
  // 双因素：后端返回 TOTP_REQUIRED 标记时展开 6 位动态码输入
  const [totpCode, setTotpCode] = useState('')
  const [needTotp, setNeedTotp] = useState(false)
  const [step, setStep] = useState<'loading' | 'form' | 'auto-login'>('loading')

  // 恢复记住的用户名
  useEffect(() => {
    const saved = localStorage.getItem('aikb-remember-user')
    if (saved) setUsername(saved)
  }, [])

  const handleSingleModeLogin = async () => {
    try {
      setLoading(true)
      const res: any = await apiClient.post('/auth/single-mode-login')
      setAuth({ user: res.data.user })
      navigate('/', { replace: true })
    } catch (err: any) {
      setError(err.response?.data?.message || '自动登录失败，请手动登录')
      setStep('form')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    let attempts = 0

    // 先检测后端模式；后端可能还在启动中，自动重试几次
    const detectMode = async () => {
      // 智汇工作台内嵌: 先用统一登录换取本系统登录态(未内嵌/未接入平台时直接跳过)
      if (attempts === 0) {
        const sso = await zhSso()
        if (cancelled) return
        if (sso?.user) {
          setAuth({ user: sso.user })
          navigate('/', { replace: true })
          return
        }
      }
      // 显式退出登录后不再自动登录，展示手动登录表单
      if (sessionStorage.getItem('aikb-skip-auto-login')) {
        setStep('form')
        return
      }
      try {
        const res: any = await apiClient.get('/auth/mode')
        if (cancelled) return
        const mode = res.data?.mode || 'single'
        if (mode === 'single') {
          setStep('auto-login')
          handleSingleModeLogin()
        } else {
          setStep('form')
        }
      } catch {
        if (cancelled) return
        attempts += 1
        if (attempts < MAX_CONNECT_ATTEMPTS) {
          setTimeout(detectMode, 1000)
        } else {
          setStep('form')
          setIsConnError(true)
          setError('无法连接到服务器，请确认后端已启动')
        }
      }
    }
    detectMode()

    return () => {
      cancelled = true
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsConnError(false)
    setLoading(true)
    try {
      const res: any = await apiClient.post('/auth/login', {
        username,
        password,
        ...(needTotp && totpCode ? { totpCode } : {}),
      })
      setAuth({ user: res.data.user })
      if (rememberMe) {
        localStorage.setItem('aikb-remember-user', username)
      } else {
        localStorage.removeItem('aikb-remember-user')
      }
      sessionStorage.removeItem('aikb-skip-auto-login')
      navigate('/', { replace: true })
    } catch (err: any) {
      const msg = err.response?.data?.message || '用户名或密码错误'
      if (msg === 'TOTP_REQUIRED') {
        setNeedTotp(true)
        setError('该账号已启用双因素认证，请输入认证器中的 6 位动态码')
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="zh-login">
      <div className="contents">

        <div className="zh-login-card bg-surface">
          {/* 品牌头(智汇统一登录页) */}
          <div className="zh-login-brand">
            <div className="zh-brand-mark">
              <Zap fill="white" />
            </div>
            <div className="min-w-0">
              <div className="zh-login-title text-ink">{systemName}</div>
              <div className="zh-login-sub text-muted">{systemSubtitle}</div>
            </div>
          </div>
          {/* 自动登录状态 */}
          {step === 'loading' && (
            <div className="text-center space-y-4">
              <Loader2 size={32} className="animate-spin text-accent-600 mx-auto" />
              <p className="text-sm text-muted">正在连接服务器…</p>
            </div>
          )}

          {/* 自动登录中 */}
          {step === 'auto-login' && (
            <div className="text-center space-y-6">
              <div className="w-16 h-16 rounded-2xl bg-accent-50 flex items-center justify-center mx-auto">
                <Loader2 size={28} className="animate-spin text-accent-600" />
              </div>
              <div>
                <h2 className="font-serif text-xl font-medium text-ink mb-1">正在进入工作台</h2>
                <p className="text-sm text-muted">单用户模式，自动登录中…</p>
              </div>
              {error && (
                <div className="text-danger-fg text-sm bg-danger-bg px-4 py-3 rounded-lg">
                  <p className="font-medium mb-1">自动登录失败</p>
                  <p className="text-danger-fg/80">{error}</p>
                  <button
                    onClick={() => { setError(''); setStep('form') }}
                    className="mt-3 text-accent-600 hover:text-accent-700 text-sm font-medium"
                  >
                    切换到手动登录 →
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 登录表单 */}
          {step === 'form' && (
            <>
              <div className="mb-8">
                <h2 className="font-serif text-2xl font-medium text-ink mb-1">欢迎回来</h2>
                <p className="text-sm text-muted">请输入您的账号登录系统</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <FormInput
                  label="用户名"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoFocus
                  placeholder="请输入用户名"
                />

                <div className="relative">
                  <FormInput
                    label="密码"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="请输入密码"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-[2.15rem] text-muted hover:text-ink-soft transition-colors"
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>

                {needTotp && (
                  <FormInput
                    label="动态验证码（双因素）"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="认证器中的 6 位数字"
                    autoFocus
                  />
                )}

                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="rounded border-border w-3.5 h-3.5"
                    />
                    <span className="text-sm text-muted">记住用户名</span>
                  </label>
                </div>

                {error && (
                  <div className="text-danger-fg text-sm bg-danger-bg px-4 py-3 rounded-lg flex items-start gap-2">
                    <Shield size={15} className="shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p>{error}</p>
                      {isConnError && (
                        <button
                          type="button"
                          onClick={() => window.location.reload()}
                          className="mt-2 text-accent-600 hover:text-accent-700 text-sm font-medium"
                        >
                          重新连接 →
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || !username || !password}
                  className="w-full py-2.5 px-4 bg-accent-600 text-white rounded-lg font-medium hover:bg-accent-700 active:bg-accent-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-[0_2px_8px_rgba(4,120,87,.25)] hover:shadow-[0_4px_12px_rgba(4,120,87,.35)]"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 size={16} className="animate-spin" /> 登录中…
                    </span>
                  ) : (
                    '登录'
                  )}
                </button>
              </form>

              {/* 底部信息 */}
              <div className="mt-8 text-center space-y-1">
                <p className="text-caption text-muted">
                  首次使用？系统会自动生成管理员账号，请查看启动日志。
                </p>
                <p className="text-caption text-muted/60">
                  资料本地处理 · 数据安全可控
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
