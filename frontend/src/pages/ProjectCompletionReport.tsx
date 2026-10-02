import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { projectApi } from '../api/services'
import Button from '../components/Button'
import PageLoader from '../components/PageLoader'
import ErrorState from '../components/ErrorState'

const date = (value: unknown) => value ? String(value).slice(0, 10) : '—'
const money = (value: unknown) => `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="eo-card p-5 space-y-3 print:break-inside-avoid"><h2 className="font-semibold text-lg">{title}</h2>{children}</section>
}

export default function ProjectCompletionReport() {
  const { id } = useParams()
  const report = useQuery({ queryKey: ['project-completion-report', id],
    queryFn: () => projectApi.completionReport(id!), enabled: !!id })
  if (report.isLoading) return <PageLoader />
  if (report.isError) return <ErrorState message="结项报告加载失败，或当前账号无权查看财务内容" onRetry={() => report.refetch()} />
  const r = report.data
  if (!r) return <ErrorState message="未找到结项报告" />
  return <div className="space-y-5 max-w-5xl mx-auto">
    <style>{`@media print { nav, aside, header, button, .report-actions { display:none!important } body { background:#fff!important } .eo-card { box-shadow:none!important; border:1px solid #ddd!important } }`}</style>
    <div className="report-actions flex flex-wrap items-center justify-between gap-3">
      <Link to="/projects" className="text-sm text-accent-600">← 返回项目</Link>
      <Button onClick={() => window.print()}>打印 / 保存为 PDF</Button>
    </div>
    <div className="text-center space-y-2 py-4">
      <h1 className="text-2xl font-bold">项目结项报告</h1>
      <p>{r.project?.projectNo} · {r.project?.name}</p>
      <p className="text-sm text-muted">生成时间：{new Date(r.generatedAt).toLocaleString('zh-CN')} · 实时数据报告</p>
    </div>
    <Section title="一、项目与客户">
      <div className="grid md:grid-cols-2 gap-2 text-sm">
        <p>客户：{r.customer?.name || '—'}</p><p>项目负责人：{r.team?.managerId || '—'}</p>
        <p>项目状态：{r.project?.status || '—'}</p><p>进度：{r.project?.progress ?? 0}%</p>
        <p>开始：{date(r.project?.startDate)}</p><p>结束：{date(r.project?.endDate)}</p>
      </div>
      {r.project?.description && <p className="text-sm">{r.project.description}</p>}
    </Section>
    <Section title="二、目标与范围">
      <div className="text-sm space-y-2">
        <p>客户需求：{r.scope?.requirement?.title || '—'}</p>
        <p>技术方案：{r.scope?.proposal?.title || '—'}</p>
        <p>报价：{r.scope?.quotation?.quotationNo || '—'}，{money(r.scope?.quotation?.amount)}</p>
      </div>
    </Section>
    <Section title="三、计划与执行">
      <p className="text-sm">阶段完成 {r.execution?.completedStages ?? 0}/{r.execution?.totalStages ?? 0}；任务完成 {r.execution?.completedTasks ?? 0}/{r.execution?.totalTasks ?? 0}（{r.execution?.taskCompletionRate ?? 0}%）</p>
      <div className="space-y-1 text-sm">{r.execution?.stages?.map((stage: any, index: number) =>
        <p key={index}>{stage.name} · {stage.status} · {date(stage.startDate)}—{date(stage.endDate)}</p>)}</div>
    </Section>
    <Section title="四、合同、回款与成本估算">
      <div className="grid md:grid-cols-2 gap-2 text-sm">
        <p>合同：{r.financials?.contract?.contractNo || '—'}</p>
        <p>合同金额：{money(r.financials?.contract?.amount)}</p>
        <p>签订日期：{date(r.financials?.contract?.signedDate)}</p>
        <p>已收：{money(r.financials?.payments?.summary?.totalReceived)}</p>
        <p>应收：{money(r.financials?.payments?.summary?.totalDue)}</p>
        <p>未收：{money(r.financials?.payments?.summary?.outstanding)}</p>
      </div>
      <div className="border-t border-border pt-2 text-sm space-y-1">
        {r.financials?.payments?.nodes?.map((node: any, index: number) =>
          <p key={index}>{node.nodeName}：应收 {money(node.dueAmount)}，实收 {money(node.receivedAmount)}，到期 {date(node.dueDate)}</p>)}
      </div>
      <p className="text-sm">报价估算成本：{money(r.financials?.estimatedMargin?.estimatedCost)}；估算毛利率：{r.financials?.estimatedMargin?.estimatedMarginPercent ?? '—'}%</p>
      <p className="text-xs text-amber-700">{r.financials?.estimatedMargin?.note}</p>
    </Section>
    <Section title="五、风险与遗留事项">
      {r.risks?.length ? r.risks.map((risk: any, index: number) =>
        <p key={index} className="text-sm">{risk.title} · {risk.level} · {risk.status} · {risk.mitigation || '无处理措施'}</p>) : <p className="text-sm">无登记风险</p>}
      <p className="text-sm">未完成任务：{r.pending?.incompleteTasks?.length ?? 0} 项；{r.pending?.outstandingPayments}</p>
    </Section>
    <Section title="六、售后安排">
      <p className="text-sm">质保到期：{date(r.afterSales?.warrantyExpiry)}</p>
      <p className="text-sm">{r.afterSales?.suggestion}</p>
    </Section>
  </div>
}
