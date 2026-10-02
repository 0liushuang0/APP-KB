import { useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Play,
  AlertTriangle,
  CheckCircle2,
  FunctionSquare,
  SlidersHorizontal,
  Info,
  FileClock,
} from 'lucide-react'
import { calcToolApi } from '../api/services'
import type { CalcTemplate, CalcInputDef, CalcFormulaDef, CalcResult } from '../types'
import { useDebounce } from '../hooks/useDebounce'
import Modal from './Modal'
import Button from './Button'
import FormInput from './FormInput'
import FormSelect from './FormSelect'
import Tabs from './Tabs'

interface Props {
  open: boolean
  onClose: () => void
  /** 传入表示编辑现有模板，不传是新建 */
  template?: CalcTemplate | null
  /** 新建时预置的分类，从左侧「在该分类下新增」进来时用 */
  defaultCategory?: string
  existingCategories: string[]
  existingCodes: string[]
  onSaved: (t: CalcTemplate) => void
}

type Problem = { level: 'error' | 'warn'; at: string; message: string }

const ICON_OPTIONS = [
  { value: 'Calculator', label: '通用计算器' },
  { value: 'Gauge', label: '仪表（产能 / 速度）' },
  { value: 'Ruler', label: '尺子（矫直 / 尺寸）' },
  { value: 'Scissors', label: '剪刀（剪切）' },
  { value: 'Lock', label: '锁（锁紧 / 液压）' },
  { value: 'Link', label: '链环（联轴器）' },
]

const TYPE_OPTIONS = [
  { value: 'number', label: '数值' },
  { value: 'enum', label: '选项' },
]

/** 公式里能用的函数与常量，写在编辑器里省得去翻文档 */
const CHEATSHEET = [
  '运算符  + - * / % ^  ( )',
  '比较    > < >= <= == !=（返回 1 或 0，配合 if 用）',
  '函数    abs sqrt ceil floor round(x,位数) min max pow(a,b) ln log10 exp',
  '        sin cos tan atan  if(条件, 真值, 假值)',
  '常量    PI  E',
]

const emptyInput = (): CalcInputDef => ({
  key: '',
  label: '',
  type: 'number',
  required: true,
})

const emptyFormula = (): CalcFormulaDef => ({ key: '', label: '', expr: '', digits: 2 })

/** 中文名 → 拼音式变量名太难做，这里只在 key 为空时给个占位序号 */
const autoKey = (prefix: string, taken: Set<string>) => {
  let i = 1
  while (taken.has(`${prefix}${i}`)) i++
  return `${prefix}${i}`
}

/**
 * 计算模板编辑器。
 *
 * 公式让用户自己写表达式（而不是我们预置死算法），所以校验必须跟得上：
 * 改一个字就往后端过一遍静态校验，错误标在对应那一行；
 * 存之前还能用默认值真跑一次 —— 除零、开负数根这类只有跑起来才暴露。
 */
export default function CalcTemplateEditor({
  open,
  onClose,
  template,
  defaultCategory,
  existingCategories,
  existingCodes,
  onSaved,
}: Props) {
  const isEdit = !!template
  const [tab, setTab] = useState<'basic' | 'inputs' | 'formulas' | 'notes'>('basic')

  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [icon, setIcon] = useState('Calculator')
  const [description, setDescription] = useState('')
  const [sortOrder, setSortOrder] = useState(99)
  const [inputs, setInputs] = useState<CalcInputDef[]>([emptyInput()])
  const [formulas, setFormulas] = useState<CalcFormulaDef[]>([emptyFormula()])
  const [outputs, setOutputs] = useState<string[]>([])
  const [notes, setNotes] = useState('')

  const [problems, setProblems] = useState<Problem[]>([])
  const [trial, setTrial] = useState<CalcResult | null>(null)
  const [trialError, setTrialError] = useState('')

  // 打开时装载
  useEffect(() => {
    if (!open) return
    if (template) {
      setCode(template.code)
      setName(template.name)
      setCategory(template.category || '')
      setIcon(template.icon || 'Calculator')
      setDescription(template.description || '')
      setSortOrder(template.sortOrder ?? 99)
      setInputs(template.schema?.inputs?.length ? structuredClone(template.schema.inputs) : [emptyInput()])
      setFormulas(
        template.schema?.formulas?.length ? structuredClone(template.schema.formulas) : [emptyFormula()],
      )
      setOutputs(template.schema?.outputs ? [...template.schema.outputs] : [])
      setNotes(template.schema?.notes || '')
    } else {
      setCode('')
      setName('')
      setCategory(defaultCategory || '')
      setIcon('Calculator')
      setDescription('')
      setSortOrder(99)
      setInputs([emptyInput()])
      setFormulas([emptyFormula()])
      setOutputs([])
      setNotes('')
    }
    setTab('basic')
    setProblems([])
    setTrial(null)
    setTrialError('')
  }, [open, template?.code])

  const schema = useMemo(
    () => ({ inputs, formulas, outputs, notes: notes || undefined }),
    [inputs, formulas, outputs, notes],
  )

  // 停手 500ms 再校验，边敲边报错太吵
  const debouncedSchema = useDebounce(JSON.stringify(schema), 500)
  useEffect(() => {
    if (!open) return
    let cancelled = false
    calcToolApi
      .validate(JSON.parse(debouncedSchema))
      .then((p) => !cancelled && setProblems(p))
      .catch(() => !cancelled && setProblems([]))
    return () => {
      cancelled = true
    }
  }, [debouncedSchema, open])

  const problemsAt = (at: string) => problems.filter((p) => p.at === at)
  const errors = problems.filter((p) => p.level === 'error')

  const codeError = useMemo(() => {
    if (!code) return '必填'
    if (!/^[a-z][a-z0-9_]*$/i.test(code)) return '只能用字母、数字、下划线，且以字母开头'
    if (!isEdit && existingCodes.includes(code)) return '该编码已被占用'
    return ''
  }, [code, isEdit, existingCodes])

  /** 试算用的输入：优先默认值，没有默认值就用量程中值，再不行给 1 */
  const trialInputs = useMemo(() => {
    const out: Record<string, number | string> = {}
    for (const i of inputs) {
      if (!i.key) continue
      if (i.default !== undefined && i.default !== null && i.default !== '') out[i.key] = i.default
      else if (i.type === 'enum' && i.options?.length) out[i.key] = i.options[0].value
      else if (i.min != null && i.max != null) out[i.key] = (i.min + i.max) / 2
      else if (i.min != null) out[i.key] = i.min
      else out[i.key] = 1
    }
    return out
  }, [inputs])

  const tryRun = useMutation({
    mutationFn: () => calcToolApi.tryRun(schema, trialInputs),
    onSuccess: (r) => {
      setTrial(r)
      setTrialError('')
      toast.success('试算通过')
    },
    onError: (e: any) => {
      setTrial(null)
      setTrialError(e?.response?.data?.message || '试算失败')
    },
  })

  const save = useMutation({
    mutationFn: (asDraft: boolean) =>
      calcToolApi.upsert({
        code,
        name,
        category: category || '其他',
        icon,
        description: description || undefined,
        sortOrder,
        // 草稿把还没动过的空白行剔掉，免得下次打开一堆无名占位
        schema: asDraft
          ? {
              ...schema,
              inputs: inputs.filter((i) => i.key || i.label),
              formulas: formulas.filter((f) => f.key || f.label || f.expr),
            }
          : schema,
        status: asDraft ? 'draft' : 'active',
      }),
    onSuccess: (t, asDraft) => {
      toast.success(
        asDraft
          ? '已存为草稿，随时可以回来接着配参数和公式'
          : isEdit
            ? '模板已更新'
            : '计算工具已创建，可以开始用了',
      )
      onSaved(t)
      onClose()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '保存失败'),
  })

  const patchInput = (i: number, patch: Partial<CalcInputDef>) =>
    setInputs((prev) => prev.map((x, idx) => (idx === i ? { ...x, ...patch } : x)))

  const patchFormula = (i: number, patch: Partial<CalcFormulaDef>) =>
    setFormulas((prev) => prev.map((x, idx) => (idx === i ? { ...x, ...patch } : x)))

  const move = <T,>(arr: T[], from: number, dir: -1 | 1): T[] => {
    const to = from + dir
    if (to < 0 || to >= arr.length) return arr
    const next = [...arr]
    ;[next[from], next[to]] = [next[to], next[from]]
    return next
  }

  /** 公式按顺序求值，所以第 i 条只能引用输入项和前 i-1 条公式 */
  const varsAvailableAt = (i: number) => [
    ...inputs.filter((x) => x.key).map((x) => ({ key: x.key, label: x.label || x.key, from: '输入' })),
    ...formulas.slice(0, i).filter((x) => x.key).map((x) => ({ key: x.key, label: x.label || x.key, from: '中间量' })),
  ]

  /** 存草稿只要编码和名称站得住；正式启用才要求公式全部通过 */
  const canDraft = !codeError && !!name.trim()
  const canActivate = canDraft && errors.length === 0
  const wasDraft = template?.status === 'draft'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        isEdit ? `${wasDraft ? '继续配置' : '编辑'}计算工具 · ${template?.name}` : '新增计算工具'
      }
      size="xl"
      onConfirm={() => save.mutate(false)}
      loading={save.isPending}
      confirmDisabled={!canActivate}
      confirmText={wasDraft ? '完成并启用' : isEdit ? '保存修改' : '创建并启用'}
    >
      <div className="space-y-3">
        <Tabs
          tabs={[
            { value: 'basic', label: '基本信息' },
            { value: 'inputs', label: `输入项 (${inputs.length})`, icon: SlidersHorizontal },
            { value: 'formulas', label: `公式与输出 (${formulas.length})`, icon: FunctionSquare },
            { value: 'notes', label: '计算说明' },
          ]}
          value={tab}
          onChange={(v) => setTab(v as any)}
        />

        <div className="max-h-[52vh] overflow-y-auto pr-1">
          {/* ── 基本信息 ── */}
          {tab === 'basic' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <FormInput
                label="模板编码"
                required
                value={code}
                disabled={isEdit}
                onChange={(e) => setCode(e.target.value.trim())}
                error={codeError}
                helper={isEdit ? '编码创建后不可更改' : '英文标识，用于地址栏与记录关联，如 leveler_force'}
                placeholder="leveler_force"
              />
              <FormInput
                label="工具名称"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="矫直力计算"
              />
              <div>
                <label className="block eo-label mb-1.5">所属分类</label>
                <input
                  list="calc-categories"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="eo-input"
                  placeholder="选择已有分类或直接输入新分类"
                />
                <datalist id="calc-categories">
                  {existingCategories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
                <p className="text-caption text-muted mt-1">
                  左侧按分类分组；输入新名称即可新建一个分类
                </p>
              </div>
              <FormSelect
                label="图标"
                options={ICON_OPTIONS}
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
              />
              <FormInput
                label="一句话用途"
                className="sm:col-span-2"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="按带钢厚度与屈服强度估算所需矫直力"
                helper="显示在左侧列表工具名下方，越短越好；详细说明写在「计算说明」里"
              />
              <FormInput
                label="排序"
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value))}
                helper="数字越小越靠前"
              />
            </div>
          )}

          {/* ── 输入项 ── */}
          {tab === 'inputs' && (
            <div className="space-y-2 pt-1">
              {problemsAt('inputs').map((p, i) => (
                <p key={i} className="text-label text-danger-fg flex items-center gap-1">
                  <AlertTriangle size={12} /> {p.message}
                </p>
              ))}

              {inputs.map((input, i) => {
                const errs = problemsAt(`inputs[${i}]`)
                return (
                  <div
                    key={i}
                    className={`rounded-lg border p-3 ${
                      errs.length ? 'border-danger-line bg-danger-bg/30' : 'border-border bg-subtle/40'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-mono text-caption text-muted">#{i + 1}</span>
                      <div className="flex-1" />
                      <button
                        onClick={() => setInputs((p) => move(p, i, -1))}
                        disabled={i === 0}
                        className="text-muted hover:text-ink disabled:opacity-30"
                        title={"上移"}
                        aria-label="上移"
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        onClick={() => setInputs((p) => move(p, i, 1))}
                        disabled={i === inputs.length - 1}
                        className="text-muted hover:text-ink disabled:opacity-30"
                        title={"下移"}
                        aria-label="下移"
                      >
                        <ChevronDown size={14} />
                      </button>
                      <button
                        onClick={() => setInputs((p) => p.filter((_, idx) => idx !== i))}
                        disabled={inputs.length === 1}
                        className="text-muted hover:text-danger-fg disabled:opacity-30"
                        title={"删除"}
                        aria-label="删除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <FormInput
                        label="变量名"
                        value={input.key}
                        onChange={(e) => patchInput(i, { key: e.target.value.trim() })}
                        placeholder="thickness"
                      />
                      <FormInput
                        label="显示名称"
                        value={input.label}
                        onChange={(e) => patchInput(i, { label: e.target.value })}
                        placeholder="带钢厚度"
                      />
                      <FormInput
                        label="单位"
                        value={input.unit || ''}
                        onChange={(e) => patchInput(i, { unit: e.target.value || undefined })}
                        placeholder="mm"
                      />
                      <FormInput
                        label="分组"
                        value={input.group || ''}
                        onChange={(e) => patchInput(i, { group: e.target.value || undefined })}
                        placeholder="来料参数"
                      />
                      <FormSelect
                        label="类型"
                        options={TYPE_OPTIONS}
                        value={input.type}
                        onChange={(e) => patchInput(i, { type: e.target.value as any })}
                      />
                      <FormInput
                        label="默认值"
                        value={input.default ?? ''}
                        onChange={(e) => patchInput(i, { default: e.target.value || undefined })}
                      />
                      <FormInput
                        label="下限"
                        type="number"
                        value={input.min ?? ''}
                        onChange={(e) =>
                          patchInput(i, { min: e.target.value === '' ? undefined : Number(e.target.value) })
                        }
                      />
                      <FormInput
                        label="上限"
                        type="number"
                        value={input.max ?? ''}
                        onChange={(e) =>
                          patchInput(i, { max: e.target.value === '' ? undefined : Number(e.target.value) })
                        }
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end mt-2">
                      <FormInput
                        label="填写提示"
                        value={input.hint || ''}
                        onChange={(e) => patchInput(i, { hint: e.target.value || undefined })}
                        placeholder="按来料最大厚度取值"
                      />
                      <label className="flex items-center gap-1.5 text-body-sm text-ink-soft cursor-pointer pb-2">
                        <input
                          type="checkbox"
                          checked={!!input.required}
                          onChange={(e) => patchInput(i, { required: e.target.checked })}
                          className="w-3.5 h-3.5 accent-accent-500"
                        />
                        必填
                      </label>
                    </div>

                    {input.type === 'enum' && (
                      <div className="mt-2">
                        <label className="block eo-label mb-1">
                          选项（每行一个，格式：显示文本 = 参与计算的数值）
                        </label>
                        <textarea
                          rows={3}
                          className="eo-input font-mono text-caption"
                          value={(input.options || [])
                            .map((o) => `${o.label} = ${o.value}`)
                            .join('\n')}
                          onChange={(e) => {
                            const options = e.target.value
                              .split('\n')
                              .map((line) => line.split('='))
                              .filter((parts) => parts.length === 2 && parts[0].trim())
                              .map((parts) => ({
                                label: parts[0].trim(),
                                value: Number(parts[1].trim()),
                              }))
                              .filter((o) => Number.isFinite(o.value))
                            patchInput(i, { options })
                          }}
                          placeholder={'碳钢 = 235\n不锈钢 = 205\n高强钢 = 700'}
                        />
                      </div>
                    )}

                    {errs.map((p, k) => (
                      <p key={k} className="text-label text-danger-fg mt-1.5 flex items-center gap-1">
                        <AlertTriangle size={12} /> {p.message}
                      </p>
                    ))}
                  </div>
                )
              })}

              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  setInputs((p) => [
                    ...p,
                    { ...emptyInput(), key: autoKey('x', new Set(p.map((i) => i.key))) },
                  ])
                }
              >
                <Plus size={14} className="mr-1" /> 增加输入项
              </Button>
            </div>
          )}

          {/* ── 公式与输出 ── */}
          {tab === 'formulas' && (
            <div className="space-y-2 pt-1">
              <details className="rounded-md bg-info-bg/50 border border-info-line px-3 py-2">
                <summary className="text-label text-info-fg cursor-pointer select-none">
                  公式怎么写（可用函数与运算符）
                </summary>
                <pre className="mt-2 font-mono text-caption text-ink-soft whitespace-pre-wrap leading-relaxed">
                  {CHEATSHEET.join('\n')}
                </pre>
                <p className="mt-2 text-caption text-muted">
                  例：<code className="font-mono">力 = 2 * 屈服强度 * 宽度 * 厚度^2 / (3 * 辊距)</code>
                  写成 <code className="font-mono">2 * yield_strength * width * pow(thickness,2) / (3 * pitch)</code>
                </p>
              </details>

              {problemsAt('formulas').concat(problemsAt('outputs')).map((p, i) => (
                <p
                  key={i}
                  className={`text-label flex items-center gap-1 ${
                    p.level === 'error' ? 'text-danger-fg' : 'text-warning-fg'
                  }`}
                >
                  <AlertTriangle size={12} /> {p.message}
                </p>
              ))}

              {formulas.map((f, i) => {
                const errs = problemsAt(`formulas[${i}]`)
                const vars = varsAvailableAt(i)
                const isOut = outputs.length === 0 || outputs.includes(f.key)
                return (
                  <div
                    key={i}
                    className={`rounded-lg border p-3 ${
                      errs.length ? 'border-danger-line bg-danger-bg/30' : 'border-border bg-subtle/40'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-mono text-caption text-muted">第 {i + 1} 步</span>
                      <label className="flex items-center gap-1.5 text-label text-ink-soft cursor-pointer ml-2">
                        <input
                          type="checkbox"
                          checked={outputs.includes(f.key)}
                          disabled={!f.key}
                          onChange={(e) =>
                            setOutputs((prev) =>
                              e.target.checked
                                ? [...prev.filter((k) => k !== f.key), f.key]
                                : prev.filter((k) => k !== f.key),
                            )
                          }
                          className="w-3.5 h-3.5 accent-accent-500"
                        />
                        作为最终结果展示
                      </label>
                      <div className="flex-1" />
                      <button
                        onClick={() => setFormulas((p) => move(p, i, -1))}
                        disabled={i === 0}
                        className="text-muted hover:text-ink disabled:opacity-30"
                        title={"上移"}
                        aria-label="上移"
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        onClick={() => setFormulas((p) => move(p, i, 1))}
                        disabled={i === formulas.length - 1}
                        className="text-muted hover:text-ink disabled:opacity-30"
                        title={"下移"}
                        aria-label="下移"
                      >
                        <ChevronDown size={14} />
                      </button>
                      <button
                        onClick={() => {
                          setOutputs((o) => o.filter((k) => k !== f.key))
                          setFormulas((p) => p.filter((_, idx) => idx !== i))
                        }}
                        disabled={formulas.length === 1}
                        className="text-muted hover:text-danger-fg disabled:opacity-30"
                        title={"删除"}
                        aria-label="删除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <FormInput
                        label="变量名"
                        value={f.key}
                        onChange={(e) => {
                          const next = e.target.value.trim()
                          setOutputs((o) => o.map((k) => (k === f.key ? next : k)))
                          patchFormula(i, { key: next })
                        }}
                        placeholder="force"
                      />
                      <FormInput
                        label="显示名称"
                        value={f.label}
                        onChange={(e) => patchFormula(i, { label: e.target.value })}
                        placeholder="所需矫直力"
                      />
                      <FormInput
                        label="单位"
                        value={f.unit || ''}
                        onChange={(e) => patchFormula(i, { unit: e.target.value || undefined })}
                        placeholder="kN"
                      />
                      <FormInput
                        label="小数位"
                        type="number"
                        min={0}
                        max={6}
                        value={f.digits ?? 2}
                        onChange={(e) => patchFormula(i, { digits: Number(e.target.value) })}
                      />
                    </div>

                    <div className="mt-2">
                      <label className="block eo-label mb-1">计算式</label>
                      <input
                        value={f.expr}
                        onChange={(e) => patchFormula(i, { expr: e.target.value })}
                        className="eo-input font-mono text-body-sm"
                        placeholder="2 * yield_strength * width * pow(thickness,2) / (3 * pitch)"
                      />
                      {vars.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          <span className="text-caption text-muted">可用变量：</span>
                          {vars.map((v) => (
                            <button
                              key={v.key}
                              type="button"
                              onClick={() => patchFormula(i, { expr: `${f.expr}${v.key}` })}
                              title={`${v.label}（${v.from}）— 点击插入`}
                              className="font-mono text-caption px-1.5 py-0.5 rounded bg-canvas text-ink-soft hover:bg-accent-50 hover:text-accent-700 transition-colors"
                            >
                              {v.key}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
                      <FormInput
                        label="告警下限"
                        type="number"
                        value={f.warnBelow ?? ''}
                        onChange={(e) =>
                          patchFormula(i, {
                            warnBelow: e.target.value === '' ? undefined : Number(e.target.value),
                          })
                        }
                        helper="低于此值结果标黄"
                      />
                      <FormInput
                        label="告警上限"
                        type="number"
                        value={f.warnAbove ?? ''}
                        onChange={(e) =>
                          patchFormula(i, {
                            warnAbove: e.target.value === '' ? undefined : Number(e.target.value),
                          })
                        }
                        helper="高于此值结果标黄"
                      />
                      <FormInput
                        label="结果说明"
                        value={f.hint || ''}
                        onChange={(e) => patchFormula(i, { hint: e.target.value || undefined })}
                        placeholder="选型时按 1.2 倍取"
                      />
                    </div>

                    {!isOut && (
                      <p className="text-caption text-muted mt-1.5">
                        未勾选，将作为中间量收在「查看全部计算量」里
                      </p>
                    )}
                    {errs.map((p, k) => (
                      <p key={k} className="text-label text-danger-fg mt-1.5 flex items-center gap-1">
                        <AlertTriangle size={12} /> {p.message}
                      </p>
                    ))}
                  </div>
                )
              })}

              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  setFormulas((p) => [
                    ...p,
                    { ...emptyFormula(), key: autoKey('r', new Set(p.map((f) => f.key))) },
                  ])
                }
              >
                <Plus size={14} className="mr-1" /> 增加一步计算
              </Button>
            </div>
          )}

          {/* ── 计算说明 ── */}
          {tab === 'notes' && (
            <div className="pt-1">
              <label className="block eo-label mb-1.5">计算说明</label>
              <textarea
                rows={10}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="eo-input text-body-sm leading-relaxed"
                placeholder={
                  '写清楚这个计算的适用范围、公式出处、取值口径和注意事项。\n\n例：\n本式按三点弯曲简化模型估算，适用于厚度 ≤ 25mm 的中厚板。\n屈服强度按材质标准下限取值；结果为理论值，选型时建议乘 1.2 安全系数。\n辊距超过 400mm 时误差增大，需按实测标定。'
                }
              />
              <p className="text-caption text-muted mt-1.5">
                这段文字会显示在计算页右侧的「计算说明」选项卡里，公式清单由系统自动生成，不必在这里重复。
              </p>
            </div>
          )}
        </div>

        {/* ── 底部：校验结果 + 试算 ── */}
        <div className="border-t border-border pt-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => tryRun.mutate()}
              loading={tryRun.isPending}
              disabled={errors.length > 0}
              title={errors.length ? '先修正上面的错误' : '用默认值跑一遍，验证公式确实能算出结果'}
            >
              <Play size={13} className="mr-1" /> 试算
            </Button>

            {/* 参数和公式想慢慢配就先存草稿，不必一次填完 */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => save.mutate(true)}
              loading={save.isPending}
              disabled={!canDraft}
              title={
                canDraft
                  ? '先把工具建起来，参数和公式以后再补'
                  : '至少要填模板编码和工具名称'
              }
            >
              <FileClock size={13} className="mr-1" /> 存为草稿
            </Button>

            {errors.length > 0 ? (
              <span className="text-label text-danger-fg flex items-center gap-1">
                <AlertTriangle size={13} /> {errors.length} 处待补全，暂时只能存草稿
              </span>
            ) : (
              <span className="text-label text-success-fg flex items-center gap-1">
                <CheckCircle2 size={13} /> 公式校验通过，可以启用
              </span>
            )}

            {problems.some((p) => p.level === 'warn') && (
              <span className="text-label text-warning-fg flex items-center gap-1">
                <Info size={13} />
                {problems.find((p) => p.level === 'warn')?.message}
              </span>
            )}
          </div>

          {errors.length > 0 && (
            <ul className="text-caption text-danger-fg space-y-0.5 max-h-24 overflow-y-auto">
              {errors.map((p, i) => (
                <li key={i}>· {p.message}</li>
              ))}
            </ul>
          )}

          {trialError && (
            <p className="text-label text-danger-fg flex items-start gap-1">
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" /> 试算失败：{trialError}
            </p>
          )}

          {trial && (
            <div className="rounded-md bg-success-bg/40 border border-success-line p-2.5">
              <p className="text-caption text-muted mb-1.5">
                用默认值试算（{Object.entries(trialInputs).map(([k, v]) => `${k}=${v}`).join('、')}）
              </p>
              <div className="flex flex-wrap gap-2">
                {trial.results.map((r) => (
                  <span
                    key={r.key}
                    className={`text-caption px-2 py-1 rounded ${
                      r.isOutput ? 'bg-surface text-ink font-medium' : 'bg-canvas text-muted'
                    }`}
                  >
                    {r.label} = <span className="eo-num">{r.value.toLocaleString('zh-CN')}</span>
                    {r.unit ? ` ${r.unit}` : ''}
                  </span>
                ))}
              </div>
            </div>
          )}

          {isEdit && (
            <p className="text-caption text-muted">
              改动公式会让模板版本号 +1；已有的计算记录仍保留当时的版本号与结果，不受影响。
            </p>
          )}
        </div>
      </div>
    </Modal>
  )
}
