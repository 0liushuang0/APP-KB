import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Archive,
  Download,
  HardDriveDownload,
  Trash2,
  ShieldAlert,
  RotateCcw,
  CheckCircle2,
  FileJson,
  Upload,
} from 'lucide-react'
import Button from '../../components/Button'
import Modal from '../../components/Modal'
import EmptyState from '../../components/EmptyState'
import { backupApi, downloadBackup, type BackupInfo } from '../../api/backup'
import { downloadJsonExport, dataPortabilityApi } from '../../api/services'
import { notifyIfPermitted } from '../../utils/notifications'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * 备份与还原。
 *
 * 单机版没有运维、没有主从、没有快照，用户的全部数据就在这一台电脑上。
 * 系统导出的 Excel 是报表不是备份 —— 导不出附件和审计记录，也还原不回来。
 * 这一页是唯一能让数据"回得来"的地方，所以宁可啰嗦也要把后果说清楚。
 */
export default function BackupRestore() {
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')
  const [restoreTarget, setRestoreTarget] = useState<BackupInfo | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BackupInfo | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [jsonExporting, setJsonExporting] = useState(false)
  const [jsonImporting, setJsonImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: backups = [], isLoading } = useQuery({
    queryKey: ['backups'],
    queryFn: backupApi.list,
  })

  // 还原是"重启后生效"的异步动作，重启完必须给个明确交代
  const { data: restoreStatus } = useQuery({
    queryKey: ['restore-status'],
    queryFn: backupApi.restoreStatus,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['backups'] })
    queryClient.invalidateQueries({ queryKey: ['restore-status'] })
  }

  const createMutation = useMutation({
    mutationFn: () => backupApi.create(note.trim() || undefined),
    onSuccess: (info) => {
      toast.success(`备份完成：${formatSize(info.size)}`)
      notifyIfPermitted('备份完成', `备份文件大小：${formatSize(info.size)}`)
      setNote('')
      invalidate()
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || '备份失败'),
  })

  const restoreMutation = useMutation({
    mutationFn: (fileName: string) => backupApi.restore(fileName),
    onSuccess: () => {
      toast.success('已准备还原，请关闭并重新启动程序')
      setRestoreTarget(null)
      setConfirmText('')
      invalidate()
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || '还原失败'),
  })

  const deleteMutation = useMutation({
    mutationFn: (fileName: string) => backupApi.remove(fileName),
    onSuccess: () => {
      toast.success('已删除')
      setDeleteTarget(null)
      invalidate()
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || '删除失败'),
  })

  const ackMutation = useMutation({
    mutationFn: backupApi.ackRestoreFailure,
    onSuccess: invalidate,
  })

  const handleDownload = async (fileName: string) => {
    try {
      await downloadBackup(fileName)
    } catch (err: any) {
      toast.error(err.message || '下载失败')
    }
  }

  const handleJsonExport = async () => {
    setJsonExporting(true)
    try {
      await downloadJsonExport()
      toast.success('JSON 导出完成')
    } catch (err: any) {
      toast.error(err.message || '导出失败')
    } finally {
      setJsonExporting(false)
    }
  }

  const handleJsonImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setJsonImporting(true)
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const result = await dataPortabilityApi.importJson(data)
      const total = Object.values(result.imported).reduce((a, b) => a + b, 0)
      toast.success(`导入完成：${total} 条记录`)
      if (result.errors.length > 0) {
        toast.warning(`${result.errors.length} 条警告，请查看控制台`)
        console.warn('Import warnings:', result.errors)
      }
      queryClient.invalidateQueries()
    } catch (err: any) {
      toast.error(err.message || '导入失败（JSON 格式错误）')
    } finally {
      setJsonImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-6">
      {/* 上次还原失败：必须挡在最上面，用户重启后只会看到系统正常启动 */}
      {restoreStatus?.status === 'failed' && (
        <div className="bg-danger-bg border border-danger-line rounded-lg p-4 flex gap-3">
          <ShieldAlert size={20} className="text-danger-fg shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-danger-fg">上次还原没有成功，数据保持原样</p>
            <p className="text-sm text-danger-fg mt-1 break-words">{restoreStatus.error}</p>
            <p className="text-sm text-danger-fg mt-2">
              常见原因是数据库文件被占用：请确认没有开着第二个程序窗口，暂停网盘同步或杀毒软件的实时扫描后，重新执行还原。
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={() => ackMutation.mutate()}
              loading={ackMutation.isPending}
            >
              我知道了
            </Button>
          </div>
        </div>
      )}

      {restoreStatus?.pending && (
        <div className="bg-warning-bg border border-warning-line rounded-lg p-4 flex gap-3">
          <RotateCcw size={20} className="text-warning-fg shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-warning-fg">还原已就绪，等待重启</p>
            <p className="text-sm text-warning-fg mt-1">
              请关闭程序后重新打开，还原会在启动时完成。在此之前数据没有任何改动。
            </p>
          </div>
        </div>
      )}

      <div className="bg-surface p-6 rounded-lg border border-border">
        <div className="flex items-center gap-2 mb-2">
          <Archive size={20} className="text-accent-600" />
          <h2 className="text-lg font-semibold">创建备份</h2>
        </div>
        <p className="text-sm text-muted mb-4">
          备份包含全部业务数据与附件文件，打包为一个 zip。
          <span className="text-ink-soft">
            建议定期下载到 U 盘或另一块硬盘 —— 备份和原数据放在同一块盘上，等于没有备份。
          </span>
        </p>
        <div className="flex gap-3">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder="备注（可选），例如：季度归档 / 升级前"
            className="flex-1 px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500"
          />
          <Button onClick={() => createMutation.mutate()} loading={createMutation.isPending}>
            <Archive size={15} className="mr-1.5" />
            立即备份
          </Button>
        </div>
      </div>

      <div className="bg-surface rounded-lg border border-border overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-semibold">备份记录</h2>
          <span className="text-sm text-muted">{backups.length} 个</span>
        </div>

        {isLoading ? (
          <div className="p-6 text-sm text-muted">加载中…</div>
        ) : backups.length === 0 ? (
          <EmptyState
            bare
            icon={Archive}
            title="还没有备份"
            description="第一次备份建议现在就做，之后每次大批量录入或升级前再备一次。"
          />
        ) : (
          <div className="divide-y divide-border">
            {backups.map((b) => (
              <div
                key={b.fileName}
                className="px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink truncate">{b.fileName}</p>
                  <p className="text-sm text-muted mt-0.5">
                    {formatTime(b.createdAt)} · {formatSize(b.size)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => handleDownload(b.fileName)}>
                    <Download size={15} className="mr-1.5" />
                    下载
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setRestoreTarget(b)}>
                    <HardDriveDownload size={15} className="mr-1.5" />
                    还原
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(b)}>
                    <Trash2 size={15} className="text-danger-fg" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/*
        还原会整体覆盖现有数据，是这个系统里最危险的一个按钮。
        要求手动输入确认词，避免误点。
      */}
      <Modal
        open={!!restoreTarget}
        onClose={() => {
          setRestoreTarget(null)
          setConfirmText('')
        }}
        title="还原备份"
        confirmText="确认还原"
        confirmDisabled={confirmText !== '还原'}
        loading={restoreMutation.isPending}
        onConfirm={() => restoreTarget && restoreMutation.mutate(restoreTarget.fileName)}
      >
        <div className="space-y-4 text-sm">
          <div className="bg-danger-bg border border-danger-line rounded-md p-3 text-danger-fg">
            当前所有数据将被
            <strong>这份备份的内容整体替换</strong>
            ，备份之后新增的客户、方案、报价、附件都会消失。
          </div>
          <div className="space-y-1.5 text-ink-soft">
            <p>
              备份文件：<span className="text-ink font-medium">{restoreTarget?.fileName}</span>
            </p>
            <p>
              创建时间：
              <span className="text-ink font-medium">
                {restoreTarget && formatTime(restoreTarget.createdAt)}
              </span>
            </p>
          </div>
          <div className="flex gap-2 text-ink-soft bg-subtle rounded-md p-3">
            <CheckCircle2 size={16} className="text-accent-600 shrink-0 mt-0.5" />
            <span>
              还原前会自动把当前数据库另存一份，万一还原错了还能找回来。还原在下次启动时执行，现在点确认不会立即改动数据。
            </span>
          </div>
          <div>
            <label className="block text-ink-soft mb-1.5">
              请输入 <span className="font-medium text-ink">还原</span> 以确认
            </label>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500"
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="删除备份"
        confirmText="删除"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.fileName)}
        size="sm"
      >
        <p className="text-sm text-ink-soft">
          删除后无法恢复。确认删除 <span className="text-ink font-medium">{deleteTarget?.fileName}</span>？
        </p>
      </Modal>

      {/* JSON 数据导出/导入 */}
      <div className="border-t border-border pt-6 mt-6">
        <div className="flex items-center gap-2 mb-4">
          <FileJson size={20} className="text-info-fg" />
          <h2 className="text-lg font-semibold">JSON 数据迁移</h2>
        </div>
        <p className="text-sm text-muted mb-4">
          导出全部业务数据为 JSON 格式，可跨平台迁移、选择性导入、或在版本升级时使用。
          <span className="text-ink-soft"> 不含附件文件（附件请用上方的备份功能）。</span>
        </p>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => handleJsonExport()} loading={jsonExporting}>
            <Download size={15} className="mr-1.5" />
            导出 JSON
          </Button>
          <Button variant="secondary" onClick={() => fileInputRef.current?.click()} loading={jsonImporting}>
            <Upload size={15} className="mr-1.5" />
            导入 JSON
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleJsonImport}
          />
        </div>
      </div>
    </div>
  )
}
