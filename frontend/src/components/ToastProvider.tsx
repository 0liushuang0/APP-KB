import { Toaster } from 'sonner'

/**
 * 全局 toast 容器。
 *
 * 原来 3 秒一闪而过，错误类（常带后端返回的具体原因）用户读不完。
 * sonner 2.x 不支持按类型设 duration，这里统一拉到 5 秒并保留
 * closeButton —— 成功提示 5 秒可接受，错误文案也读得完。
 */
export default function ToastProvider() {
  return (
    <Toaster
      position="top-right"
      richColors
      closeButton
      expand={false}
      duration={5000}
    />
  )
}
