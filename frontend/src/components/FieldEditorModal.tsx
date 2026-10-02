import { useEffect, useState } from 'react'
import Modal from './Modal'
import FormInput from './FormInput'
import FormSelect from './FormSelect'
import FormTextarea from './FormTextarea'

export interface TemplateField {
  key: string
  label: string
  unit: string
  type: string
  section: string
  required: boolean
  remark?: string
  options?: string[]
}

export const FIELD_TYPES = [
  { value: 'text', label: '文本' },
  { value: 'number', label: '数值' },
  { value: 'range', label: '区间' },
  { value: 'select', label: '单选' },
  { value: 'multiselect', label: '多选' },
  { value: 'checkbox', label: '勾选' },
  { value: 'textarea', label: '长文本' },
]

export const typeLabel = (t?: string) => FIELD_TYPES.find((o) => o.value === t)?.label || t || '文本'

/** 需要枚举值的类型 —— 只有这些才显示"可选值"输入 */
const NEEDS_OPTIONS = new Set(['select', 'multiselect'])

const empty: TemplateField = {
  key: '',
  label: '',
  unit: '',
  type: 'text',
  section: '',
  required: false,
  remark: '',
  options: [],
}

interface Props {
  open: boolean
  onClose: () => void
  onSave: (field: TemplateField) => void
  /** 编辑时传入原字段；新增时为 null */
  field: TemplateField | null
  /** 已有分组，供下拉选择 */
  sections: string[]
  /** 已存在的 key，用于查重（编辑时排除自身） */
  existingKeys: string[]
  defaultSection?: string
}

/**
 * 单个字段的编辑器。
 *
 * 原先整张字段表只能通过一个 JSON 文本域改 —— 想删掉一个字段，
 * 用户得在几十行 JSON 里手工找到那段并保证逗号括号不出错，
 * 改坏了整张模板就失效。字段是需求卡片的结构定义，
 * 必须能像改表格一行那样安全地增删改。
 */
export default function FieldEditorModal({
  open,
  onClose,
  onSave,
  field,
  sections,
  existingKeys,
  defaultSection,
}: Props) {
  const [form, setForm] = useState<TemplateField>(empty)
  const [optionsText, setOptionsText] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const initial = field ? { ...empty, ...field } : { ...empty, section: defaultSection || sections[0] || '' }
    setForm(initial)
    setOptionsText((initial.options || []).join('\n'))
    setError(null)
  }, [open, field, defaultSection, sections])

  const set = <K extends keyof TemplateField>(k: K, v: TemplateField[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  const handleSave = () => {
    const key = form.key.trim()
    const label = form.label.trim()

    if (!label) return setError('请填写字段名')
    if (!key) return setError('请填写标识（key）')
    // key 是结构化结果里的字段名，下游方案匹配靠它对齐，必须是安全标识符
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) {
      return setError('标识只能用字母、数字、下划线，且以字母开头')
    }
    if (existingKeys.includes(key)) return setError(`标识「${key}」已被其他字段占用`)

    const options = NEEDS_OPTIONS.has(form.type)
      ? optionsText.split('\n').map((s) => s.trim()).filter(Boolean)
      : undefined
    if (NEEDS_OPTIONS.has(form.type) && (!options || options.length === 0)) {
      return setError('单选/多选必须至少给一个可选值')
    }

    const next: TemplateField = {
      key,
      label,
      unit: form.unit.trim(),
      type: form.type,
      section: form.section.trim() || '其他',
      required: !!form.required,
    }
    if (form.remark?.trim()) next.remark = form.remark.trim()
    if (options) next.options = options

    onSave(next)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={field ? `编辑字段 · ${field.label}` : '新增字段'}
      onConfirm={handleSave}
      size="lg"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormInput
            label="字段名"
            value={form.label}
            onChange={(e) => set('label', e.target.value)}
            placeholder="例如：辊身直径"
            required
          />
          <FormInput
            label="标识 (key)"
            value={form.key}
            onChange={(e) => set('key', e.target.value)}
            placeholder="例如：roll_diameter"
            helper="结构化结果与方案匹配都按它对齐，建立后尽量不要改"
            required
          />
          <FormSelect
            label="类型"
            options={FIELD_TYPES}
            value={form.type}
            onChange={(e) => set('type', e.target.value)}
          />
          <FormInput
            label="单位"
            value={form.unit}
            onChange={(e) => set('unit', e.target.value)}
            placeholder="例如：mm / kN / ℃，无单位留空"
          />
          <div>
            <label className="block eo-label mb-1.5">分组</label>
            <input
              list="section-options"
              value={form.section}
              onChange={(e) => set('section', e.target.value)}
              placeholder="例如：来料信息"
              className="eo-input"
            />
            <datalist id="section-options">
              {sections.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <p className="mt-1 text-xs text-muted">可选已有分组，也可直接输入新分组名</p>
          </div>
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={form.required}
                onChange={(e) => set('required', e.target.checked)}
                className="w-4 h-4 accent-accent-600"
              />
              必填项（缺失时需求卡会列入待确认）
            </label>
          </div>
        </div>

        {NEEDS_OPTIONS.has(form.type) && (
          <FormTextarea
            label="可选值"
            value={optionsText}
            onChange={(e) => setOptionsText(e.target.value)}
            rows={4}
            placeholder={'每行一个，例如：\n胀套式\n键连接\n法兰式'}
            helper="每行一个选项"
          />
        )}

        <FormTextarea
          label="说明"
          value={form.remark || ''}
          onChange={(e) => set('remark', e.target.value)}
          rows={2}
          placeholder="填写口径、取值依据或与客户确认的注意事项"
        />

        {error && (
          <div className="bg-danger-bg border border-danger-line text-danger-fg text-sm rounded-md px-3 py-2">
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}
