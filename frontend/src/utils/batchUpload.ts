/**
 * 批量上传的并发控制。
 *
 * 为什么需要：原来多文件上传是这么写的 ——
 *     for (const f of files) documentApi.upload(fd)   // 没有 await
 * 二十张照片就是二十个 multipart 请求同时打出去，后果有两个：
 *
 *   1. 撞限流。后端 ThrottlerGuard 是 50 次 / 10 秒，而每次上传成功后
 *      前端还会 invalidate 两个查询（列表 + 分类计数），等于每传一个文件
 *      产生三次请求。二十个文件瞬间六十次，必然超。用户看到的就是
 *      「操作过于频繁，请稍后再试」。
 *   2. 并发写。后端是 SQLite，二十个请求同时写文件 + 插记录，
 *      容易撞上 SQLITE_BUSY，表现为 500。
 *
 * 所以这里限并发（默认 2），并把"刷新列表"留给调用方在**全部结束后**做一次。
 */

export interface BatchUploadResult<T> {
  /** 成功的条目 */
  succeeded: T[]
  /** 失败的条目及原因 */
  failed: { item: T; error: unknown }[]
}

/**
 * 以受限并发依次执行任务。
 *
 * @param items    待处理条目
 * @param worker   单个条目的处理函数
 * @param opts.concurrency 同时进行的数量，默认 2
 * @param opts.onProgress  每完成一个回调一次（done, total），用于刷新进度提示
 */
export async function runWithConcurrency<T>(
  items: T[],
  worker: (item: T, index: number) => Promise<unknown>,
  opts: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<BatchUploadResult<T>> {
  const concurrency = Math.max(1, opts.concurrency ?? 2)
  const total = items.length
  const succeeded: T[] = []
  const failed: { item: T; error: unknown }[] = []

  let cursor = 0
  let done = 0

  const runOne = async (): Promise<void> => {
    // 取到没有下一个任务（index >= total）才 return，循环条件写不出来
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const index = cursor++
      if (index >= total) return
      const item = items[index]
      try {
        await worker(item, index)
        succeeded.push(item)
      } catch (error) {
        failed.push({ item, error })
      } finally {
        done++
        opts.onProgress?.(done, total)
      }
    }
  }

  // 起 concurrency 条"流水线"，各自不断取下一个，天然做到限并发且不留空转
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, runOne))

  return { succeeded, failed }
}

/** 从后端错误里取出可读信息 */
export function uploadErrorMessage(error: any): string {
  if (error?.response?.status === 429) return '请求过于频繁'
  return error?.response?.data?.message || error?.message || '上传失败'
}
