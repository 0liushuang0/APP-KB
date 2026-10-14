import { ValidationPipe } from '@nestjs/common';
import { CreateCustomerDto } from './customer.dto';

/** 与 main.ts 相同的校验选项: 白名单 + 禁止多余字段 */
const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
const run = (body: any) =>
  pipe.transform(body, { type: 'body', metatype: CreateCustomerDto });
/** 校验失败时的提示全文(默认管道把明细放在响应体里) */
const reason = async (body: any): Promise<string> => {
  try {
    await run(body);
  } catch (e: any) {
    return JSON.stringify(e.getResponse());
  }
  return '';
};

describe('CreateCustomerDto', () => {
  it('accepts official email / phone / postal code, and empty strings', async () => {
    const dto: any = await run({ name: '特诺恩', email: 'info@tenova.com', phone: '+91 22 1234 5678', postalCode: '400001' });
    expect(dto.email).toBe('info@tenova.com');
    await expect(run({ name: 'A', email: '', phone: '', postalCode: '' })).resolves.toBeDefined();
  });

  it('rejects bad email / phone / postal code', async () => {
    expect(await reason({ name: 'A', email: 'not-an-email' })).toContain('email 格式不正确');
    expect(await reason({ name: 'A', email: ' info@a.com' })).toContain('email 格式不正确'); // 带空格(前端会先去空格)
    expect(await reason({ name: 'A', phone: 'abc' })).toContain('phone 格式不正确');
    expect(await reason({ name: 'A', postalCode: '!!' })).toContain('postalCode 格式不正确');
  });

  it('rejects unknown properties such as status (the form must not send it)', async () => {
    expect(await reason({ name: 'A', status: '' })).toContain('property status should not exist');
  });
});
