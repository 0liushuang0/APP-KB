import { Keyboard, X, Navigation, Zap, Settings } from 'lucide-react'

interface ShortcutItem {
  keys: string[]
  description: string
}

interface ShortcutSection {
  title: string
  icon: typeof Keyboard
  items: ShortcutItem[]
}

const shortcutSections: ShortcutSection[] = [
  {
    title: '导航',
    icon: Navigation,
    items: [
      { keys: ['Ctrl', 'K'], description: '全局搜索' },
      { keys: ['Ctrl', '/'], description: '键盘快捷键帮助' },
    ],
  },
  {
    title: '操作',
    icon: Zap,
    items: [
      /* 只列真实存在的快捷键。原先这里的 Ctrl+S/Ctrl+N 并未实现，
         用户照按只会触发浏览器默认行为（保存网页），属于虚假承诺。 */
      { keys: ['Enter'], description: '打开聚焦的行 / 激活按钮' },
      { keys: ['↑', '↓'], description: '全局搜索结果间移动' },
    ],
  },
  {
    title: '通用',
    icon: Settings,
    items: [
      { keys: ['Esc'], description: '关闭弹窗/抽屉' },
      { keys: ['Tab'], description: '切换焦点元素' },
    ],
  },
]

interface KeyboardShortcutsProps {
  isOpen: boolean
  onClose: () => void
}

export default function KeyboardShortcuts({ isOpen, onClose }: KeyboardShortcutsProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-surface rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Keyboard size={18} className="text-accent-600" />
            <h2 className="font-serif text-heading-md font-semibold text-ink">键盘快捷键</h2>
          </div>
          <button
            onClick={onClose}
            title="关闭"
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted hover:text-ink hover:bg-canvas transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[60vh] overflow-y-auto">
          {shortcutSections.map((section) => {
            const Icon = section.icon
            return (
              <div key={section.title}>
                <div className="flex items-center gap-2 mb-3">
                  <Icon size={15} className="text-accent-600" />
                  <h3 className="text-body-sm font-semibold text-ink">{section.title}</h3>
                </div>
                <div className="space-y-2">
                  {section.items.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between py-1.5 px-3 rounded-lg hover:bg-subtle"
                    >
                      <span className="text-body-sm text-ink-soft">{item.description}</span>
                      <div className="flex items-center gap-1">
                        {item.keys.map((key, ki) => (
                          <kbd
                            key={ki}
                            className="px-2 py-0.5 text-caption font-mono bg-canvas border border-border rounded-md text-ink-soft"
                          >
                            {key}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        <div className="px-5 py-3 border-t border-border bg-subtle">
          <p className="text-caption text-muted text-center">
            按 <kbd className="px-1.5 py-0.5 text-caption font-mono bg-canvas border border-border rounded-md">Esc</kbd> 关闭
          </p>
        </div>
      </div>
    </div>
  )
}
