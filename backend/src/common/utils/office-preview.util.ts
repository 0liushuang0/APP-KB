import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Logger } from '@nestjs/common';

const execFileAsync = promisify(execFile);
const logger = new Logger('OfficePreview');

/**
 * LibreOffice 转 PDF 工具。
 *
 * 用于把 Office 文档（doc/docx/xls/xlsx/ppt/pptx/odt/ods/odp 等）转成 PDF，
 * 供前端在 <iframe> 里高保真预览（浏览器原生渲染 PDF）。
 *
 * 设计要点：
 *   · 可用性检测：只查文件是否存在，**绝不执行** soffice 去探测（见 resolveSoffice 注释）
 *   · Windows 上用 soffice.com 而非 soffice.exe（见 pickExecutable 注释）
 *   · 缓存：同一文件（路径 + 大小 + mtime）只转一次，结果存 .preview 目录
 *   · 互斥：LibreOffice 同一 user profile 并发转换会冲突（"already running"），
 *     用全局串行锁 + 每次转换独立的 UserInstallation 隔离
 *   · 超时：大 PPT（几十 MB）转换很慢，默认 180s，可用 OFFICE_PREVIEW_TIMEOUT_MS 调
 */

const CONVERSION_TIMEOUT_MS = Number(process.env.OFFICE_PREVIEW_TIMEOUT_MS) || 180_000;
const PREVIEW_DIRNAME = '.preview';
/** 探测不到时的负缓存时长：装完 LibreOffice 不必重启后端 */
const NEGATIVE_CACHE_MS = 60_000;

/**
 * soffice 可执行文件候选路径。
 *
 * Windows 放 soffice.com 在前：soffice.exe 是 GUI 启动器，命令行调用它转换时
 * 会立刻返回（甚至不返回），转换还没做完我们就去找 PDF，必然报"转换后未找到输出"；
 * soffice.com 是控制台包装器，会一直等到转换结束才退出。
 */
function candidateSofficePaths(): string[] {
  const candidates: string[] = [];

  // 装在非标准位置时，用环境变量指定（可给可执行文件，也可给 program 目录）
  const configured = process.env.LIBREOFFICE_PATH?.trim();
  if (configured) {
    candidates.push(configured);
    for (const name of executableNames()) {
      candidates.push(path.join(configured, name));
      candidates.push(path.join(configured, 'program', name));
    }
  }

  if (process.platform === 'win32') {
    for (const root of [
      'C:\\Program Files\\LibreOffice\\program',
      'C:\\Program Files (x86)\\LibreOffice\\program',
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'LibreOffice', 'program'),
    ]) {
      if (!root) continue;
      candidates.push(path.join(root, 'soffice.com'), path.join(root, 'soffice.exe'));
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/LibreOffice.app/Contents/MacOS/soffice');
    candidates.push('/opt/homebrew/bin/soffice', '/usr/local/bin/soffice');
  } else {
    candidates.push(
      '/usr/bin/soffice',
      '/usr/bin/libreoffice',
      '/usr/lib/libreoffice/program/soffice',
      '/snap/bin/libreoffice',
      '/opt/libreoffice/program/soffice',
    );
  }

  // 最后再扫 PATH（同样只做存在性判断，不执行）
  candidates.push(...scanPathDirs());
  return candidates;
}

function executableNames(): string[] {
  return process.platform === 'win32'
    ? ['soffice.com', 'soffice.exe']
    : ['soffice', 'libreoffice'];
}

function scanPathDirs(): string[] {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const found: string[] = [];
  for (const dir of dirs) {
    for (const name of executableNames()) {
      found.push(path.join(dir, name));
    }
  }
  return found;
}

let _sofficePath: string | null = null;
let _probedAt = 0;

/**
 * 探测 LibreOffice 是否安装，返回可用的 soffice 路径或 null。
 *
 * 这里刻意**不**执行 `soffice --version` 去探测：Windows 上 soffice.exe 加 --version
 * 根本不会退出（实测挂死到超时），于是"已经装好的 LibreOffice"被判定成没装，
 * 预览直接返回 503「服务器未安装 LibreOffice」。存在性检查既准又不会卡。
 */
async function resolveSoffice(): Promise<string | null> {
  // 找到过就一直用；没找到则每 60s 重探一次（用户中途装上不用重启后端）
  if (_sofficePath) return _sofficePath;
  if (_probedAt && Date.now() - _probedAt < NEGATIVE_CACHE_MS) return null;
  _probedAt = Date.now();

  for (const candidate of candidateSofficePaths()) {
    try {
      if (!fs.existsSync(candidate)) continue;
      if (!fs.statSync(candidate).isFile()) continue;
    } catch {
      continue;
    }
    _sofficePath = candidate;
    logger.log(`LibreOffice detected: ${candidate}`);
    return candidate;
  }

  logger.warn(
    'LibreOffice (soffice) 未找到，Office 文档预览不可用。' +
      '安装后即可自动生效；装在非标准目录时用 LIBREOFFICE_PATH 指定。',
  );
  return null;
}

/** 串行锁：LibreOffice 并发转换不可靠，排队执行 */
let _chain: Promise<unknown> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = _chain.then(task, task);
  // 失败不影响后续任务排队
  _chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** 计算源文件的缓存键：路径规范化 + 大小 + mtime，源文件改动后自动失效 */
function cacheKey(srcPath: string): string {
  const stat = fs.statSync(srcPath);
  const id = `${path.resolve(srcPath)}|${stat.size}|${stat.mtimeMs}`;
  return crypto.createHash('sha1').update(id).digest('hex');
}

/** soffice.com 偶尔在进程退出后才刷完输出文件，给一小段时间等它落盘 */
async function waitForFile(filePath: string, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return fs.existsSync(filePath);
}

/**
 * 把 Office 文档转成 PDF。
 *
 * @param srcPath 源文件绝对路径（已确认存在）
 * @param uploadsRoot 上传根目录（用于在其下建 .preview 缓存目录）
 * @returns 转换后的 PDF 绝对路径；若 LibreOffice 未安装抛出 OfficePreviewUnavailableError
 */
export async function convertOfficeToPdf(
  srcPath: string,
  uploadsRoot: string,
): Promise<{ pdfPath: string; cached: boolean }> {
  const soffice = await resolveSoffice();
  if (!soffice) {
    throw new OfficePreviewUnavailableError(
      '服务器未安装 LibreOffice，无法在线预览 Office 文档，请下载后查看',
    );
  }

  const previewDir = path.join(uploadsRoot, PREVIEW_DIRNAME);
  if (!fs.existsSync(previewDir)) fs.mkdirSync(previewDir, { recursive: true });

  const key = cacheKey(srcPath);
  const pdfPath = path.join(previewDir, `${key}.pdf`);

  // 命中缓存：源文件未变，直接复用
  if (fs.existsSync(pdfPath)) {
    return { pdfPath, cached: true };
  }

  // 串行执行转换（LibreOffice 并发不可靠）
  await serialize(async () => {
    // 排队期间可能已被别的请求转好
    if (fs.existsSync(pdfPath)) return;

    // 每次转换用独立的 user installation，避免 "another instance running" 冲突
    const profileDir = path.join(previewDir, `profile-${key}`);
    const profileUrl = `file:///${profileDir.replace(/\\/g, '/')}`;
    // -env: 必须排在最前面，放到文档路径后面 LibreOffice 会当成要打开的文件
    const args = [
      `-env:UserInstallation=${profileUrl}`,
      '--headless',
      '--norestore',
      '--nolockcheck',
      '--nodefault',
      '--nofirststartwizard',
      '--convert-to',
      'pdf',
      '--outdir',
      previewDir,
      srcPath,
    ];

    try {
      try {
        await execFileAsync(soffice, args, {
          timeout: CONVERSION_TIMEOUT_MS,
          windowsHide: true,
          maxBuffer: 10 * 1024 * 1024,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // 转换失败也清掉 soffice 可能写出的半成品 PDF，免得同名文件下次命中残留
        const stale = path.join(previewDir, `${path.basename(srcPath, path.extname(srcPath))}.pdf`);
        try { fs.rmSync(stale, { force: true }); } catch { /* 忽略 */ }
        throw new Error(`LibreOffice 转换失败：${msg}`);
      }

      // soffice 输出文件名 = 源文件名去扩展名 + .pdf，落在 outdir
      const generated = path.join(previewDir, `${path.basename(srcPath, path.extname(srcPath))}.pdf`);
      if (await waitForFile(generated)) {
        if (generated !== pdfPath) fs.renameSync(generated, pdfPath);
      }
    } finally {
      // 无论成功失败都清理独立 profile 目录。
      // 此前 catch 直接 re-throw 会跳过清理 → profileDir 泄漏、同名文件命中残留半成品 PDF。
      try {
        fs.rmSync(profileDir, { recursive: true, force: true });
      } catch {
        /* 忽略 */
      }
    }
  });

  if (!fs.existsSync(pdfPath)) {
    throw new Error('LibreOffice 转换后未找到 PDF 输出，文件可能已损坏');
  }
  return { pdfPath, cached: false };
}

/** LibreOffice 未安装的专用错误，便于上层区分 */
export class OfficePreviewUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfficePreviewUnavailableError';
  }
}

/** 外部可调用的可用性检测（如健康检查） */
export async function isOfficePreviewAvailable(): Promise<boolean> {
  return (await resolveSoffice()) !== null;
}
