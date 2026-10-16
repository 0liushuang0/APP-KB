import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Sparkles, ClipboardPaste } from 'lucide-react'
import { customerApi } from '../api/services'
import Modal from './Modal'
import Button from './Button'
import FormInput from './FormInput'
import FormSelect from './FormSelect'
import FormTextarea from './FormTextarea'
import EntityFileUpload from './EntityFileUpload'
import { FormSection, FieldGrid } from './layout-kit'

const METHOD_OPTIONS = ['拜访', '电话', '邮件', '微信', '会议', '展会'].map((v) => ({ value: v, label: v }))

const today = () => new Date().toISOString().slice(0, 10)
const emptyForm = () => ({
  method: '电话',
  followUpAt: today(),
  participants: '',
  customerParticipants: '',
  content: '',
  focusPoints: '',
  nextAction: '',
  deadline: '',
  requirementId: '',
})

/**
 * 记一笔沟通。
 *
 * 原来客户 360 的「沟通记录」只能看、没有录入口（近 7 天 0 条）。现在：
 * 把邮件或微信聊天整段粘进来 →「自动整理」（规则 + 大模型）填好方式、日期、双方参与人、摘要、关注点、下一步 →
 * 人核对后保存；截图等文件可直接附在下方，归入该客户资料。
 */
export default function FollowUpModal({
  open,
  onClose,
  customerId,
  requirements = [],
}: {
  open: boolean
  onClose: () => void
  customerId: string
  requirements?: Array<{ id: string; requirementNo?: string; title?: string }>
}) {
  const queryClient = useQueryClient()
  const [paste, setPaste] = useState('')
  const [form, setForm] = useState(emptyForm())
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [aiNote, setAiNote] = useState('')

  useEffect(() => {
    if (open) {
      setForm(emptyForm())
      setPaste('')
      setAiNote('')
    }
  }, [open])

  const set = (k: keyof ReturnType<typeof emptyForm>, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const parse = async () => {
    if (!paste.trim()) {
      toast.error('先把邮件或聊天内容粘贴进来')
      return
    }
    setParsing(true)
    try {
      const d = await customerApi.parseFollowUp(customerId, paste)
      setForm((f) => ({
        ...f,
        method: d.method || f.method,
        followUpAt: d.followUpAt ? String(d.followUpAt).slice(0, 10) : f.followUpAt,
        participants: d.participants || f.participants,
        customerParticipants: d.customerParticipants || f.customerParticipants,
        content: d.content || f.content,
        focusPoints: d.focusPoints || '',
        nextAction: d.nextAction || '',
        deadline: d.deadline ? String(d.deadline).slice(0, 10) : '',
      }))
      setAiNote(d.aiUsed ? '已由 AI 整理摘要与字段（原文附在内容末尾），请核对后保存' : 'AI 暂不可用，已按规则提取，请核对后保存')
    } catch (e: any) {
      toast.error(e?.response?.data?.message || '整理失败，可直接手填')
    } finally {
      setParsing(false)
    }
  }

  const save = async () => {
    if (!form.content.trim()) {
      toast.error('沟通内容不能为空')
      return
    }
    setSaving(true)
    try {
      await customerApi.addFollowUp({
        customerId,
        method: form.method,
        followUpAt: form.followUpAt ? new Date(`${form.followUpAt}T12:00:00`).toISOString() : undefined,
        participants: form.participants || undefined,
        customerParticipants: form.customerParticipants || undefined,
        content: form.content.trim(),
        focusPoints: form.focusPoints || undefined,
        nextAction: form.nextAction || undefined,
        deadline: form.deadline || undefined,
        requirementId: form.requirementId || undefined,
      })
      toast.success('已记入客户时间线')
      queryClient.invalidateQueries({ queryKey: ['customer-360', customerId] })
      queryClient.invalidateQueries({ queryKey: ['customer-timeline', customerId] })
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="记一笔沟通" onConfirm={save} loading={saving} confirmText="保存" size="lg">
      <div className="space-y-5">
        <FormSection title="粘贴邮件 / 聊天记录" icon={ClipboardPaste} hint="整段粘贴即可，系统自动整理成下面的字段">
          <FormTextarea
            label=""
            rows={5}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder={'例：\nFrom: Rahul <rahul@xxx.com>\nSubject: Tension leveller quotation\n……\n\n或微信聊天：\n王经理 10:32\n宽度改成 1650，下周安排技术交流'}
          />
          <div className="flex items-center gap-3 mt-2">
            <Button type="button" variant="secondary" size="sm" onClick={parse} loading={parsing}>
              <Sparkles size={14} className="mr-1" /> 自动整理
            </Button>
            {aiNote && <span className="text-caption text-muted">{aiNote}</span>}
          </div>
        </FormSection>

        <FormSection title="沟通内容">
          <FieldGrid>
            <FormSelect label="沟通方式" options={METHOD_OPTIONS} value={form.method} onChange={(e) => set('method', e.target.value)} />
            <FormInput label="沟通日期" type="date" value={form.followUpAt} onChange={(e) => set('followUpAt', e.target.value)} />
            <FormInput label="我方参与人" value={form.participants} onChange={(e) => set('participants', e.target.value)} />
            <FormInput label="客户方参与人" value={form.customerParticipants} onChange={(e) => set('customerParticipants', e.target.value)} />
          </FieldGrid>
          <FormTextarea label="内容" rows={5} value={form.content} onChange={(e) => set('content', e.target.value)} required />
          <FieldGrid>
            <FormInput label="客户关注点" value={form.focusPoints} onChange={(e) => set('focusPoints', e.target.value)} />
            <FormInput label="下一步行动" value={form.nextAction} onChange={(e) => set('nextAction', e.target.value)} />
            <FormInput label="下一步截止" type="date" value={form.deadline} onChange={(e) => set('deadline', e.target.value)} />
            <FormSelect
              label="关联需求（可选）"
              options={[{ value: '', label: '不关联' }, ...requirements.map((r) => ({ value: r.id, label: `${r.requirementNo || ''} ${r.title || ''}`.trim() }))]}
              value={form.requirementId}
              onChange={(e) => set('requirementId', e.target.value)}
            />
          </FieldGrid>
        </FormSection>

        <FormSection title="截图 / 附件" hint="聊天截图、邮件附件直接传，归入该客户资料并出现在时间线上">
          <EntityFileUpload entityType="customer" entityId={customerId} customerId={customerId} category="沟通记录附件" flat />
        </FormSection>
      </div>
    </Modal>
  )
}
