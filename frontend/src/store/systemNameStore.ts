import { create } from 'zustand'
import { systemApi } from '../api/services'

interface SystemNameState {
  name: string
  /** 副标题（logo 下面那行小字），同样可配 */
  subtitle: string
  adminTitle: string
  loaded: boolean
  fetchName: () => Promise<void>
  setName: (name: string) => void
  setAdminTitle: (title: string) => void
  setSubtitle: (v: string) => void
}

const DEFAULT_NAME = 'BOYA 智能知识中心'
const DEFAULT_SUBTITLE = 'CUSTOMER RESPONSE COPILOT'

export const useSystemNameStore = create<SystemNameState>((set) => ({
  name: DEFAULT_NAME,
  subtitle: DEFAULT_SUBTITLE,
  adminTitle: '',
  loaded: false,

  fetchName: async () => {
    try {
      // 系统名/管理员头衔/副标题都从公开的 /system/info 一次拿回。
      // 未登录时不能调 /system-configs/*：受保护接口返回 401 会触发
      // 拦截器 redirectToLogin 整页刷新，登录页会陷入无限刷新闪烁。
      const info = await systemApi.info()
      const name = info?.name || DEFAULT_NAME
      set({
        name,
        adminTitle: info?.adminTitle || '',
        subtitle: info?.subtitle || DEFAULT_SUBTITLE,
        loaded: true,
      })
      document.title = name
    } catch {
      set({ loaded: true })
    }
  },

  setName: (name: string) => {
    set({ name })
    document.title = name
  },

  setAdminTitle: (title: string) => {
    set({ adminTitle: title })
  },

  setSubtitle: (v: string) => {
    set({ subtitle: v })
  },
}))
