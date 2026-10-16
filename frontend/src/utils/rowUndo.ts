import { toast } from 'sonner'

/**
 * 删除一行但留 5 秒撤销窗口（Toaster 全局 duration=5000，与此对齐）。
 *
 * 设备配套 / 备件管理 / 外协加工三个页签的配件行删除原来是点击即删——没有二次确认、
 * 没有撤销、连 toast 都没有。行数常有几十条、图标只有 14px，误删一次就要把供应商选型
 * 重新录一遍。改成"先移出列表 + toast 提供撤销"而不是加二次确认弹窗，是因为这些表格
 * 本身就是高频编辑场景，弹窗确认会让正常删除也变慢；撤销只在真正误删时才用得上。
 */
export function deleteRowWithUndo<T extends { key: string }>(
  rows: T[],
  key: string,
  setRows: (updater: (prev: T[]) => T[]) => void,
  label?: string,
) {
  const idx = rows.findIndex((r) => r.key === key)
  if (idx === -1) return
  const removed = rows[idx]
  setRows((prev) => prev.filter((r) => r.key !== key))
  toast(`已删除${label ? `「${label}」` : '该行'}`, {
    action: {
      label: '撤销',
      onClick: () =>
        setRows((prev) => {
          // 撤销前又新增/撤销过一次同 key 的行，不重复插入
          if (prev.some((r) => r.key === key)) return prev
          const next = [...prev]
          next.splice(Math.min(idx, next.length), 0, removed)
          return next
        }),
    },
  })
}
