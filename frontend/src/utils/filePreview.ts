export type PreviewType = 'image' | 'pdf' | 'text' | 'markdown' | 'office' | 'unsupported'

const IMAGE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp', 'image/tiff',
])

// Office 文件：由后端 LibreOffice 转 PDF 后高保真预览（含 doc/docx/xls/xlsx/ppt/pptx 等）
const OFFICE_EXTENSIONS = new Set([
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp', '.rtf',
])

const TEXT_TYPES = new Set([
  'text/plain', 'text/csv', 'text/html', 'text/css', 'text/javascript',
  'application/json', 'application/xml', 'text/xml', 'text/x-python',
  'text/x-typescript', 'text/x-java', 'text/x-c', 'text/x-shellscript',
])

const CODE_EXTENSIONS: Record<string, string> = {
  '.js': 'javascript', '.ts': 'typescript', '.tsx': 'typescript', '.jsx': 'javascript',
  '.py': 'python', '.java': 'java', '.c': 'c', '.cpp': 'cpp', '.h': 'c',
  '.cs': 'csharp', '.go': 'go', '.rs': 'rust', '.rb': 'ruby', '.php': 'php',
  '.swift': 'swift', '.kt': 'kotlin', '.sh': 'bash', '.sql': 'sql',
  '.json': 'json', '.xml': 'xml', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
  '.css': 'css', '.html': 'html', '.md': 'markdown',
}

export function canPreview(mimeType?: string): boolean {
  if (!mimeType) return false
  return getPreviewType(mimeType) !== 'unsupported'
}

export function getPreviewType(mimeType: string): PreviewType {
  if (IMAGE_TYPES.has(mimeType)) return 'image'
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType === 'text/markdown' || mimeType === 'text/x-markdown') return 'markdown'
  if (TEXT_TYPES.has(mimeType) || mimeType.startsWith('text/')) return 'text'
  return 'unsupported'
}

export function getPreviewTypeFromFileName(fileName: string): PreviewType {
  const ext = fileName.includes('.') ? '.' + fileName.split('.').pop()?.toLowerCase() : ''
  if (!ext) return 'unsupported'
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.tiff'].includes(ext)) return 'image'
  if (ext === '.pdf') return 'pdf'
  if (ext === '.md') return 'markdown'
  if (OFFICE_EXTENSIONS.has(ext)) return 'office'
  if (ext in CODE_EXTENSIONS || ['.txt', '.csv', '.log', '.ini', '.cfg', '.env', '.gitignore'].includes(ext)) return 'text'
  return 'unsupported'
}

export function getPreviewTypeFromFileNameOrMime(fileName: string, mimeType?: string): PreviewType {
  if (mimeType) {
    const fromMime = getPreviewType(mimeType)
    if (fromMime !== 'unsupported') return fromMime
  }
  return getPreviewTypeFromFileName(fileName)
}

export function formatFileSize(bytes?: number): string {
  if (!bytes) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
