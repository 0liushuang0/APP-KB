import { useAuthStore } from '../store/authStore'

/** 可以看成本价与毛利的角色（与后端 PermissionService.COST_VIEW_ROLES 一致） */
export const COST_VIEW_ROLES = ['admin', 'manager', 'sales_lead', 'purchase', 'approver', 'dept_admin']

/**
 * 当前用户能否看成本与毛利（字段级权限）。
 *
 * 只用于决定界面上显示不显示成本列 —— 真正的控制在后端：没有权限时接口本身就不返回成本。
 * 接口返回的 costVisible 优先（传进来就以它为准）。
 */
export function useCostVisible(fromServer?: boolean | null): boolean {
  const appMode = useAuthStore((s) => s.appMode)
  const hasAnyRole = useAuthStore((s) => s.hasAnyRole)
  if (typeof fromServer === 'boolean') return fromServer
  return appMode !== 'team' || hasAnyRole(COST_VIEW_ROLES)
}
