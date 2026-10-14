import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'
import './zh-shell.css'

import ToastProvider from './components/ToastProvider'
import ErrorBoundary from './components/ErrorBoundary'
import { installGlobalErrorHandlers } from './api/errorReport'
import { installChunkRecovery } from './api/chunkRecovery'

/**
 * 缓存分级：字典类数据（参数模板、供应商品类、用户/部门下拉）几乎不变，
 * 列表数据变动中等，详情要保证打开即最新。
 * 统一给 30s 兜底，需要更长的在各自 useQuery 里覆盖 staleTime。
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      // 缓存保留 5 分钟，页面来回切换不重复请求
      gcTime: 5 * 60_000,
    },
    mutations: {
      retry: 0,
    },
  },
})

// 发版后旧页面加载不到新文件: 自动刷新一次(须先于错误上报安装, 才能拦在它前面)
installChunkRecovery()
// 事件回调与异步任务里的异常，错误边界捕获不到，靠全局兜底
installGlobalErrorHandlers()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ErrorBoundary scope="root">
          <App />
        </ErrorBoundary>
        <ToastProvider />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
