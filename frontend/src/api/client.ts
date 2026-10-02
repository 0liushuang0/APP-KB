import axios, { AxiosRequestConfig } from 'axios'
import { toast } from 'sonner'

/**
 * 扩展 axios 配置，增加自定义的 __retry 标记字段，
 * 避免在代码里用 `as any` 访问它。
 */
declare module 'axios' {
  export interface AxiosRequestConfig {
    __retry?: boolean
  }
}

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 30000,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
})

/**
 * 刷新令牌互斥锁。
 *
 * 问题：多个并行请求同时收到 401，各自触发 /auth/refresh。
 * 第一个 refresh 成功后 rotate 了 refreshToken，后续 refresh 用旧 token → 全部失败 → 跳转登录。
 *
 * 解决：同一时刻只允许一个 refresh 请求，其他请求等待同一个 Promise。
 */
let refreshPromise: Promise<boolean> | null = null

async function doRefresh(): Promise<boolean> {
  try {
    // 用独立的 axios 实例走 refresh，避免触发自身拦截器形成循环
    const res = await axios.post<{ data?: { accessToken?: string }; accessToken?: string }>(
      `${import.meta.env.VITE_API_BASE_URL || '/api'}/auth/refresh`,
      {},
      { withCredentials: true },
    )
    return !!(res.data?.data?.accessToken || res.data?.accessToken)
  } catch {
    return false
  }
}

/** 防止多个并发 401 同时触发跳转 */
let isRedirecting = false

function redirectToLogin() {
  // 已在登录页时直接返回：登录流程自身的 401（密码错误、自动登录失败等）
  // 由页面自行提示，这里再整页跳转只会让登录页反复刷新自己，形成闪烁死循环
  if (window.location.pathname === '/login') return
  if (isRedirecting) return
  isRedirecting = true
  // 清除 zustand persist 的认证状态
  localStorage.removeItem('aikb-auth')
  // 记录这次强制退出，登录页不再自动登录，避免“退出→自动登录”死循环闪烁
  sessionStorage.setItem('aikb-skip-auto-login', '1')
  // 用 setTimeout 确保 localStorage 写入完成后再跳转
  setTimeout(() => {
    window.location.href = '/login'
  }, 50)
}

apiClient.interceptors.response.use(
  (response) => response.data,
  async (error) => {
    const status = error.response?.status
    const originalRequest = error.config as AxiosRequestConfig | undefined

    // 网络层错误（后端未启动、代理连不上等）
    if (!error.response) {
      toast.error('网络异常，无法连接服务器')
      return Promise.reject(error)
    }

    // 限流：不触发刷新，直接提示
    if (status === 429) {
      toast.error('操作过于频繁，请稍后再试')
      return Promise.reject(error)
    }

    if (status === 401 && originalRequest && !originalRequest.__retry) {
      originalRequest.__retry = true

      // 复用正在进行的 refresh，不重复发起
      if (!refreshPromise) {
        refreshPromise = doRefresh().finally(() => {
          refreshPromise = null
        })
      }

      const success = await refreshPromise
      if (success) {
        // refresh 成功，重试原请求（Cookie 已自动更新）
        return apiClient(originalRequest)
      } else {
        // refresh 失败，清除本地状态并跳转登录
        redirectToLogin()
      }
    } else if (status === 401) {
      redirectToLogin()
    }

    const message = error.response?.data?.message
    if (typeof message === 'string') {
      toast.error(message)
    } else if (Array.isArray(message)) {
      message.forEach((m: string) => toast.error(m))
    } else if (status >= 500) {
      toast.error('服务器错误，请稍后重试')
    }

    return Promise.reject(error)
  },
)

export default apiClient
