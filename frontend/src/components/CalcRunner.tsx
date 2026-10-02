import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Calculator,
  Save,
  Copy,
  AlertTriangle,
  ChevronDown,
  Info,
  History,
  RotateCcw,
  Link2,
  Sparkles,
  SlidersHorizontal,
} from 'lucide-react'
import { calcToolApi, calcRecordApi, requirementApi } from '../api/services'
import type { CalcTemplate, CalcResult, CalcInputDef, CalcRecord } from '../types'
import { prefillFromSpec, type PrefillHit } from '../utils/calcPrefill'
import Button from './Button'
import PageLoader from './PageLoader'
import ErrorState from './ErrorState'
import EntityPicker from './EntityPicker'

interface CalcRunnerProps {
  code: string
  /** 保存记录时带上的关联对象，让计算结果挂到方案 / 需求 / 报价上 */
  context?: {
    relatedSolutionId?: string
    relatedProposalId?: string
    relatedRequirementId?: string
    relatedQuotationId?: string
    customerId?: string
    contextLabel?: string
  }
  /**
   * 允许在面板内自己挑一条客户需求。
   * 从需求/方案页嵌进来时关联对象已经定了，不该再让人改；
   * 独立的工程计算页则需要这个入口，否则算完的记录挂不到任何单据上。
   */
  allowPickRequirement?: boolean
  onSaved?: (record: CalcRecord) => void
}

const toList = (res: any): any[] => (Array.isArray(res) ? res : res?.items || res?.data || [])

/** 按 group 把输入项分组，无 group 的归到"输入参数" */
function groupInputs(inputs: CalcInputDef[]) {
  const groups = new Map<string, CalcInputDef[]>()
  for (const input of inputs) {
    const g = input.group || '输入参数'
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(input)
  }
  return [...groups.entries()]
}

function defaultsOf(template: CalcTemplate): Record<string, string> {
  const out: Record<string, string> = {}
  for (const input of template.schema.inputs) {
    if (input.default !== undefined && input.default !== null) out[input.key] = String(input.default)
  }
  return out
}

/**
 * schema 驱动的计算面板。
 *
 * 表单和结果表都由模板的 JSON schema 渲染 —— 新增一个计算工具只需插一条记录，
 * 前端不用改。计算工具页和方案/需求页的行内抽屉共用这一个组件。
 */
export default function CalcRunner({
  code,
  context,
  allowPickRequirement = false,
  onSaved,
}: CalcRunnerProps) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [result, setResult] = useState<CalcResult | null>(null)
  const [title, setTitle] = useState('')
  const [remark, setRemark] = useState('')
  const [showHistory, setShowHistory] = useState(false)

  /** 面板内自选的需求；父级传了就以父级为准 */
  const [pickedReqId, setPickedReqId] = useState('')
  const [hits, setHits] = useState<PrefillHit[]>([])

  const requirementId = context?.relatedRequirementId || pickedReqId

  const templateQuery = useQuery({
    queryKey: ['calc-template', code],
    queryFn: () => calcToolApi.get(code),
    enabled: !!code,
  })

  const template = templateQuery.data

  // 历史记录：用于"载入上次参数"，避免每次重新敲一遍
  const historyQuery = useQuery({
    queryKey: ['calc-records', code, context?.relatedProposalId, requirementId],
    queryFn: () =>
      calcRecordApi.list({
        templateCode: code,
        relatedProposalId: context?.relatedProposalId,
        relatedRequirementId: requirementId || undefined,
      }),
    enabled: !!code,
  })

  /** 选中的需求详情 —— 取它的结构化参数来预填，并带出客户 */
  const reqQuery = useQuery({
    queryKey: ['requirement', requirementId],
    queryFn: () => requirementApi.get(requirementId),
    enabled: !!requirementId,
  })

  // 切换模板时重置为默认值
  useEffect(() => {
    if (template) {
      setValues(defaultsOf(template))
      setResult(null)
      setTitle('')
      setHits([])
    }
  }, [template?.code])

  /**
   * 需求或模板一变就试着预填一次。
   * 只填空格子（prefillFromSpec 内部保证），所以用户手改过的值不会被覆盖。
   */
  useEffect(() => {
    const spec = reqQuery.data?.structuredSpec
    if (!template || !spec) return
    setValues((prev) => {
      const { values: filled, hits: h } = prefillFromSpec(template.schema.inputs, spec, prev)
      setHits(h)
      return Object.keys(filled).length ? { ...prev, ...filled } : prev
    })
  }, [reqQuery.data?.id, reqQuery.data?.structuredSpec, template?.code])

  const searchRequirements = async (keyword: string) => {
    const res = await requirementApi.list({ keyword: keyword || undefined, limit: 20 })
    return toList(res).map((r: any) => ({
      value: r.id,
      label: r.projectName || r.title || r.requirementNo,
      hint: [r.requirementNo, r.customer?.shortName || r.customer?.name].filter(Boolean).join(' · '),
    }))
  }

  const resolveRequirement = async (id: string) => {
    try {
      const r: any = await requirementApi.get(id)
      return {
        value: r.id,
        label: r.projectName || r.title || r.requirementNo,
        hint: [r.requirementNo, r.customer?.shortName || r.customer?.name].filter(Boolean).join(' · '),
      }
    } catch {
      return null
    }
  }

  const calcMutation = useMutation({
    mutationFn: () => calcToolApi.calculate(code, values),
    onSuccess: (data) => setResult(data),
    onError: (err: any) => {
      setResult(null)
      toast.error(err?.response?.data?.message || '计算失败')
    },
  })

  const saveMutation = useMutation({
    mutationFn: () =>
      calcRecordApi.save({
        templateCode: code,
        title: title || undefined,
        inputs: values,
        remark: remark || undefined,
        ...context,
        // 面板内自选的需求要覆盖进去，同时把客户一起带上，
        // 记录才能在客户维度上查得到，而不是只挂在需求下面
        relatedRequirementId: requirementId || undefined,
        customerId: context?.customerId || reqQuery.data?.customerId || undefined,
      }),
    onSuccess: (record) => {
      const where =
        context?.contextLabel ||
        (pickedReqId && reqQuery.data
          ? `需求「${(reqQuery.data as any).projectName || reqQuery.data.title}」`
          : '')
      toast.success(where ? `已保存到${where}` : '计算记录已保存')
      historyQuery.refetch()
      onSaved?.(record)
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || '保存失败'),
  })

  const grouped = useMemo(() => (template ? groupInputs(template.schema.inputs) : []), [template])

  const missingRequired = useMemo(() => {
    if (!template) return []
    return template.schema.inputs
      .filter((i) => i.required && !values[i.key])
      .map((i) => i.label)
  }, [template, values])

  const loadRecord = async (recordId: string) => {
    const record = await calcRecordApi.get(recordId)
    const next: Record<string, string> = {}
    for (const [k, v] of Object.entries(record.inputs || {})) next[k] = String(v)
    setValues(next)
    setTitle(record.title || '')
    setShowHistory(false)
    toast.success('已载入历史参数')
  }

  const copyResult = () => {
    if (!result) return
    const lines = result.results
      .filter((r) => r.isOutput)
      .map((r) => `${r.label}\t${r.value}\t${r.unit || ''}`)
    const inputLines = template!.schema.inputs
      .filter((i) => values[i.key])
      .map((i) => `${i.label}\t${values[i.key]}\t${i.unit || ''}`)
    navigator.clipboard.writeText(
      `【${result.templateName}】\n\n输入参数\n${inputLines.join('\n')}\n\n计算结果\n${lines.join('\n')}`,
    )
    toast.success('结果已复制，可粘贴到方案或邮件')
  }

  if (templateQuery.isLoading) return <PageLoader />
  if (templateQuery.isError || !template) {
    return <ErrorState message="计算模板加载失败" onRetry={() => templateQuery.refetch()} />
  }

  return (
    <div className="space-y-4">
      {/* 头部 */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-serif text-heading-sm font-medium text-ink">{template.name}</h2>
            <span className="font-mono text-caption px-1.5 py-0.5 rounded bg-canvas text-muted">
              v{template.version}
            </span>
            {context?.contextLabel && (
              <span className="font-mono text-caption px-1.5 py-0.5 rounded bg-info-bg text-info-fg">
                {context.contextLabel}
              </span>
            )}
          </div>
          {template.description && (
            <p className="text-body-sm text-muted mt-1">{template.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {(historyQuery.data || []).length > 0 && (
            <Button variant="secondary" size="sm" onClick={() => setShowHistory((s) => !s)}>
              <History size={13} className="mr-1" /> 历史参数
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => { setValues(defaultsOf(template)); setResult(null) }}>
            <RotateCcw size={13} className="mr-1" /> 重置
          </Button>
        </div>
      </div>

      {showHistory && (
        <div className="eo-card p-2 max-h-52 overflow-y-auto">
          {(historyQuery.data || []).map((r) => (
            <button
              key={r.id}
              onClick={() => loadRecord(r.id)}
              className="w-full text-left px-3 py-2 rounded-md hover:bg-canvas transition-colors flex items-center gap-3"
            >
              <span className="text-body-sm text-ink flex-1 truncate">{r.title}</span>
              <span className="font-mono text-caption text-muted flex-shrink-0">
                {new Date(r.createdAt).toLocaleDateString('zh-CN')}
              </span>
              <span className="text-caption text-muted flex-shrink-0">{r.createdByName || ''}</span>
            </button>
          ))}
        </div>
      )}

      {/* 关联客户需求 —— 决定这笔计算记到哪张单上，也是预填的来源 */}
      {allowPickRequirement && !context?.relatedRequirementId && (
        <div className="eo-card p-3">
          <div className="flex items-end gap-3 flex-wrap">
            <div className="flex-1 min-w-[240px]">
              <EntityPicker
                label="关联客户需求"
                value={pickedReqId}
                onChange={(v) => {
                  setPickedReqId(v)
                  if (!v) setHits([])
                }}
                search={searchRequirements}
                resolve={resolveRequirement}
                queryKey="calc-req-picker"
                placeholder="搜索需求编号 / 项目名称 / 客户简称"
                helper="选中后计算记录会挂到该需求下，并尝试用需求里的参数预填输入值"
              />
            </div>
            {pickedReqId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const spec = reqQuery.data?.structuredSpec
                  if (!spec) return toast.error('该需求还没有结构化参数，请先在需求详情里执行识别')
                  // 手动重填时允许覆盖已填的值
                  const { values: filled, hits: h } = prefillFromSpec(template.schema.inputs, spec, {})
                  setHits(h)
                  if (!Object.keys(filled).length) return toast.error('需求里没有能对应上的参数')
                  setValues((v) => ({ ...v, ...filled }))
                  toast.success(`已从需求带入 ${h.length} 项参数`)
                }}
              >
                <Sparkles size={13} className="mr-1" /> 重新带入参数
              </Button>
            )}
          </div>

          {hits.length > 0 && (
            <div className="mt-2 pt-2 border-t border-divider">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Sparkles size={12} className="text-accent-600" />
                <span className="text-label text-ink-soft">
                  已从需求带入 {hits.length} 项，请核对后再计算
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {hits.map((h) => (
                  <span
                    key={h.inputKey}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-accent-50 text-caption text-accent-700"
                    title={`来自需求参数「${h.fromLabel}」${h.via === 'alias' ? '（按常见叫法匹配，请重点核对）' : ''}`}
                  >
                    {h.inputLabel} = {h.value}
                    {h.unit ? ` ${h.unit}` : ''}
                    {h.via === 'alias' && <AlertTriangle size={10} className="text-warning-fg" />}
                  </span>
                ))}
              </div>
            </div>
          )}

          {pickedReqId && reqQuery.data && !reqQuery.data.structuredSpec && (
            <p className="mt-2 text-caption text-warning-fg">
              该需求尚未做结构化识别，无法自动带入参数，请手工填写。
            </p>
          )}
        </div>
      )}

      {/* ── 输入值 ───────────────────────────────── */}
      <div className="flex items-center gap-2 pt-1">
        <SlidersHorizontal size={14} className="text-accent-600" />
        <h3 className="text-body-sm font-semibold text-ink">输入值</h3>
        <span className="text-caption text-muted">
          共 {template.schema.inputs.length} 项，分 {grouped.length} 组
        </span>
        <div className="flex-1 h-px bg-divider" />
      </div>

      <div className="space-y-3">
        {grouped.map(([groupName, inputs]) => {
          const open = !collapsed[groupName]
          return (
            <div key={groupName} className="border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => setCollapsed((c) => ({ ...c, [groupName]: !c[groupName] }))}
                className="w-full flex items-center justify-between px-3 py-2 bg-subtle hover:bg-canvas transition-colors"
                aria-expanded={open}
              >
                <span className="text-body-sm font-semibold text-ink">{groupName}</span>
                <ChevronDown size={13} className={`text-muted transition-transform ${open ? '' : '-rotate-90'}`} />
              </button>

              {open && (
                <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {inputs.map((input) => {
                    const id = `calc-${input.key}`
                    const value = values[input.key] ?? ''
                    const num = Number(value)
                    const outOfRange =
                      value !== '' &&
                      Number.isFinite(num) &&
                      ((input.min != null && num < input.min) || (input.max != null && num > input.max))

                    return (
                      <div key={input.key}>
                        <label htmlFor={id} className="block mb-1">
                          <span className="text-body-sm text-ink-soft">
                            {input.label}
                            {input.required && <span className="text-danger-fg ml-0.5">*</span>}
                          </span>
                          {input.unit && <span className="text-caption text-muted ml-1">({input.unit})</span>}
                        </label>

                        {input.type === 'enum' && input.options ? (
                          <select
                            id={id}
                            value={value}
                            onChange={(e) => setValues((v) => ({ ...v, [input.key]: e.target.value }))}
                            className="eo-input py-1.5 text-body-sm"
                          >
                            <option value="">请选择</option>
                            {input.options.map((o) => (
                              <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            id={id}
                            type="number"
                            inputMode="decimal"
                            value={value}
                            min={input.min}
                            max={input.max}
                            aria-invalid={outOfRange}
                            onChange={(e) => setValues((v) => ({ ...v, [input.key]: e.target.value }))}
                            className={`eo-input py-1.5 text-body-sm eo-num ${
                              outOfRange ? 'border-danger-fg focus:border-danger-fg focus:ring-danger-line' : ''
                            }`}
                            placeholder={
                              input.min != null && input.max != null ? `${input.min} ~ ${input.max}` : undefined
                            }
                          />
                        )}

                        {outOfRange && (
                          <p className="text-caption text-danger-fg mt-0.5">
                            超出合理范围 {input.min ?? '-∞'} ~ {input.max ?? '+∞'}
                          </p>
                        )}
                        {!outOfRange && input.hint && (
                          <p className="text-caption text-muted mt-0.5">{input.hint}</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 计算按钮 */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          onClick={() => calcMutation.mutate()}
          loading={calcMutation.isPending}
          disabled={missingRequired.length > 0}
          title={missingRequired.length ? `还需填写：${missingRequired.join('、')}` : undefined}
        >
          <Calculator size={15} className="mr-1" /> 计算
        </Button>
        {missingRequired.length > 0 && (
          <span className="text-label text-muted">
            还需填写：{missingRequired.slice(0, 3).join('、')}
            {missingRequired.length > 3 && ` 等 ${missingRequired.length} 项`}
          </span>
        )}
      </div>

      {/* ── 输出值 ───────────────────────────────── */}
      {result && (
        <div className="flex items-center gap-2 pt-1">
          <Calculator size={14} className="text-accent-600" />
          <h3 className="text-body-sm font-semibold text-ink">输出值</h3>
          <span className="text-caption text-muted">
            由上述输入值计算得出，共 {result.results.filter((r) => r.isOutput).length} 项结果
          </span>
          <div className="flex-1 h-px bg-divider" />
        </div>
      )}

      {result && (
        <div className="eo-card overflow-hidden border-accent-200">
          <div className="px-4 py-2.5 border-b border-border bg-accent-50/60 flex items-center justify-between">
            <span className="text-body-sm font-semibold text-ink">计算结果</span>
            <button
              onClick={copyResult}
              className="inline-flex items-center gap-1 text-label text-muted hover:text-accent-600 transition-colors"
            >
              <Copy size={12} /> 复制
            </button>
          </div>

          {/* 主要结果放大展示 */}
          <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            {result.results.filter((r) => r.isOutput).map((r) => (
              <div
                key={r.key}
                className={`rounded-lg p-3 ${
                  r.warn ? 'bg-warning-bg ring-1 ring-warning-line' : 'bg-canvas'
                }`}
              >
                <div className="eo-label mb-1 flex items-center gap-1">
                  {r.label}
                  {r.warn && <AlertTriangle size={11} className="text-warning-fg" />}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className={`font-serif text-2xl font-medium leading-none eo-num ${
                    r.warn ? 'text-warning-fg' : 'text-accent-600'
                  }`}>
                    {r.value.toLocaleString('zh-CN')}
                  </span>
                  {r.unit && <span className="text-caption text-muted">{r.unit}</span>}
                </div>
                {r.hint && <div className="text-caption text-muted mt-1">{r.hint}</div>}
              </div>
            ))}
          </div>

          {/* 全部量（含中间量）与计算式 */}
          <details className="border-t border-border">
            <summary className="px-4 py-2 text-label text-muted cursor-pointer hover:text-ink select-none">
              查看全部计算量与公式（{result.results.length} 项）
            </summary>
            <div className="eo-scroll-x">
              <table className="w-full text-body-sm">
                <thead>
                  <tr className="border-y border-border bg-subtle">
                    <th className="eo-th text-left py-2 px-4">量</th>
                    <th className="eo-th text-right py-2 px-4">值</th>
                    <th className="eo-th text-left py-2 px-4">单位</th>
                    <th className="eo-th text-left py-2 px-4">计算式</th>
                  </tr>
                </thead>
                <tbody>
                  {result.results.map((r) => (
                    <tr key={r.key} className="border-b border-divider last:border-0">
                      <td className="py-2 px-4 text-ink-soft">{r.label}</td>
                      <td className="py-2 px-4 text-right eo-num text-ink">{r.value.toLocaleString('zh-CN')}</td>
                      <td className="py-2 px-4 text-muted text-label">{r.unit || '-'}</td>
                      <td className="py-2 px-4 font-mono text-caption text-muted">{r.expr}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          {result.notes && (
            <div className="px-4 py-3 border-t border-border bg-warning-bg/40 flex items-start gap-2">
              <Info size={13} className="text-warning-fg mt-0.5 flex-shrink-0" />
              <p className="text-label text-ink-soft">{result.notes}</p>
            </div>
          )}

          {/* 保存 */}
          <div className="px-4 py-3 border-t border-border space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="记录标题（可选）"
                className="eo-input py-1.5 text-body-sm flex-1 min-w-[180px]"
                aria-label="记录标题"
              />
              <input
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="备注（可选，如「8 辊方案」用于后续对比）"
                className="eo-input py-1.5 text-body-sm flex-1 min-w-[180px]"
                aria-label="备注"
              />
              <Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending}>
                <Save size={14} className="mr-1" />
                {context?.contextLabel ? `保存到${context.contextLabel}` : '保存记录'}
              </Button>
            </div>

            <p className="text-caption text-muted flex items-center gap-1">
              <Link2 size={11} className="flex-shrink-0" />
              {requirementId && reqQuery.data ? (
                <>
                  将挂到需求{' '}
                  <span className="font-mono text-ink-soft">{reqQuery.data.requirementNo}</span>
                  {' · '}
                  {(reqQuery.data as any).projectName || reqQuery.data.title}
                </>
              ) : (
                '未关联客户需求，这条记录只会出现在计算记录列表里'
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

