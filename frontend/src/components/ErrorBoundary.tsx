import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw, Copy, Home, Check } from 'lucide-react'
import { reportClientError } from '../api/errorReport'

interface Props {
  children: ReactNode
  /** 边界名，用于区分是整页崩了还是某个区块崩了 */
  scope?: string
  /** 区块级边界用紧凑样式，不占满整屏 */
  compact?: boolean
  /** 路由变化时重置，避免跳到新页面还停在错误态 */
  resetKey?: string
}

interface State {
  error: Error | null
  info: ErrorInfo | null
  copied: boolean
}

/**
 * 错误边界。
 *
 * 此前全项目没有任何边界：一个组件渲染时抛异常（后端返回意外结构、
 * 数组变 null、日期解析失败）就整页白屏，用户只能刷新，而你收不到任何线索。
 * 商用产品不能这样 —— 这里保证「出错也留在应用内」，并把现场回传后端便于售后定位。
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null, copied: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info })
    // 上报失败不能再抛，否则会掉进错误处理自身的死循环
    reportClientError({
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack ?? undefined,
      scope: this.props.scope,
      url: window.location.href,
    }).catch(() => undefined)
  }

  componentDidUpdate(prev: Props) {
    // 路由切换后自动复位，用户不必手动点重试
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null, info: null, copied: false })
    }
  }

  private reset = () => this.setState({ error: null, info: null, copied: false })

  private copyDetail = async () => {
    const { error, info } = this.state
    const detail = [
      `时间：${new Date().toLocaleString('zh-CN')}`,
      `页面：${window.location.href}`,
      `位置：${this.props.scope || '未知'}`,
      `错误：${error?.message}`,
      '',
      error?.stack,
      '',
      info?.componentStack,
    ]
      .filter(Boolean)
      .join('\n')
    try {
      await navigator.clipboard.writeText(detail)
      this.setState({ copied: true })
      setTimeout(() => this.setState({ copied: false }), 2000)
    } catch {
      /* 剪贴板不可用时忽略 */
    }
  }

  render() {
    const { error, copied } = this.state
    if (!error) return this.props.children

    // 区块级：只把出错的那块换成提示，页面其余部分照常可用
    if (this.props.compact) {
      return (
        <div className="eo-card p-5 flex items-start gap-3">
          <AlertTriangle size={18} className="text-danger-fg mt-0.5 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-body-sm font-semibold text-ink">这个区块加载失败</div>
            <p className="text-label text-muted mt-0.5 break-words">{error.message}</p>
          </div>
          <button
            onClick={this.reset}
            className="text-label text-accent-600 hover:text-accent-700 flex-shrink-0"
          >
            重试
          </button>
        </div>
      )
    }

    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="eo-card p-8 max-w-lg w-full text-center">
          <div className="w-12 h-12 rounded-xl bg-danger-bg flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={22} className="text-danger-fg" />
          </div>

          <h1 className="font-serif text-heading-md font-medium text-ink">页面出错了</h1>
          <p className="text-body-sm text-muted mt-2">
            这不是你的操作问题。已自动记录现场信息，可复制后发给技术支持。
          </p>

          <div className="mt-4 text-left bg-subtle rounded-md p-3">
            <div className="eo-label mb-1">错误信息</div>
            <p className="text-label text-ink-soft font-mono break-words">{error.message}</p>
          </div>

          <div className="flex items-center justify-center gap-2 mt-5 flex-wrap">
            <button
              onClick={this.reset}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-accent-500 text-white
                text-body-sm font-medium hover:bg-accent-600 transition-colors"
            >
              <RotateCcw size={14} /> 重试
            </button>
            <button
              onClick={() => {
                window.location.href = '/'
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md border border-border
                text-body-sm text-ink-soft hover:bg-canvas transition-colors"
            >
              <Home size={14} /> 回到首页
            </button>
            <button
              onClick={this.copyDetail}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md border border-border
                text-body-sm text-ink-soft hover:bg-canvas transition-colors"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? '已复制' : '复制详情'}
            </button>
          </div>
        </div>
      </div>
    )
  }
}

