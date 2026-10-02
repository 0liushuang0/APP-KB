import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { customerApi, manufacturingApi, requirementApi, quotationApi, contractApi, projectApi } from '../api/services'
import Button from '../components/Button'
import PageHeader from '../components/PageHeader'

const typeNames: Record<string, string> = {
  equipment: '成套及非标装备', repeat_part: '重复零部件',
  service_retrofit: '备件维修技改', development: '研制验证',
}
const stageNames: Record<string, string> = {
  qualification: '商机判断', technical: '技术确认', diagnosis: '诊断',
  feasibility: '可行性', prototype: '样件验证', review: '跨部门评审',
  quoted: '已报价', contracted: '已签约', delivery: '交付中', closed: '已结项',
}
const departmentNames: Record<string, string> = {
  sales: '营销', engineering: '技术', production: '生产', procurement: '采购',
  quality: '质量', finance: '财务', service: '售后',
}

export default function ManufacturingCases() {
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState('')
  const [draft, setDraft] = useState({ customerId: '', title: '', businessType: 'equipment' })
  const [compliance, setCompliance] = useState({ requirementText: '', response: '', verdict: 'unconfirmed', sourceRef: '', deviation: '', verificationMethod: '' })
  const [change, setChange] = useState({ title: '', reason: '', beforeState: '', afterState: '', customerEvidenceRef: '', costDelta: 0, scheduleDeltaDays: 0 })
  const [milestone, setMilestone] = useState({ name: '', kind: 'other', promisedAt: '', forecastAt: '' })
  const [equipment, setEquipment] = useState({ siteName: '', lineName: '', model: '', serialNo: '' })
  const [links, setLinks] = useState({ requirementId: '', quotationId: '', contractId: '', projectId: '' })
  const [participantIds, setParticipantIds] = useState<string[]>([])
  const cases = useQuery({ queryKey: ['manufacturing-cases'], queryFn: manufacturingApi.cases })
  const summary = useQuery({ queryKey: ['manufacturing-summary'], queryFn: manufacturingApi.summary })
  const teamUsers = useQuery({ queryKey: ['manufacturing-team-users'], queryFn: manufacturingApi.teamUsers })
  const detail = useQuery({ queryKey: ['manufacturing-case', selectedId], queryFn: () => manufacturingApi.detail(selectedId), enabled: !!selectedId })
  const customers = useQuery({ queryKey: ['manufacturing-customers'], queryFn: () => customerApi.list({ pageSize: 200 }) })
  const requirements = useQuery({ queryKey: ['manufacturing-requirements'], queryFn: () => requirementApi.list({ pageSize: 200 }) })
  const quotations = useQuery({ queryKey: ['manufacturing-quotations'], queryFn: () => quotationApi.list({ pageSize: 200 }) })
  const contracts = useQuery({ queryKey: ['manufacturing-contracts'], queryFn: () => contractApi.list({ pageSize: 200 }) })
  const projects = useQuery({ queryKey: ['manufacturing-projects'], queryFn: () => projectApi.list({ pageSize: 200 }) })
  const list = (res: any) => Array.isArray(res) ? res : res?.list || []
  const refresh = () => { qc.invalidateQueries({ queryKey: ['manufacturing-cases'] }); qc.invalidateQueries({ queryKey: ['manufacturing-case', selectedId] }); qc.invalidateQueries({ queryKey: ['manufacturing-summary'] }) }
  const task = useMutation({
    mutationFn: async (run: () => Promise<any>) => run(),
    onSuccess: refresh,
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || '保存失败'),
  })
  const run = (action: () => Promise<any>) => task.mutate(action)
  const current = detail.data
  const exportSummary = () => {
    const rows = summary.data?.rows || []
    const cell = (value: unknown) => {
      const raw = String(value ?? '')
      const safe = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw
      return `"${safe.replace(/"/g, '""')}"`
    }
    const lines = [['项目名称', '业务类型', '阶段', '状态', '客户ID', '预计金额', '下次行动日期', '失单原因'],
      ...rows.map((row: any) => [row.title, typeNames[row.businessType] || row.businessType,
        stageNames[row.stage] || row.stage, row.status, row.customerId, row.expectedAmount, row.nextActionDue, row.lossReason])]
    const csv = '\uFEFF' + lines.map(line => line.map(cell).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `制造业务报表-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return <div className="space-y-5">
    <PageHeader title="离散制造" titleEm="业务协同" />
    <div className="eo-card p-4 flex flex-wrap items-center gap-4 text-sm">
      <span>项目总数 <strong>{summary.data?.total ?? '—'}</strong></span>
      {Object.entries(typeNames).map(([type, name]) => <span key={type}>{name} <strong>{summary.data?.byType?.[type] ?? 0}</strong></span>)}
      <span className="text-amber-600">逾期行动 {summary.data?.overdue?.length ?? 0}</span>
      <span>已完成 {summary.data?.won ?? 0}</span><span>失单 {summary.data?.lost ?? 0}</span>
      <Button variant="secondary" disabled={!summary.data} onClick={exportSummary}>导出项目报表 CSV</Button>
    </div>
    <div className="eo-card p-4 space-y-3">
      <h2 className="font-semibold">创建售前项目</h2>
      <p className="text-sm text-muted">按业务类型进入不同阶段。签约后的执行项目仍由合同转项目，随后在此关联。</p>
      <div className="grid md:grid-cols-3 gap-2">
        <select className="eo-input" value={draft.customerId} onChange={e => setDraft({ ...draft, customerId: e.target.value })} aria-label="客户">
          <option value="">选择客户</option>
          {list(customers.data).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input className="eo-input" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="售前项目名称" />
        <select className="eo-input" value={draft.businessType} onChange={e => setDraft({ ...draft, businessType: e.target.value })} aria-label="业务类型">
          {Object.entries(typeNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <Button disabled={!draft.customerId || !draft.title.trim() || task.isPending} onClick={() => run(async () => {
        const created = await manufacturingApi.createCase(draft)
        setSelectedId(created.id)
        setDraft({ customerId: '', title: '', businessType: 'equipment' })
      })}>创建</Button>
    </div>
    <div className="grid lg:grid-cols-[280px_1fr] gap-4">
      <div className="eo-card p-3 space-y-2">
        <h2 className="font-semibold px-1">售前项目</h2>
        {list(cases.data).map((row: any) => <button key={row.id} onClick={() => { setSelectedId(row.id); setParticipantIds(row.participantIds || []); setLinks({ requirementId: row.requirementId || '', quotationId: row.quotationId || '', contractId: row.contractId || '', projectId: row.projectId || '' }) }}
          className={`w-full text-left rounded border p-2 text-sm ${selectedId === row.id ? 'border-accent-500 bg-accent-50' : 'border-border'}`}>
          <div className="font-medium">{row.title}</div>
          <div className="text-muted text-xs">{typeNames[row.businessType]} · {row.status === 'lost' ? '失单' : stageNames[row.stage] || row.stage}</div>
        </button>)}
      </div>
      <div className="space-y-4">
        {!current ? <div className="eo-card p-5 text-muted">选择一条售前项目查看完整业务链。</div> : <>
          <div className="eo-card p-4 space-y-3">
            <div className="flex justify-between gap-2 items-center"><h2 className="font-semibold">{current.title}</h2><span>{stageNames[current.stage] || current.stage}</span></div>
            <p className="text-sm text-muted">{typeNames[current.businessType]} · 版本 {current.version} · 负责人 {current.ownerId || '—'}</p>
            <div className="grid md:grid-cols-4 gap-2">
              <select className="eo-input" value={links.requirementId} onChange={e => setLinks({ ...links, requirementId: e.target.value })} aria-label="关联需求"><option value="">关联需求</option>{list(requirements.data).filter((r: any) => r.customerId === current.customerId).map((r: any) => <option key={r.id} value={r.id}>{r.title}</option>)}</select>
              <select className="eo-input" value={links.quotationId} onChange={e => setLinks({ ...links, quotationId: e.target.value })} aria-label="关联报价"><option value="">关联报价</option>{list(quotations.data).filter((r: any) => r.customerId === current.customerId).map((r: any) => <option key={r.id} value={r.id}>{r.quotationNo}</option>)}</select>
              <select className="eo-input" value={links.contractId} onChange={e => setLinks({ ...links, contractId: e.target.value })} aria-label="关联合同"><option value="">关联合同</option>{list(contracts.data).filter((r: any) => r.customerId === current.customerId).map((r: any) => <option key={r.id} value={r.id}>{r.contractNo}</option>)}</select>
              <select className="eo-input" value={links.projectId} onChange={e => setLinks({ ...links, projectId: e.target.value })} aria-label="关联执行项目"><option value="">关联执行项目</option>{list(projects.data).filter((r: any) => r.customerId === current.customerId).map((r: any) => <option key={r.id} value={r.id}>{r.projectNo} {r.name}</option>)}</select>
            </div>
            <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => run(() => manufacturingApi.updateCase(current.id, { ...links, version: current.version }))}>保存关联</Button>{current.status === 'open' && <Button onClick={() => run(() => manufacturingApi.advance(current.id))}>推进下一阶段</Button>}{current.status === 'open' && !['contracted', 'delivery'].includes(current.stage) && <Button variant="secondary" onClick={() => { const reason = window.prompt('失单原因'); if (reason?.trim()) run(() => manufacturingApi.lose(current.id, current.version, reason)) }}>标记失单</Button>}</div>
            {current.status === 'lost' && <p className="text-sm text-muted">失单原因：{current.lossReason}</p>}
            {current.projectId && <Link to={`/projects/${current.projectId}/report`} className="inline-block text-sm text-accent-600">查看项目结项报告 →</Link>}
            <div className="border-t border-border pt-3 space-y-2">
              <h3 className="font-medium text-sm">项目参与人员（可查看并参与评审）</h3>
              <div className="flex flex-wrap gap-3 text-sm">{teamUsers.data?.map(person => <label key={person.id} className="inline-flex items-center gap-1"><input type="checkbox" checked={participantIds.includes(person.id)} onChange={e => setParticipantIds(e.target.checked ? [...participantIds, person.id] : participantIds.filter(id => id !== person.id))}/>{person.nickname || person.username}</label>)}</div>
              <Button variant="secondary" onClick={() => run(() => manufacturingApi.updateCase(current.id, { participantIds, version: current.version }))}>保存参与人员</Button>
            </div>
          </div>
          <div className="eo-card p-4 space-y-2"><h3 className="font-semibold">客户设备档案</h3>
            <div className="grid md:grid-cols-4 gap-2">{(['siteName', 'lineName', 'model', 'serialNo'] as const).map(k => <input key={k} className="eo-input" placeholder={({siteName:'工厂',lineName:'产线',model:'型号',serialNo:'序列号'} as any)[k]} value={equipment[k]} onChange={e => setEquipment({ ...equipment, [k]: e.target.value })} />)}</div>
            <Button variant="secondary" disabled={!equipment.siteName || !equipment.model} onClick={() => run(() => manufacturingApi.addEquipment({ ...equipment, customerId: current.customerId }))}>登记设备</Button>
            <div className="text-sm">{current.equipment?.map((e: any) => <p key={e.id}>{e.siteName} / {e.lineName || '—'} / {e.model} / {e.serialNo || '—'}</p>)}</div>
          </div>
          <div className="eo-card p-4 space-y-2"><h3 className="font-semibold">技术符合性</h3>
            <div className="grid md:grid-cols-2 gap-2"><input className="eo-input" placeholder="客户要求" value={compliance.requirementText} onChange={e => setCompliance({ ...compliance, requirementText: e.target.value })}/><input className="eo-input" placeholder="来源文件与页码" value={compliance.sourceRef} onChange={e => setCompliance({ ...compliance, sourceRef: e.target.value })}/><input className="eo-input" placeholder="我方响应" value={compliance.response} onChange={e => setCompliance({ ...compliance, response: e.target.value })}/><select className="eo-input" value={compliance.verdict} onChange={e => setCompliance({ ...compliance, verdict: e.target.value })} aria-label="符合结论"><option value="unconfirmed">待确认</option><option value="compliant">符合</option><option value="deviation">存在偏差</option><option value="customer_accepted">客户接受偏差</option></select><input className="eo-input" placeholder="偏差说明" value={compliance.deviation} onChange={e => setCompliance({ ...compliance, deviation: e.target.value })}/><input className="eo-input" placeholder="验证方式" value={compliance.verificationMethod} onChange={e => setCompliance({ ...compliance, verificationMethod: e.target.value })}/></div>
            <Button variant="secondary" disabled={!compliance.requirementText.trim()} onClick={() => run(() => manufacturingApi.addCompliance(current.id, compliance))}>添加要求</Button>
            {current.compliance?.map((item: any) => <p className="text-sm border-b border-border py-1" key={item.id}>{item.requirementText} · {item.verdict} · {item.sourceRef || '未填来源'}</p>)}
          </div>
          <div className="eo-card p-4 space-y-2"><h3 className="font-semibold">跨部门订单评审</h3><p className="text-sm text-muted">进入报价阶段前，所需部门均须明确批准；有条件通过仍需补齐条件后再批准。</p>
            <div className="grid md:grid-cols-2 gap-2">{current.requiredDepartments?.map((department: string) => {
              const record = current.reviews?.find((r: any) => r.department === department)
              return <div key={department} className="border border-border rounded p-2 text-sm flex justify-between items-center"><span>{departmentNames[department] || department} · {record?.verdict || '待评审'}</span><button className="text-accent-600" onClick={() => { const note = window.prompt(`${departmentNames[department] || department}评审意见`); if (note !== null) run(() => manufacturingApi.review(current.id, { department, verdict: 'approved', note })) }}>批准</button></div>
            })}</div>
          </div>
          <div className="eo-card p-4 space-y-2"><h3 className="font-semibold">工程变更</h3>
            <div className="grid md:grid-cols-2 gap-2">{(['title','reason','beforeState','afterState','customerEvidenceRef'] as const).map(k => <input key={k} className="eo-input" placeholder={({title:'变更标题',reason:'变更原因',beforeState:'变更前',afterState:'变更后',customerEvidenceRef:'客户确认依据'} as any)[k]} value={change[k]} onChange={e => setChange({ ...change, [k]: e.target.value })}/>)}</div>
            <Button variant="secondary" disabled={!change.title || !change.reason || !change.beforeState || !change.afterState} onClick={() => run(() => manufacturingApi.addChange(current.id, change))}>提交变更</Button>
            {current.changes?.map((item: any) => <div key={item.id} className="flex justify-between border-b border-border py-1 text-sm"><span>{item.title} · {item.status}</span>{item.status === 'draft' && <button className="text-accent-600" onClick={() => run(() => manufacturingApi.approveChange(current.id, item.id))}>审批</button>}</div>)}
          </div>
          <div className="eo-card p-4 space-y-2"><h3 className="font-semibold">交付里程碑</h3><p className="text-sm text-muted">结项前至少完成一个“客户验收”节点，并填写签收单或验收报告编号。</p><div className="grid md:grid-cols-4 gap-2"><input className="eo-input" placeholder="节点名称" value={milestone.name} onChange={e => setMilestone({ ...milestone, name: e.target.value })}/><select className="eo-input" value={milestone.kind} onChange={e => setMilestone({ ...milestone, kind: e.target.value })} aria-label="节点类型"><option value="other">其他</option><option value="plan">计划</option><option value="production">生产</option><option value="shipment">发运</option><option value="installation">安装调试</option><option value="acceptance">客户验收</option></select><input className="eo-input" type="date" value={milestone.promisedAt} onChange={e => setMilestone({ ...milestone, promisedAt: e.target.value })}/><input className="eo-input" type="date" value={milestone.forecastAt} onChange={e => setMilestone({ ...milestone, forecastAt: e.target.value })}/></div><Button variant="secondary" disabled={!current.projectId || !milestone.name} onClick={() => run(() => manufacturingApi.addMilestone(current.id, milestone))}>添加节点</Button>
            {current.milestones?.map((item: any) => <div key={item.id} className="text-sm flex gap-2 border-b border-border py-1"><span className="flex-1">{item.name} · {item.kind === 'acceptance' ? '客户验收' : item.kind} · 承诺 {item.promisedAt || '—'} · 预测 {item.forecastAt || '—'} · {item.status}</span>{item.status !== 'done' && <button className="text-accent-600" onClick={() => { const evidenceRef = window.prompt('完成依据：文档编号或资料链接'); if (evidenceRef) run(() => manufacturingApi.updateMilestone(current.id, item.id, { status: 'done', actualAt: new Date().toISOString().slice(0,10), evidenceRef })) }}>完成</button>}</div>)}
          </div>
        </>}
      </div>
    </div>
  </div>
}
