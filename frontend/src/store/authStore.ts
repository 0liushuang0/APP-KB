import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface User {
  id: string
  username: string
  nickname?: string
  email?: string
  avatar?: string
  roles: { code: string; name: string }[]
  department?: any
  groups?: any[]
}

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  appMode: 'single' | 'team' | null
  setAuth: (data: { user: User }) => void
  clearAuth: () => void
  setAppMode: (mode: 'single' | 'team') => void
  hasRole: (code: string) => boolean
  hasAnyRole: (codes: string[]) => boolean
}

/**
 * 认证状态管理。
 *
 * 令牌存储在 httpOnly Cookie 中（后端设置），JavaScript 无法读取。
 * 这里只存储用户信息和登录状态，用于 UI 展示和路由守卫。
 *
 * 注意：isAuthenticated 只是本地状态标记，实际认证以 httpOnly Cookie 为准。
 * 页面刷新时通过请求受保护接口来验证 Cookie 是否有效。
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      appMode: 'single',

      setAuth: (data) => {
        set({
          user: data.user,
          isAuthenticated: true,
        })
      },

      clearAuth: () => {
        set({ user: null, isAuthenticated: false })
      },

      setAppMode: (mode) => set({ appMode: mode }),

      hasRole: (code) => {
        const { user } = get()
        return user?.roles?.some((r) => r.code === code) || false
      },

      hasAnyRole: (codes) => {
        const { user } = get()
        return user?.roles?.some((r) => codes.includes(r.code)) || false
      },
    }),
    {
      name: 'aikb-auth',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        appMode: state.appMode,
      }),
    },
  ),
)
