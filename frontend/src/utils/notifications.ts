let permissionRequested = false

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  if (!permissionRequested) {
    permissionRequested = true
    return await Notification.requestPermission()
  }
  return Notification.permission
}

export async function sendNotification(title: string, body: string, icon?: string): Promise<void> {
  const perm = await requestNotificationPermission()
  if (perm !== 'granted') return

  try {
    new Notification(title, {
      body,
      icon: icon || '/favicon.ico',
      tag: title,
      silent: false,
    })
  } catch {
    // Notifications may fail in some environments; silently ignore
  }
}

export function canNotify(): boolean {
  return 'Notification' in window && Notification.permission === 'granted'
}

export async function notifyIfPermitted(title: string, body: string, icon?: string): Promise<void> {
  if (!('Notification' in window)) return
  if (Notification.permission === 'default') {
    await requestNotificationPermission()
  }
  if (Notification.permission === 'granted') {
    sendNotification(title, body, icon)
  }
}
