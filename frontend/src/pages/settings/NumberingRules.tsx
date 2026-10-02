import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Hash, Link2, RotateCcw } from 'lucide-react'
import Button from '../../components/Button'
import apiClient from '../../api/client'

type Entity =
  | 'customer'
  | 'requirement'
  | 'proposal'
  | 'quotation'
  | 'contract'
  | 'project'
  | 'supplier'
  | 'material'
  | 'ticket'

interface Rule {
  prefix: string
  yearFormat: 'YYYY' | 'YY' | 'YYYYMM' | 'YYMM' | 'none'
  digits: number
  separator: string
}

const ENTITY_LABELS: Record<Entity, string> = {
  customer: '客户编码',
  requirement: '需求编码',
  proposal: '方案编码',
  quotation: '报价编码',
  contract: '合同编码',
  project: '项目编码',
  supplier: '供应商编码',
  material: '物料编码',
  ticket: '售后工单编码',
}

const ORDER: Entity[] = ['customer', 'requirement', 'proposal', 'quotation', 'contract', 'project', 'supplier', 'material', 'ticket']

const numberingApi = {
  get: () =>
    apiClient
      .get<{ rules: Record<Entity, Rule>; preview: Record<Entity, string>; defaults: Record<Entity, Rule> }>(
        '/numbering',
      )
      .then((r) => r.data),
  update: (rules: Record<Entity, Rule>) => apiClient.put('/numbering', rules).then((r) => r.data),
}

/** 本地拼一次，让用户改规则时立刻看到形状，不必等保存。与后端 buildPrefix 逻辑保持一致。 */
function localPreview(rule: Rule): string {
  const now = new Date()
  const year = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const parts = [rule.prefix]
  switch (rule.yearFormat) {
    case 'YYYY':
      parts.push(String(year))
      break
    case 'YY':
      parts.push(String(year).slice(-2))
      break
    case 'YYYYMM':
      parts.push(String(year), mm)
      break
    case 'YYMM':
      parts.push(String(year).slice(-2), mm)
      break
  }
  return parts.join(rule.separator) + rule.separator + '1'.padStart(rule.digits, '0')
}

/**
 * 单据编号规则。
 *
 * 除了让前缀、年份、位数可配，这里更重要的是把**对应关系**讲清楚：
 * 同一单生意的需求、方案、报价、项目共用一个流水号尾号，
 * 看到 -007 就知道是同一条线，不用逐层点进去比对。
 */
export default function NumberingRules() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['numbering'], queryFn: numberingApi.get })
  const [rules, setRules] = useState<Record<Entity, Rule> | null>(null)

  useEffect(() => {
    if (data?.rules) setRules(data.rules)
  }, [data])

  const save = useMutation({
    mutationFn: () => numberingApi.update(rules!),
    onSuccess: () => {
      toast.success('编号规则已保存')
      queryClient.invalidateQueries({ queryKey: ['numbering'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '保存失败'),
  })

  const set = (e: Entity, patch: Partial<Rule>) =>
    setRules((prev) => (prev ? { ...prev, [e]: { ...prev[e], ...patch } } : prev))

  if (isLoading || !rules) return <p className="text-sm text-muted">加载中…</p>

  return (
    <div className="space-y-6">
      <div className="bg-surface rounded-lg border border-border overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center gap-2">
          <Hash size={20} className="text-accent-600" />
          <h2 className="text-lg font-semibold">编号规则</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-border">
                <th className="px-6 py-2 font-medium">单据</th>
                <th className="px-3 py-2 font-medium">前缀</th>
                <th className="px-3 py-2 font-medium">日期格式</th>
                <th className="px-3 py-2 font-medium">流水位数</th>
                <th className="px-3 py-2 font-medium">分隔符</th>
                <th className="px-3 py-2 font-medium">下一个编号</th>
              </tr>
            </thead>
            <tbody>
              {ORDER.map((e) => {
                const rule = rules[e]
                return (
                  <tr key={e} className="border-b border-border/60 last:border-0">
                    <td className="px-6 py-2.5 text-ink font-medium whitespace-nowrap">
                      {ENTITY_LABELS[e]}
                    </td>
                    <td className="px-3 py-2.5">
                      <input
                        value={rule.prefix}
                        maxLength={12}
                        onChange={(ev) => set(e, { prefix: ev.target.value.toUpperCase() })}
                        className="eo-input !w-24 !py-1"
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <select
                        value={rule.yearFormat}
                        onChange={(ev) => set(e, { yearFormat: ev.target.value as Rule['yearFormat'] })}
                        className="eo-input !w-32 !py-1"
                      >
                        <option value="YYYY">四位年 2026</option>
                        <option value="YY">两位年 26</option>
                        <option value="YYYYMM">四位年月 2026-08</option>
                        <option value="YYMM">两位年月 26-08</option>
                        <option value="none">不带日期</option>
                      </select>
                    </td>
                    <td className="px-3 py-2.5">
                      <input
                        type="number"
                        min={1}
                        max={8}
                        value={rule.digits}
                        onChange={(ev) => set(e, { digits: Number(ev.target.value) })}
                        className="eo-input !w-20 !py-1"
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <input
                        value={rule.separator}
                        maxLength={2}
                        onChange={(ev) => set(e, { separator: ev.target.value })}
                        className="eo-input !w-16 !py-1"
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <code className="text-xs text-accent-700 bg-accent-50 border border-accent-200 px-2 py-1 rounded">
                        {localPreview(rule)}
                      </code>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="px-6 py-3 border-t border-border flex items-center gap-2">
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            保存规则
          </Button>
          <Button
            variant="ghost"
            onClick={() => data?.defaults && setRules(data.defaults)}
          >
            <RotateCcw size={14} className="mr-1" /> 恢复默认
          </Button>
          <span className="text-xs text-muted ml-auto">
            规则只影响之后新建的单据，已有编号不会被改写
          </span>
        </div>
      </div>

      <div className="bg-surface rounded-lg border border-border p-6">
        <div className="flex items-center gap-2 mb-3">
          <Link2 size={18} className="text-accent-600" />
          <h3 className="text-base font-semibold">单据之间的对应关系</h3>
        </div>
        <p className="text-sm text-ink-soft mb-4">
          同一条业务线（同客户、同项目）的单据<strong>共用一个流水号尾号</strong>，
          方案继承所关联需求的尾号，报价继承方案的，合同继承报价的，项目继承需求的。
          看到尾号相同就知道是同一单生意，不必逐层点进去核对。
          标准方案与产品不走流水编号：前者靠技术方案匹配定位，后者的编码是产品目录自带的型号码。
        </p>
        <div className="bg-canvas border border-border rounded-md p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm font-mono">
            <span className="px-2 py-1 bg-surface border border-border rounded">
              {localPreview(rules.requirement).replace(/1$/, '7')}
            </span>
            <span className="text-muted">→</span>
            <span className="px-2 py-1 bg-surface border border-border rounded">
              {localPreview(rules.proposal).replace(/1$/, '7')}
            </span>
            <span className="text-muted">→</span>
            <span className="px-2 py-1 bg-surface border border-border rounded">
              {localPreview(rules.quotation).replace(/1$/, '7')}
            </span>
            <span className="text-muted">→</span>
            <span className="px-2 py-1 bg-surface border border-border rounded">
              {localPreview(rules.contract).replace(/1$/, '7')}
            </span>
            <span className="text-muted">→</span>
            <span className="px-2 py-1 bg-surface border border-border rounded">
              {localPreview(rules.project).replace(/1$/, '7')}
            </span>
          </div>
          <p className="text-xs text-muted mt-3">
            同一需求下有第二个方案时追加字母后缀，如{' '}
            <code>{localPreview(rules.proposal).replace(/1$/, '7')}-A</code>，
            对应的报价为 <code>{localPreview(rules.quotation).replace(/1$/, '7')}-A</code>。
          </p>
        </div>
      </div>
    </div>
  )
}
