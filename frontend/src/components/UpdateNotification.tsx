import { useState, useEffect } from 'react'
import { X, Download, RefreshCw } from 'lucide-react'
import { checkForUpdates, shouldCheckUpdate, markUpdateChecked, isVersionDismissed, dismissVersion } from '../utils/updateCheck'

interface UpdateInfo {
  version: string
  releaseDate: string
  downloadUrl: string
  changelog: string
}

export default function UpdateNotification() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const checkUpdate = async () => {
      if (!shouldCheckUpdate()) return

      const update = await checkForUpdates()
      markUpdateChecked()

      if (update && !isVersionDismissed(update.version)) {
        setUpdateInfo(update)
        setIsVisible(true)
      }
    }

    checkUpdate()
  }, [])

  const handleDismiss = () => {
    if (updateInfo) {
      dismissVersion(updateInfo.version)
    }
    setIsVisible(false)
  }

  if (!isVisible || !updateInfo) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm">
      <div className="bg-info-50 border border-info-200 rounded-lg shadow-lg p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <RefreshCw size={20} className="text-info-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-medium text-info-900">
              New version {updateInfo.version} available
            </h4>
            <p className="text-sm text-info-700 mt-1">
              {updateInfo.changelog}
            </p>
            <div className="mt-3 flex gap-2">
              <a
                href={updateInfo.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-info-600 rounded-md hover:bg-info-700 transition-colors"
              >
                <Download size={14} />
                Download
              </a>
              <button
                onClick={handleDismiss}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-info-700 bg-info-100 rounded-md hover:bg-info-200 transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            title="忽略提醒"
            className="flex-shrink-0 text-info-400 hover:text-info-600 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}