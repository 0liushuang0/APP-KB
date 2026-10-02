import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Zap, FileText, Key, ArrowRight, X } from 'lucide-react'
import apiClient from '../api/client'
import Button from './Button'

/**
 * 首次使用引导向导。
 *
 * 检测系统是否已配置 AI Key + 是否有文档，
 * 如果都没有，说明是首次使用，显示引导。
 */
export default function OnboardingWizard() {
  const navigate = useNavigate()
  const [dismissed, setDismissed] = useState(false)
  const [step, setStep] = useState(0)

  const { data: aiConfig } = useQuery({
    queryKey: ['ai-config-check'],
    queryFn: async () => {
      try {
        const res: any = await apiClient.get('/ai-config')
        return res.data
      } catch {
        return null
      }
    },
    retry: false,
    staleTime: 60000,
  })

  // 判断是否需要显示引导
  const hasAiKey = aiConfig?.deepseek?.apiKey || aiConfig?.glm?.apiKey

  useEffect(() => {
    // 如果已配置 Key 或已关闭引导，不显示
    if (hasAiKey || dismissed) return
    // 检查本地是否已关闭
    const closed = localStorage.getItem('aikb-onboarding-dismissed')
    if (closed) setDismissed(true)
  }, [hasAiKey, dismissed])

  if (dismissed || hasAiKey) return null

  const steps = [
    {
      icon: Zap,
      title: '欢迎使用 BOYA 智能知识中心',
      desc: '系统已就绪，接下来配置 AI 能力让知识库更智能。',
      action: () => setStep(1),
      actionLabel: '开始配置',
    },
    {
      icon: Key,
      title: '配置 AI 大模型',
      desc: '填写 DeepSeek 或智谱 GLM 的 API Key，即可使用智能问答、需求结构化、方案生成等 AI 功能。',
      action: () => {
        navigate('/settings/ai')
        setDismissed(true)
        localStorage.setItem('aikb-onboarding-dismissed', 'true')
      },
      actionLabel: '前往配置',
    },
    {
      icon: FileText,
      title: '导入业务资料',
      desc: '上传客户文档、技术方案、报价单等资料，系统会自动解析并建立索引，支持智能检索。',
      action: () => {
        navigate('/documents')
        setDismissed(true)
        localStorage.setItem('aikb-onboarding-dismissed', 'true')
      },
      actionLabel: '前往导入',
    },
  ]

  const current = steps[step]

  const handleDismiss = () => {
    setDismissed(true)
    localStorage.setItem('aikb-onboarding-dismissed', 'true')
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-80 bg-surface rounded-xl shadow-lg border border-border overflow-hidden animate-slide-up">
      <div className="p-5">
        <button
          onClick={handleDismiss}
          title="不再提示"
          className="absolute top-3 right-3 text-muted hover:text-ink-soft transition-colors"
        >
          <X size={16} />
        </button>

        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-lg bg-accent-50 flex items-center justify-center">
            <current.icon size={20} className="text-accent-600" />
          </div>
          <h3 className="text-sm font-semibold text-ink">{current.title}</h3>
        </div>

        <p className="text-sm text-muted mb-4 leading-relaxed">{current.desc}</p>

        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            {steps.map((_, i) => (
              <div
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  i === step ? 'bg-accent-600' : 'bg-border'
                }`}
              />
            ))}
          </div>
          <Button size="sm" onClick={current.action}>
            {current.actionLabel}
            <ArrowRight size={13} className="ml-1" />
          </Button>
        </div>
      </div>
    </div>
  )
}
