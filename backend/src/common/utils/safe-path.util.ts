import { BadRequestException } from '@nestjs/common';
import * as path from 'path';

/**
 * 上传文件名与落盘路径的安全处理。
 *
 * 背景：上传接口拿到的 `file.originalname` 完全由客户端控制。
 * 曾经的写法 `path.join(uploadDir, Date.now() + '_' + originalname)`
 * 在 originalname 为 `../../../../Windows/Temp/evil.pdf` 时会把文件写到上传目录之外
 * —— 扩展名白名单挡不住，因为载荷本身就是合法后缀结尾。
 *
 * 这里做两道防线：
 *   1. 生成文件名时剥离所有路径成分与危险字符
 *   2. 落盘前再断言最终路径确实位于上传目录内（防御任何遗漏的构造方式）
 */

/** 允许出现在文件名里的字符：中英文、数字、下划线、连字符、点、空格 */
const SAFE_NAME = /[^\w.\-一-龥 ]/g;

/** Windows 保留设备名，用作文件名会导致异常行为 */
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;

const MAX_NAME_LENGTH = 120;

/**
 * 把客户端文件名清洗成可安全落盘的名字。
 * 只保留 basename，去掉盘符、目录分隔符、`..` 等一切路径语义。
 */
export function sanitizeFileName(originalName: string): string {
  if (!originalName) return 'unnamed';

  // 先按两种分隔符取最后一段：path.basename 在 Linux 上不认 `\`，
  // 而攻击者可能用 Windows 分隔符构造，所以两种都要处理
  let name = originalName.split(/[/\\]/).pop() || '';

  // 去掉控制字符与非白名单字符
  name = name.replace(/[\u0000-\u001f\u007f]/g, '').replace(SAFE_NAME, '_');

  // 清掉开头的点，避免生成隐藏文件或残留的 `..`
  name = name.replace(/^\.+/, '');

  name = name.trim();
  if (!name || RESERVED.test(name)) name = `file_${name || 'unnamed'}`;

  // 过长文件名在部分文件系统会失败；保留扩展名，截断主干
  if (name.length > MAX_NAME_LENGTH) {
    const ext = path.extname(name).slice(0, 16);
    name = name.slice(0, MAX_NAME_LENGTH - ext.length) + ext;
  }

  return name;
}

/**
 * 生成带时间戳前缀的唯一落盘文件名。
 * 时间戳放在最前，保证同名文件不互相覆盖。
 */
export function buildStoredFileName(originalName: string): string {
  return `${Date.now()}_${sanitizeFileName(originalName)}`;
}

/**
 * 拼接并校验落盘路径。
 * 即使传入的 fileName 仍含路径语义，这里也会拦下。
 */
export function resolveInsideDir(baseDir: string, fileName: string): string {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, fileName);

  // 必须严格位于 base 之下；相等也不行（那意味着 fileName 解析成了空）
  if (target === base || !target.startsWith(base + path.sep)) {
    throw new BadRequestException('非法的文件名');
  }
  return target;
}

/**
 * multer 在部分客户端下会把 UTF-8 文件名按 Latin1 解出来，中文变乱码。
 * 判断依据：解码后包含常见中文区间且原串全是 Latin1 可打印字符。
 */
export function fixMulterEncoding(originalName: string): string {
  if (!originalName) return originalName;
  // 已经是正常中文就不动
  if (/[一-龥]/.test(originalName)) return originalName;
  // 原串必须全是 Latin1 范围且含高位字符, 才可能是「UTF-8 字节被当 Latin1 读」
  // (只有全角标点的文件名, 如「roll）2026」→「rollï¼2026」, 解出来没有汉字, 也要还原)
  if (!/[\u0080-\u00ff]/.test(originalName) || /[^\u0000-\u00ff]/.test(originalName)) return originalName;
  try {
    const decoded = Buffer.from(originalName, 'latin1').toString('utf8');
    // 解码后出现替换符说明它本来就不是 UTF-8 字节, 保持原样
    return decoded.includes('\uFFFD') ? originalName : decoded;
  } catch {
    return originalName;
  }
}

/** 各业务允许上传的扩展名 */
export const ALLOWED_EXTENSIONS = {
  /**
   * 文档中心。
   *
   * 这里不能只放"能被解析入知识库的格式" —— 资料库同时承担归档职责：
   * 现场照片、设备铭牌、CAD 图纸都是要随业务资料一起存的。系统别处早就
   * 按这个前提做了（列表页有「图片」「CAD」两个格式筛选项、FilePreview
   * 支持图片内嵌预览、前端拖拽区的 accept 也列了这些后缀），
   * 唯独这道上传闸口没放行，于是选了图片就被挡在门外。
   *
   * 解析不了的格式不会污染知识库：processDocument 里对图片直接跳过 AI 解析，
   * 其余解析不出正文的（如 .dwg）会被 hasRealParsedText 拦下不建索引。
   */
  document: [
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.md', '.csv',
    '.dwg', '.dxf', '.xdf', '.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp', '.zip', '.rar', '.7z',
  ],
  /** 需求附件：客户来料，额外允许图纸与图片（xdf=稻壳阅读器格式） */
  requirement: [
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.md', '.csv',
    '.dwg', '.dxf', '.xdf', '.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp', '.zip', '.rar', '.7z',
  ],
  /** 产品附件：同需求 */
  product: [
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.md',
    '.dwg', '.dxf', '.png', '.jpg', '.jpeg', '.bmp', '.webp', '.zip',
  ],
} as const;

export type UploadKind = keyof typeof ALLOWED_EXTENSIONS;

/**
 * 扩展名白名单校验。
 * 注意这只是第一道门 —— 它挡不住路径穿越（载荷也可以 .pdf 结尾），
 * 真正的越界防护在 resolveInsideDir。
 */
export function validateExtension(originalName: string, kind: UploadKind): void {
  const allowed = ALLOWED_EXTENSIONS[kind] as readonly string[];
  const ext = path.extname(sanitizeFileName(originalName)).toLowerCase();
  if (!ext) throw new BadRequestException('文件缺少扩展名');
  if (!allowed.includes(ext)) {
    throw new BadRequestException(
      `不支持的文件类型 ${ext}，仅支持：${allowed.join('、')}`,
    );
  }
}

/**
 * 上传落盘的一站式入口：修正编码 → 校验扩展名 → 清洗 → 拼接 → 校验越界。
 * 返回原始展示名、存储用文件名与经过校验的绝对路径。
 */
export function safeUploadTarget(
  baseDir: string,
  originalName: string,
  kind?: UploadKind,
): { displayName: string; fileName: string; filePath: string } {
  const displayName = fixMulterEncoding(originalName);
  if (kind) validateExtension(displayName, kind);
  const fileName = buildStoredFileName(displayName);
  return { displayName, fileName, filePath: resolveInsideDir(baseDir, fileName) };
}

/**
 * 读取已存文件时的路径还原（fileKey 也可能被篡改，同样要校验）。
 * @param prefix 形如 `documents/`，存储时加在 fileKey 前的逻辑前缀
 */
export function safeReadPath(baseDir: string, fileKey: string, prefix?: string): string {
  const bare = prefix ? fileKey.replace(new RegExp(`^${prefix}`), '') : fileKey;
  return resolveInsideDir(baseDir, sanitizeFileName(bare));
}

/**
 * documents 表里的 fileKey 落到哪个物理路径。
 *
 * 同一张表存了三种东西，前缀不同、目录也不同：
 *   · `documents/{文件名}`            → uploads/documents（业务资料，平铺）
 *   · `knowledge/{分类目录}/{文件名}`  → uploads/knowledge（知识资料，带一层中文子目录）
 *   · `versions/{文件名}`             → uploads/versions（历史版本）
 *
 * 之前下载/预览接口一律按 `documents/` 前缀解析，知识资料的 fileKey 被
 * sanitizeFileName 削成纯文件名后指向 uploads/documents，永远找不到文件 ——
 * 表现就是知识资料点预览报错、点下载拿不到东西。解析规则只此一处，避免再次跑偏。
 */
export function resolveDocumentFilePath(uploadsBase: string, fileKey: string): string {
  if (!fileKey) throw new BadRequestException('文件标识为空');

  // 知识资料带中文子目录，不能用 sanitizeFileName（它会把目录层级吃掉），
  // 越界防护交给 resolveInsideDir 逐段校验后的最终路径断言
  if (fileKey.startsWith('knowledge/')) {
    const rest = fileKey.replace(/^knowledge\//, '');
    return resolveInsideDir(path.join(uploadsBase, 'knowledge'), rest);
  }
  if (fileKey.startsWith('versions/')) {
    return safeReadPath(path.join(uploadsBase, 'versions'), fileKey, 'versions/');
  }
  return safeReadPath(path.join(uploadsBase, 'documents'), fileKey, 'documents/');
}
