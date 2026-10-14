/**
 * documents.parsedText 里存的到底是不是正文。
 *
 * 这一列有三种内容：
 *  1. 真正解析出的正文；
 *  2. 解析失败时的占位话术「[xxx.pptx] 文件已上传，等待解析。」（二三十字）；
 *  3. 索引状态标记 JSON，如 {"indexed":false,"chunks":0,"reason":"no_text",...}。
 * 原来上传入库和重建索引各写了一份判断，只挡了 1/2 两种 —— 状态标记 JSON
 * 有六七十字，过了长度阈值，被当成正文推给 AI 服务，全靠对面再挡一次。
 */
export function parseStatusMarker(parsedText?: string | null): Record<string, any> | null {
  const t = (parsedText || '').trim();
  if (!t.startsWith('{') || !t.includes('"indexed"')) return null;
  try {
    const v = JSON.parse(t);
    return v && typeof v === 'object' && 'indexed' in v ? v : null;
  } catch {
    return null;
  }
}

export function isParsePlaceholder(parsedText?: string | null): boolean {
  const t = (parsedText || '').trim();
  return t.length <= 50 || /等待解析|文件已上传/.test(t.slice(0, 80));
}

export function hasRealParsedText(parsedText?: string | null): boolean {
  return !isParsePlaceholder(parsedText) && !parseStatusMarker(parsedText);
}
