import { fixMulterEncoding } from './safe-path.util';

const asMulter = (name: string) => Buffer.from(name, 'utf8').toString('latin1');

describe('fixMulterEncoding', () => {
  it('restores names whose only non-ASCII chars are full-width punctuation', () => {
    const real = 'TENOVA 1450 combine type tension leveler ( inclusive bridle roll）20261014.docx';
    expect(fixMulterEncoding(asMulter(real))).toBe(real);
  });

  it('restores Chinese names and leaves normal names alone', () => {
    expect(fixMulterEncoding(asMulter('技术规格书（带张力辊）.docx'))).toBe('技术规格书（带张力辊）.docx');
    expect(fixMulterEncoding('技术规格书.docx')).toBe('技术规格书.docx');
    expect(fixMulterEncoding('plain-name.docx')).toBe('plain-name.docx');
    // 本来就是 Latin1 的真实字符(如 café)不是 UTF-8 字节序列, 保持原样
    expect(fixMulterEncoding('café.docx')).toBe('café.docx');
  });
});
