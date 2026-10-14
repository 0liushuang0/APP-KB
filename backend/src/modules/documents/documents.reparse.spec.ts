/* eslint-disable @typescript-eslint/no-var-requires */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DocumentsService } from './documents.service';
import { hasRealParsedText, parseStatusMarker } from '../../common/utils/parsed-text.util';
import { isDroppableOfficePart, slimOfficeFile } from '../../common/utils/office-slim.util';

const archiver = require('archiver');
const unzipper = require('unzipper');

const marker = (extra: Record<string, any> = {}) =>
  JSON.stringify({ indexed: false, chunks: 0, reason: 'no_text', note: '该文件未能提取出可读正文，不参与 AI 问答', ...extra });

describe('parsed-text.util', () => {
  it('status marker JSON is not body text even though it is long', () => {
    expect(marker().length).toBeGreaterThan(50);
    expect(hasRealParsedText(marker())).toBe(false);
    expect(hasRealParsedText(JSON.stringify({ indexed: true, chunks: 64, submitted: 70 }))).toBe(false);
    expect(parseStatusMarker(marker({ parser: 2 }))?.parser).toBe(2);
  });

  it('placeholder vs real text', () => {
    expect(hasRealParsedText('[博亚精工产品推介资料2407.pptx] 文件已上传，等待解析。')).toBe(false);
    expect(hasRealParsedText('襄阳博亚精工装备股份有限公司主要从事民用机械关键基础零部件、特种传动零部件以及板带精整精密装备的研发设计制造')).toBe(true);
    // 正文里出现花括号不算标记
    expect(hasRealParsedText('{ 技术参数 } 最大带宽 1850mm，速度 300m/min，矫直辊直径 60mm，工作辊 23 根，支撑辊 6 排。')).toBe(true);
  });
});

describe('DocumentsService.needsReparse', () => {
  const d = (fileName: string, parsedText: string, category = 'proposal') => ({ fileName, parsedText, category } as any);

  it('picks old no_text markers and placeholders of parseable types', () => {
    expect(DocumentsService.needsReparse(d('介绍.pptx', marker()))).toBe(true);
    expect(DocumentsService.needsReparse(d('简介.docx', '[简介.docx] 文件已上传，等待解析。'))).toBe(true);
    expect(DocumentsService.needsReparse(d('方案.PDF', marker({ parser: 1 })))).toBe(true);
  });

  it('skips what the current parser already tried, images, archives, knowledge docs and real text', () => {
    expect(DocumentsService.needsReparse(d('介绍.pptx', marker({ parser: DocumentsService.PARSER_VERSION })))).toBe(false);
    expect(DocumentsService.needsReparse(d('现场.jpg', JSON.stringify({ indexed: false, reason: 'image_file' })))).toBe(false);
    expect(DocumentsService.needsReparse(d('图纸.rar', marker()))).toBe(false);
    expect(DocumentsService.needsReparse(d('手册.pdf', marker(), 'knowledge/product_manual'))).toBe(false);
    expect(DocumentsService.needsReparse(d('方案.docx', '一'.repeat(120)))).toBe(false);
  });
});

describe('office-slim.util', () => {
  it('classifies media parts', () => {
    expect(isDroppableOfficePart('ppt/media/image12.png')).toBe(true);
    expect(isDroppableOfficePart('word/embeddings/oleObject1.bin')).toBe(true);
    expect(isDroppableOfficePart('ppt/slides/slide1.xml')).toBe(false);
    expect(isDroppableOfficePart('[Content_Types].xml')).toBe(false);
  });

  it('keeps every entry, blanks media, keeps XML intact', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slim-'));
    const src = path.join(dir, 'big.pptx');
    try {
      await new Promise<void>((resolve, reject) => {
        const out = fs.createWriteStream(src);
        out.on('close', () => resolve());
        const a = archiver('zip', { store: true });
        a.on('error', reject);
        a.pipe(out);
        a.append('<Types/>', { name: '[Content_Types].xml' });
        a.append('<p:sld>拉伸弯曲矫直机</p:sld>', { name: 'ppt/slides/slide1.xml' });
        a.append(Buffer.alloc(2 * 1024 * 1024, 7), { name: 'ppt/media/image1.png' });
        a.finalize();
      });
      const slim = await slimOfficeFile(src);
      expect(slim.length).toBeLessThan(10 * 1024);
      const z = await unzipper.Open.buffer(slim);
      const files = Object.fromEntries(await Promise.all(z.files.map(async (f: any) => [f.path, await f.buffer()])));
      expect(Object.keys(files).sort()).toEqual(['[Content_Types].xml', 'ppt/media/image1.png', 'ppt/slides/slide1.xml']);
      expect(files['ppt/media/image1.png'].length).toBe(0);
      expect(files['ppt/slides/slide1.xml'].toString('utf-8')).toContain('拉伸弯曲矫直机');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
