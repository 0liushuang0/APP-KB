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

/** 常见字段的中文名(其余字段原样显示) */
const FIELD_LABELS: Record<string, string> = {
  name: '名称', code: '简称/编号', customerCode: '客户编号', industry: '所属行业', scale: '企业规模', level: '客户等级',
  businessStatus: '业务状态', customerType: '客户类型', region: '所属区域', address: '注册地址', creditCode: '统一社会信用代码',
  website: '企业网址', description: '简介', salesPerson: '负责销售', firstCooperationDate: '首次合作日期', visibility: '可见性',
  email: '官方邮箱', phone: '官方电话', postalCode: '邮编', title: '标题', category: '分类', status: '状态',
  price: '价格', unit: '单位', content: '内容', remark: '备注',
}

/** class-validator 的英文提示 → 中文, 并带上是哪一栏 */
export function humanizeValidation(message: string): string {
  return message
    .split(/;\s*/)
    .map((part) => {
      const label = (f: string) => `「${FIELD_LABELS[f] || f}」`
      let m: RegExpMatchArray | null
      if ((m = part.match(/property (\w+) should not exist/))) {
        return `${label(m[1])}不是可提交的字段（程序问题，不是输入有误，请联系管理员）`
      }
      if ((m = part.match(/^(\w+) should not be empty/))) return `请填写${label(m[1])}`
      if ((m = part.match(/^(\w+) must be an email/))) return `${label(m[1])}格式不正确，请检查是否有空格、中文符号或缺少 @`
      if ((m = part.match(/^(\w+) must be shorter than or equal to (\d+) characters/))) return `${label(m[1])}最多 ${m[2]} 个字符`
      if ((m = part.match(/^(\w+) must be longer than or equal to (\d+) characters/))) return `${label(m[1])}至少 ${m[2]} 个字符`
      if ((m = part.match(/^(\w+) must be a string/))) return `${label(m[1])}内容格式不对`
      if ((m = part.match(/^(\w+) must be a number/))) return `${label(m[1])}需要填写数字`
      if ((m = part.match(/^(\w+) must be a valid ISO 8601 date string/))) return `${label(m[1])}日期格式不正确`
      if ((m = part.match(/^(\w+) must match/))) return `${label(m[1])}格式不正确，请检查是否有空格或多余字符`
      if ((m = part.match(/^(\w+) must be one of the following values/))) return `${label(m[1])}的取值不在允许范围内`
      return part
    })
    .join('；')
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

    // 后端校验信息是英文属性名(「property status should not exist」), 翻成用户看得懂、知道改哪一栏的话;
    // 回写到 response 里, 页面自己的 catch 读到的也是同一句
    if (error.response?.data && status === 400) {
      const raw = error.response.data.message
      if (typeof raw === 'string') error.response.data.message = humanizeValidation(raw)
      else if (Array.isArray(raw)) error.response.data.message = raw.map((m: string) => humanizeValidation(m))
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
