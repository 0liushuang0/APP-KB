import { extractSerial } from './numbering.service';

/**
 * 派生编号的流水号提取。
 *
 * 这里钉死的是一个真实踩过的坑：需求改版号 REQ-2026-007-V2 派生方案时，
 * 旧正则把版本号里的 "2" 当成流水号，方案编号变成 PROP-2026-002，
 * 且报价 / 合同会继续继承这个错号。
 */
describe('extractSerial', () => {
  it('裸号取流水号', () => {
    expect(extractSerial('REQ-2026-007')).toBe('007');
    expect(extractSerial('CUST-2026-012')).toBe('012');
  });

  it('改版号不能把版本号当流水号（回归：曾取到 "2"）', () => {
    expect(extractSerial('REQ-2026-007-V2')).toBe('007');
    expect(extractSerial('REQ-2026-007-V10')).toBe('007');
    expect(extractSerial('REQ-2026-123-V2')).toBe('123');
  });

  it('字母后缀（同上游第二份派生件）照旧', () => {
    expect(extractSerial('PROP-2026-007-A')).toBe('007');
    expect(extractSerial('PROP-2026-007-Z')).toBe('007');
  });

  it('两种后缀叠加也取最靠前的流水号', () => {
    expect(extractSerial('PROP-2026-007-A-V2')).toBe('007');
    expect(extractSerial('REQ-2026-007-V2-A')).toBe('007');
  });

  it('年月格式与无分隔符格式', () => {
    expect(extractSerial('QUO-202608-045')).toBe('045');
    expect(extractSerial('SUP001')).toBe('001');
  });

  it('没有数字段时返回 null（调用方会退回独立流水号）', () => {
    expect(extractSerial('REQ-ABC')).toBeNull();
    expect(extractSerial('')).toBeNull();
    expect(extractSerial(undefined as any)).toBeNull();
  });
});
