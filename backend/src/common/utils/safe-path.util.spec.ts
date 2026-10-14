import * as path from 'path';
import {
  sanitizeFileName,
  buildStoredFileName,
  resolveInsideDir,
  safeUploadTarget,
  safeReadPath,
  resolveDocumentFilePath,
  validateExtension,
  ALLOWED_EXTENSIONS,
} from './safe-path.util';

const UPLOAD_DIR = path.resolve('/srv/app/data/uploads/documents');
const UPLOADS_BASE = path.resolve('/srv/app/data/uploads');

describe('safe-path util', () => {
  describe('sanitizeFileName —— 剥离一切路径语义', () => {
    it.each([
      ['report.pdf', 'report.pdf'],
      ['技术协议-矫直机.docx', '技术协议-矫直机.docx'],
      ['BY-SJ-01 参数表.xlsx', 'BY-SJ-01 参数表.xlsx'],
    ])('正常文件名保持不变：%s', (input: string, expected: string) => {
      expect(sanitizeFileName(input)).toBe(expected);
    });

    it.each([
      ['../../../../Windows/Temp/evil.pdf', 'evil.pdf'],
      ['..\\..\\..\\evil.pdf', 'evil.pdf'],
      ['/etc/passwd', 'passwd'],
      ['C:\\Windows\\System32\\evil.exe', 'evil.exe'],
      ['....//....//evil.pdf', 'evil.pdf'],
    ])('剥离路径成分：%s → %s', (input: string, expected: string) => {
      expect(sanitizeFileName(input)).toBe(expected);
    });

    it('纯 .. 不会产生可回溯的名字', () => {
      // 开头的点被清掉后为空，回退到占位名，绝不能留下 '..'
      expect(sanitizeFileName('..')).not.toBe('..');
      expect(sanitizeFileName('...')).not.toContain('..');
    });

    it('去掉控制字符与特殊符号', () => {
      expect(sanitizeFileName('a\u0000b<>:"|?*.pdf')).not.toMatch(/[\u0000<>:"|?*]/);
    });

    it('Windows 保留设备名被改写', () => {
      expect(sanitizeFileName('CON')).not.toBe('CON');
      expect(sanitizeFileName('NUL.txt')).not.toBe('NUL.txt');
    });

    it('超长文件名被截断但保留扩展名', () => {
      const long = 'a'.repeat(500) + '.pdf';
      const out = sanitizeFileName(long);
      expect(out.length).toBeLessThanOrEqual(120);
      expect(out.endsWith('.pdf')).toBe(true);
    });

    it('空输入有兜底', () => {
      expect(sanitizeFileName('')).toBe('unnamed');
    });
  });

  describe('resolveInsideDir —— 越界即抛错', () => {
    it('正常文件名解析到目录内', () => {
      const p = resolveInsideDir(UPLOAD_DIR, 'report.pdf');
      expect(path.resolve(p).startsWith(UPLOAD_DIR + path.sep)).toBe(true);
    });

    it.each([
      '../evil.pdf',
      '../../evil.pdf',
      '..\\..\\evil.pdf',
      '/etc/passwd',
      '1785_../../../../Windows/Temp/evil.pdf', // 复现真实上传构造
    ])('拒绝越界路径：%s', (name: string) => {
      expect(() => resolveInsideDir(UPLOAD_DIR, name)).toThrow(/非法的文件名/);
    });

    it('解析结果等于 baseDir 本身也拒绝', () => {
      expect(() => resolveInsideDir(UPLOAD_DIR, '.')).toThrow();
    });
  });

  describe('safeUploadTarget —— 上传落盘一站式', () => {
    it('时间戳前缀 + 清洗后的名字', () => {
      const { fileName, filePath } = safeUploadTarget(UPLOAD_DIR, 'report.pdf');
      expect(fileName).toMatch(/^\d+_report\.pdf$/);
      expect(filePath.startsWith(UPLOAD_DIR + path.sep)).toBe(true);
    });

    it('攻击载荷落在目录内且失去路径语义 —— 修复前会写到 D:\\app\\data\\Windows\\Temp', () => {
      const { fileName, filePath } = safeUploadTarget(
        UPLOAD_DIR,
        '../../../../Windows/Temp/evil.pdf',
      );
      expect(fileName).toMatch(/^\d+_evil\.pdf$/);
      expect(fileName).not.toContain('..');
      expect(fileName).not.toContain('/');
      expect(fileName).not.toContain('\\');
      expect(filePath.startsWith(UPLOAD_DIR + path.sep)).toBe(true);
    });

    it('中文文件名可用（业务上大量存在）', () => {
      const { fileName } = safeUploadTarget(UPLOAD_DIR, '博亚-矫直机技术协议.pdf');
      expect(fileName).toContain('博亚-矫直机技术协议.pdf');
    });
  });

  describe('safeReadPath —— 读取时同样校验 fileKey', () => {
    it('去掉逻辑前缀后定位到文件', () => {
      const p = safeReadPath(UPLOAD_DIR, 'documents/1785_report.pdf', 'documents/');
      expect(p).toBe(path.join(UPLOAD_DIR, '1785_report.pdf'));
    });

    it('被篡改的 fileKey 无法越界读取', () => {
      // 数据库里的 fileKey 若被写入恶意值，读取时也不能穿越
      const p = safeReadPath(UPLOAD_DIR, 'documents/../../../etc/passwd', 'documents/');
      expect(p.startsWith(UPLOAD_DIR + path.sep)).toBe(true);
      expect(p).not.toContain('etc');
    });
  });

  describe('resolveDocumentFilePath —— documents 表三种前缀各自的落盘目录', () => {
    it('业务资料落在 uploads/documents', () => {
      expect(resolveDocumentFilePath(UPLOADS_BASE, 'documents/1785_report.pdf')).toBe(
        path.join(UPLOADS_BASE, 'documents', '1785_report.pdf'),
      );
    });

    /*
     * 这条是本次修复的回归点：知识资料的 fileKey 带一层中文子目录，
     * 之前一律按 documents/ 前缀解析，子目录被削掉后指向 uploads/documents，
     * 文件永远找不到 —— 页面上表现为知识资料点预览/下载失败。
     */
    it('知识资料保留中文子目录，落在 uploads/knowledge', () => {
      expect(resolveDocumentFilePath(UPLOADS_BASE, 'knowledge/产品样本/1786_宝钢冷轧产品.pdf')).toBe(
        path.join(UPLOADS_BASE, 'knowledge', '产品样本', '1786_宝钢冷轧产品.pdf'),
      );
    });

    it('历史版本落在 uploads/versions', () => {
      expect(resolveDocumentFilePath(UPLOADS_BASE, 'versions/1785_v2.docx')).toBe(
        path.join(UPLOADS_BASE, 'versions', '1785_v2.docx'),
      );
    });

    it('无前缀的老数据按业务资料处理', () => {
      expect(resolveDocumentFilePath(UPLOADS_BASE, 'legacy.pdf')).toBe(
        path.join(UPLOADS_BASE, 'documents', 'legacy.pdf'),
      );
    });

    it.each([
      'knowledge/../../../etc/passwd',
      'knowledge/产品样本/../../../../etc/passwd',
      'knowledge/..\\..\\evil.pdf',
    ])('知识资料的子目录不能被用来穿越目录：%s', (key: string) => {
      // 保留目录层级就用不了 sanitizeFileName，越界防护全靠最终路径断言
      expect(() => resolveDocumentFilePath(UPLOADS_BASE, key)).toThrow();
    });

    it('空 fileKey 直接拒绝', () => {
      expect(() => resolveDocumentFilePath(UPLOADS_BASE, '')).toThrow();
    });
  });

  /*
   * 扩展名白名单。
   *
   * 之所以要专门锁住：这里曾经踩过一个"两份名单漂移"的坑 ——
   * documents.service 里另有一份私有名单（实际是死代码，从未被调用），
   * 有人为了放开图片上传去改那一份，改完照样传不上去，
   * 因为真正拦人的是这里的 ALLOWED_EXTENSIONS。
   */
  describe('validateExtension —— 上传白名单', () => {
    const ok = (name: string, kind: keyof typeof ALLOWED_EXTENSIONS) =>
      expect(() => validateExtension(name, kind)).not.toThrow();
    const no = (name: string, kind: keyof typeof ALLOWED_EXTENSIONS) =>
      expect(() => validateExtension(name, kind)).toThrow();

    it.each(['报价单.pdf', '协议.docx', '清单.xlsx', '说明.md', '数据.csv', '方案.pptx'])(
      '业务资料放行文档格式：%s',
      (f: string) => ok(f, 'document'),
    );

    it.each(['现场照片.jpg', '铭牌.JPEG', '截图.png', '示意图.bmp', '动图.gif', '图.webp'])(
      '业务资料放行图片（现场照片/铭牌要随资料归档）：%s',
      (f: string) => ok(f, 'document'),
    );

    it.each(['辊系装配图.dwg', '布置图.dxf'])(
      '业务资料放行 CAD 图纸：%s',
      (f: string) => ok(f, 'document'),
    );

    it.each(['木马.exe', '脚本.bat', '库.dll'])(
      '业务资料仍拦下可执行文件：%s',
      (f: string) => no(f, 'document'),
    );

    // 客户发来的图纸包常是压缩包形态，归档比解析重要 ——
    // 解析器不支持 zip/rar/7z，走归档不建索引（与 .dwg 同等对待），故放行
    it.each(['图纸包.zip', '备件清单.rar', '现场照片合集.7z'])(
      '业务资料放行压缩包（归档用途，不进知识索引）：%s',
      (f: string) => ok(f, 'document'),
    );

    it('无扩展名要拦下', () => no('无后缀文件', 'document'));

    it('三类上传都允许图片', () => {
      (['document', 'requirement', 'product'] as const).forEach((kind) => {
        expect(ALLOWED_EXTENSIONS[kind]).toContain('.jpg');
      });
    });

    it('报错信息要说清被拒的后缀和支持的格式', () => {
      expect(() => validateExtension('木马.exe', 'document')).toThrow(/\.exe/);
      expect(() => validateExtension('木马.exe', 'document')).toThrow(/\.jpg/);
    });
  });
});
