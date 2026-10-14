/* eslint-disable @typescript-eslint/no-var-requires */
const archiver = require('archiver');
const unzipper = require('unzipper');

/**
 * 给 Office 文档（docx / pptx / xlsx）「瘦身」：去掉图片、视频、嵌入对象，只留文字所在的 XML。
 *
 * 博亚的产品推介 PPT 一份 20~80MB，几乎全是图片；正文只有几十 KB。
 * 原来超过 10MB 就整份放弃解析（防 Node 堆被 base64 撑爆），
 * 于是最有价值的那批产品介绍资料全都「无正文」、AI 问答里搜不到。
 * 解析文字根本用不到图片 —— 从磁盘按条目读 zip，把 media/embeddings 清空，
 * 打出来的新包通常不到 1MB，再交给 AI 服务解析。
 */
export const OFFICE_ZIP_EXTS = ['.docx', '.pptx', '.xlsx'];

const DROP = /(^|\/)(media|embeddings)\/|\.(png|jpe?g|gif|bmp|tiff?|emf|wmf|svg|mp4|wmv|avi|mov|mp3|wav|m4a|bin|ole)$/i;

export function isDroppableOfficePart(entryPath: string): boolean {
  return DROP.test(entryPath);
}

export async function slimOfficeFile(filePath: string): Promise<Buffer> {
  const dir = await unzipper.Open.file(filePath);
  const archive = archiver('zip', { zlib: { level: 6 } });
  const out: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    archive.on('data', (b: Buffer) => out.push(b));
    archive.on('end', () => resolve(Buffer.concat(out)));
    archive.on('error', reject);
  });
  for (const f of dir.files) {
    if (f.type !== 'File') continue;
    // 条目保留、内容清空：关系文件里还引用着这些部件，删掉的话 python-docx/pptx 打开时会 KeyError
    archive.append(isDroppableOfficePart(f.path) ? Buffer.alloc(0) : await f.buffer(), { name: f.path });
  }
  await archive.finalize();
  return done;
}
