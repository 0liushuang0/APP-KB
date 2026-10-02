import { useState } from 'react'
import { ThumbsUp, ThumbsDown, Flag, Send, Check, BookPlus } from 'lucide-react'
import { toast } from 'sonner'
import apiClient from '../api/client'

interface AIFeedbackProps {
  messageId: string
  sessionId: string
  module?: string
  /** 传入问答原文后，高分反馈可一键沉淀为知识库 FAQ */
  question?: string
  answer?: string
}

type Rating = 'positive' | 'negative' | null

export default function AIFeedback({ messageId, sessionId, module = 'ai-assistant', question, answer }: AIFeedbackProps) {
  const [rating, setRating] = useState<Rating>(null)
  const [comment, setComment] = useState('')
  const [showComment, setShowComment] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  // 提交成功后留下的反馈 id，转 FAQ 时后端据此校验是高分反馈
  const [feedbackId, setFeedbackId] = useState('')
  const [savedFaq, setSavedFaq] = useState(false)
  const [savingFaq, setSavingFaq] = useState(false)

  const handleRate = (value: 'positive' | 'negative') => {
    if (submitted) return
    setRating(value)
    if (value === 'negative') {
      setShowComment(true)
    } else {
      submitFeedback(value)
    }
  }

  const submitFeedback = async (finalRating?: 'positive' | 'negative') => {
    const r = finalRating || rating
    if (!r) return
    setSubmitting(true)
    try {
      const res: any = await apiClient.post('/ai-feedback', {
        messageId,
        rating: r,
        comment: comment.trim() || undefined,
        sessionId,
        module,
      })
      setFeedbackId(res?.data?.id || res?.id || '')
      setSubmitted(true)
      setShowComment(false)
    } catch {
      // 静默失败
    } finally {
      setSubmitting(false)
    }
  }

  /** 高分问答沉淀为 FAQ：写入知识库 FAQ常见问题 分组，供后续检索复用 */
  const saveAsFaq = async () => {
    if (!feedbackId || savingFaq) return
    setSavingFaq(true)
    try {
      await apiClient.post(`/ai-feedback/${feedbackId}/convert-to-faq`, { question, answer })
      setSavedFaq(true)
      toast.success('已沉淀到知识库 FAQ常见问题')
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || '沉淀失败')
    } finally {
      setSavingFaq(false)
    }
  }

  if (submitted) {
    return (
      <div className="flex items-center gap-2 text-caption text-success-fg">
        <span className="flex items-center gap-1.5">
          <Check size={12} />
          感谢反馈
        </span>
        {/* 仅高分且带问答原文时提供沉淀入口 */}
        {rating === 'positive' && question && answer && !savedFaq && (
          <button
            onClick={saveAsFaq}
            disabled={savingFaq}
            className="inline-flex items-center gap-1 text-muted hover:text-accent-600 transition-colors disabled:opacity-50"
          >
            <BookPlus size={12} /> {savingFaq ? '沉淀中…' : '存为FAQ'}
          </button>
        )}
        {savedFaq && <span className="text-muted">已存入FAQ</span>}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <button
          onClick={() => handleRate('positive')}
          disabled={submitted}
          className={`p-1 rounded transition-colors ${
            rating === 'positive'
              ? 'text-accent-600 bg-accent-50'
              : 'text-muted hover:text-accent-600 hover:bg-accent-50'
          } disabled:opacity-50`}
          title="有帮助"
        >
          <ThumbsUp size={13} />
        </button>
        <button
          onClick={() => handleRate('negative')}
          disabled={submitted}
          className={`p-1 rounded transition-colors ${
            rating === 'negative'
              ? 'text-danger-fg bg-danger-bg'
              : 'text-muted hover:text-danger-fg hover:bg-danger-bg'
          } disabled:opacity-50`}
          title="需改进"
        >
          <ThumbsDown size={13} />
        </button>
        <button
          onClick={() => {
            setRating('negative')
            setShowComment(true)
          }}
          disabled={submitted}
          className="p-1 rounded text-muted hover:text-warning-fg hover:bg-warning-bg transition-colors disabled:opacity-50"
          title="报告问题"
        >
          <Flag size={13} />
        </button>
      </div>

      {showComment && !submitted && (
        <div className="flex gap-2 items-end">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="请描述问题或建议（可选）"
            className="eo-input flex-1 text-caption p-2 min-h-[60px] resize-none"
            rows={2}
          />
          <button
            onClick={() => submitFeedback()}
            disabled={submitting}
            className="px-3 py-2 bg-accent-600 text-white rounded-md text-caption hover:bg-accent-700 transition-colors disabled:opacity-50 flex items-center gap-1"
          >
            <Send size={12} />
            {submitting ? '提交中' : '提交'}
          </button>
        </div>
      )}
    </div>
  )
}
