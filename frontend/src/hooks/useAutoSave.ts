import { useEffect, useRef, useCallback, useState } from 'react'

/**
 * 自动保存 Hook。
 *
 * 长表单（方案编辑、需求描述）在用户停止输入后自动保存，
 * 避免意外关闭页面导致数据丢失。
 *
 * @param values    表单值对象
 * @param onSave    保存函数（返回 Promise）
 * @param options   配置项
 * @param options.delay     防抖延迟（毫秒），默认 2000
 * @param options.enabled   是否启用，默认 true
 * @param options.onSuccess 保存成功回调
 * @param options.onError   保存失败回调
 */
export function useAutoSave<T extends Record<string, any>>(
  values: T,
  onSave: (values: T) => Promise<any>,
  options: {
    delay?: number
    enabled?: boolean
    onSuccess?: () => void
    onError?: (err: any) => void
  } = {},
) {
  const { delay = 2000, enabled = true, onSuccess, onError } = options
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestValuesRef = useRef<T>(values)
  const isFirstRender = useRef(true)
  const prevValuesRef = useRef<string>('')

  // 始终保持最新值
  latestValuesRef.current = values

  const doSave = useCallback(async () => {
    if (!enabled) return
    const serialized = JSON.stringify(latestValuesRef.current)
    // 值没变不保存
    if (serialized === prevValuesRef.current) return

    setStatus('saving')
    try {
      await onSave(latestValuesRef.current)
      prevValuesRef.current = serialized
      setStatus('saved')
      setLastSavedAt(new Date())
      onSuccess?.()
      // 3秒后回到idle
      setTimeout(() => setStatus('idle'), 3000)
    } catch (err) {
      setStatus('error')
      onError?.(err)
      setTimeout(() => setStatus('idle'), 5000)
    }
  }, [enabled, onSave, onSuccess, onError])

  useEffect(() => {
    if (!enabled) return
    // 跳过首次渲染
    if (isFirstRender.current) {
      isFirstRender.current = false
      prevValuesRef.current = JSON.stringify(values)
      return
    }

    // 值没变不触发
    const serialized = JSON.stringify(values)
    if (serialized === prevValuesRef.current) return

    // 清除上次定时器
    if (timerRef.current) clearTimeout(timerRef.current)

    // 设置新的防抖定时器
    timerRef.current = setTimeout(doSave, delay)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [values, delay, enabled, doSave])

  // 页面卸载前强制保存
  useEffect(() => {
    if (!enabled) return

    const handleBeforeUnload = () => {
      const serialized = JSON.stringify(latestValuesRef.current)
      if (serialized !== prevValuesRef.current) {
        // 同步发送（navigator.sendBeacon 不支持 JSON，用 keepalive fetch）
        navigator.sendBeacon?.('/api/auto-save', serialized)
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [enabled])

  return {
    status,
    lastSavedAt,
    save: doSave,
    /** 格式化上次保存时间 */
    lastSavedText: lastSavedAt
      ? `${lastSavedAt.getHours().toString().padStart(2, '0')}:${lastSavedAt.getMinutes().toString().padStart(2, '0')} 已自动保存`
      : null,
  }
}
