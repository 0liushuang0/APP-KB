import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Database, RefreshCw, AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react'
import { aiIndexApi } from '../api/services'
import Button from './Button'

/**
 * 向量索引健康度。
 *
 * 存在的理由：索引原本只在"通过界面新建/修改"时才写入，批量导入的数据从来没进过索引，
 * 而系统里没有任何地方能看出少了多少 —— 实测曾经 195 个客户只索引了 40 个、
 * 249 家供应商只有 96 家，AI 答不出来却看不出原因。这个面板把差额摆到明面上，
 * 并提供一键重建。
 */
export default function IndexHealthPanel() {
  const queryClient = useQueryClient()
  const [kbProgress, setKbProgress] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['ai-index-health'],
    queryFn: () => aiIndexApi.health(),
    refetchInterval: 30_000,
  })

  const reindex = useMutation({
    mutationFn: (types?: string[]) => aiIndexApi.reindex(types),
    onSuccess: (res) => {
      const total = Object.values(res.result || {}).reduce(
        (s, n) => s + (Number(n) > 0 ? Number(n) : 0),
        0,
      )
      toast.success(`索引重建完成，共写入 ${total} 个对象`)
      queryClient.invalidateQueries({ queryKey: ['ai-index-health'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '重建失败'),
  })

  /**
   * 知识资料要重新读文件解析，单次请求跑完三十份会把后端拖崩，
   * 所以按小批循环调用，并把进度显示出来。
   */
  const rebuildKnowledge = async () => {
    let offset = 0
    let indexed = 0
    let chunks = 0
    try {
      for (let i = 0; i < 60; i++) {
        setKbProgress(`正在重建知识资料…已完成 ${offset} 份`)
        const r = await aiIndexApi.reindexKnowledge({ force: true, limit: 3, offset })
        offset += r.processed
        indexed += r.indexed
        chunks += r.chunks
        if (r.remaining === 0 || r.processed === 0) break
      }
      toast.success(`知识资料重建完成：${indexed} 份可索引，共 ${chunks} 个文本块`)
      queryClient.invalidateQueries({ queryKey: ['ai-index-health'] })
    } catch (e: any) {
      toast.error(e?.response?.data?.message || '知识资料重建失败')
    } finally {
      setKbProgress(null)
    }
  }

  const rows = data?.rows || []
  const offline = data && !data.aiOnline
  // 缺口：应索引但没进索引的对象数，决定要不要标红
  const gapOf = (r: (typeof rows)[number]) =>
    r.indexed === null ? 0 : Math.max(0, r.expected - r.indexed)
  const totalGap = rows.reduce((s, r) => s + gapOf(r), 0)

  return (
    <div className="eo-card p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-lg bg-accent-50 flex items-center justify-center">
          <Database size={17} className="text-accent-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-ink">索引健康度</h3>
          <p className="text-caption text-muted">
            AI 只能回答"已进索引"的内容。这里显示每类数据实际进了多少。
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => reindex.mutate(undefined)}
          loading={reindex.isPending || data?.running}
          disabled={!!kbProgress}
        >
          <RefreshCw size={14} className="mr-1" /> 重建业务数据索引
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={rebuildKnowledge}
          loading={!!kbProgress}
          disabled={reindex.isPending}
        >
          <RefreshCw size={14} className="mr-1" /> 重建知识资料
        </Button>
      </div>

      {offline && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-warning-line bg-warning-bg p-3 text-xs text-warning-fg">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            AI 服务离线，读不到索引数量（下表显示「—」而不是 0）。
            请先确认 AI 服务已启动，否则重建也无法进行。
          </span>
        </div>
      )}

      {kbProgress && <p className="mb-3 text-xs text-muted">{kbProgress}</p>}

      {isLoading ? (
        <p className="text-sm text-muted py-2">加载中…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted bg-canvas">
              <tr>
                <th className="text-left px-3 py-2 font-medium rounded-l-md">数据类型</th>
                <th className="text-right px-3 py-2 font-medium">系统内</th>
                <th className="text-right px-3 py-2 font-medium">已索引</th>
                <th className="text-right px-3 py-2 font-medium">文本块</th>
                <th className="text-right px-3 py-2 font-medium rounded-r-md">覆盖率</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const gap = gapOf(r)
                const pct =
                  r.indexed === null || r.expected === 0
                    ? null
                    : Math.min(100, Math.round((r.indexed / r.expected) * 100))
                return (
                  <tr key={r.sourceType} className="border-t border-border">
                    <td className="px-3 py-2 text-ink">{r.label}</td>
                    <td className="px-3 py-2 text-right eo-num text-muted">{r.expected}</td>
                    <td className="px-3 py-2 text-right eo-num text-ink">
                      {r.indexed === null ? '—' : r.indexed}
                    </td>
                    <td className="px-3 py-2 text-right eo-num text-muted">
                      {r.chunks === null ? '—' : r.chunks}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {pct === null ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <span
                          className={`inline-flex items-center gap-1 eo-num ${
                            gap > 0 ? 'text-danger-fg' : 'text-success-fg'
                          }`}
                        >
                          {gap > 0 ? <AlertTriangle size={11} /> : <CheckCircle2 size={11} />}
                          {pct}%
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 flex items-start gap-1.5 text-caption text-muted">
        <HelpCircle size={12} className="mt-0.5 shrink-0" />
        <span>
          {totalGap > 0
            ? `当前有 ${totalGap} 个对象未进索引，AI 回答时检索不到它们，建议点上方重建。`
            : '全部数据已进索引。'}
          {' 知识资料需重新读文件解析，用单独的按钮；扫描件（无文字层）无法索引，会被跳过。'}
          {data?.lastRunAt && ` 上次重建：${new Date(data.lastRunAt).toLocaleString('zh-CN')}。`}
        </span>
      </div>
    </div>
  )
}
