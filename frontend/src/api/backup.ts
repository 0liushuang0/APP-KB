import apiClient from './client'

export interface BackupInfo {
  fileName: string
  filePath: string
  size: number
  createdAt: string
}

export interface RestoreStatus {
  /** ok = 上次还原成功或从未还原；failed = 重启时还原失败 */
  status: 'ok' | 'failed'
  error?: string
  failedAt?: string
  /** 已提交还原、等待重启生效 */
  pending: boolean
}

export const backupApi = {
  list: () => apiClient.get<BackupInfo[]>('/backup').then((res) => res.data),
  create: (note?: string) => apiClient.post<BackupInfo>('/backup', { note }).then((res) => res.data),
  restore: (fileName: string) =>
    apiClient
      .post<{ requiresRestart: true; manifest: any }>(
        `/backup/${encodeURIComponent(fileName)}/restore`,
      )
      .then((res) => res.data),
  remove: (fileName: string) =>
    apiClient.delete(`/backup/${encodeURIComponent(fileName)}`).then((res) => res.data),
  restoreStatus: () => apiClient.get<RestoreStatus>('/backup/restore-status').then((res) => res.data),
  ackRestoreFailure: () => apiClient.delete('/backup/restore-status').then((res) => res.data),
}

/**
 * 备份下载走 fetch + blob。
 *
 * 备份包里是全部业务数据，接口带鉴权。
 * 认证通过 httpOnly Cookie 携带，fetch 需要 credentials: 'include'。
 */
export async function downloadBackup(fileName: string): Promise<void> {
  const base = import.meta.env.VITE_API_BASE_URL || '/api'
  const res = await fetch(`${base}/backup/${encodeURIComponent(fileName)}/download`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error(res.status === 403 ? '无权下载备份' : '下载失败')

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
