const CURRENT_VERSION = '0.1.0'
const CHECK_INTERVAL = 24 * 60 * 60 * 1000 // 24 hours

interface UpdateInfo {
  version: string
  releaseDate: string
  downloadUrl: string
  changelog: string
}

export async function checkForUpdates(): Promise<UpdateInfo | null> {
  try {
    const response = await fetch('/api/system/version')
    if (!response.ok) return null

    const data = await response.json()
    const serverVersion = data.version

    if (serverVersion && isNewerVersion(serverVersion, CURRENT_VERSION)) {
      return {
        version: serverVersion,
        releaseDate: data.buildDate || new Date().toISOString(),
        // 下载地址优先用服务端返回的，避免前端硬编码可能失效的仓库地址
        downloadUrl: data.downloadUrl || '/settings/system-info',
        changelog: data.changelog || '发现新版本，请联系管理员或在系统信息页查看详情。',
      }
    }

    return null
  } catch {
    return null
  }
}

function isNewerVersion(server: string, current: string): boolean {
  const serverParts = server.split('.').map(Number)
  const currentParts = current.split('.').map(Number)

  for (let i = 0; i < Math.max(serverParts.length, currentParts.length); i++) {
    const serverPart = serverParts[i] || 0
    const currentPart = currentParts[i] || 0

    if (serverPart > currentPart) return true
    if (serverPart < currentPart) return false
  }

  return false
}

export function shouldCheckUpdate(): boolean {
  const lastCheck = localStorage.getItem('aikb-last-update-check')
  if (!lastCheck) return true
  return Date.now() - parseInt(lastCheck) > CHECK_INTERVAL
}

export function markUpdateChecked(): void {
  localStorage.setItem('aikb-last-update-check', Date.now().toString())
}

export function isVersionDismissed(version: string): boolean {
  const dismissed = localStorage.getItem('aikb-dismissed-version')
  return dismissed === version
}

export function dismissVersion(version: string): void {
  localStorage.setItem('aikb-dismissed-version', version)
}