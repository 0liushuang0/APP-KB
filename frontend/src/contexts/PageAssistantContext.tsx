import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export interface PageAssistantInfo {
  /** 页面标识，用于会话存储与预设问题 */
  key: string
  /** 页面中文名，显示在助手标题上 */
  label: string
  /** 检索范围（对应向量库 source_type）；不传则全库 */
  sourceTypes?: string[]
  /** 预设问题，建议 5 条 */
  questions?: string[]
  /**
   * 当前页面内容的文字快照。
   * 注意只放用户此刻看得见的信息（筛选条件、本页列表、选中记录），
   * 太长会挤掉检索结果，建议控制在 4000 字以内。
   */
  context?: string
}

interface Ctx {
  info: PageAssistantInfo | null
  register: (info: PageAssistantInfo | null) => void
}

const PageAssistantCtx = createContext<Ctx>({ info: null, register: () => {} })

export function PageAssistantProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<PageAssistantInfo | null>(null)
  const value = useMemo(() => ({ info, register: setInfo }), [info])
  return <PageAssistantCtx.Provider value={value}>{children}</PageAssistantCtx.Provider>
}

export function usePageAssistantInfo() {
  return useContext(PageAssistantCtx).info
}

/**
 * 页面注册自己的 AI 上下文。
 *
 * 这样悬浮助手不必认识每个页面，页面也不必各自挂一个组件 ——
 * 助手统一在 Layout 里渲染，页面只负责说清"我这儿有什么"。
 *
 * context 变化频繁（筛选、翻页、选中都会变），所以按内容做浅比较，
 * 避免每次渲染都触发一次全局状态更新。
 */
export function useRegisterPageAssistant(info: PageAssistantInfo | null) {
  const { register } = useContext(PageAssistantCtx)
  const serialized = info ? `${info.key}|${info.label}|${info.context || ''}` : ''
  const lastRef = useRef<string>('')

  useEffect(() => {
    if (lastRef.current === serialized) return
    lastRef.current = serialized
    register(info)
     
  }, [serialized])

  // 离开页面时清空，避免把上一页的内容带到下一页
  useEffect(() => {
    return () => {
      lastRef.current = ''
      register(null)
    }
     
  }, [])
}
