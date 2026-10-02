import * as crypto from 'crypto';

/**
 * TOTP 双因素认证（RFC 6238）——零依赖实现。
 *
 * 不引 otplib 的原因：算法本身只有 60 行（HMAC-SHA1 + 时间窗口），
 * 引入一个传递依赖换一段可审计的标准代码不划算。
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** 随机生成 20 字节密钥并编码为 Base32（认证器 App 通用格式） */
export function generateTotpSecret(): string {
  const bytes = crypto.randomBytes(20);
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

/** Base32 解码（认证器扫码内容与库中存储均为 Base32） */
function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** HOTP（RFC 4226）：计数器 → 6 位动态码
 *
 * 安全说明：这里用 HMAC-SHA1 是 RFC 6238 的规定算法（所有认证器 App
 * 默认按 SHA1/6 位/30 秒解析 otpauth 链接），且 HMAC-SHA1 针对密钥消息
 * 的伪造攻击至今有效——与"用 SHA1 哈希密码"的弱用法不是一回事。
 */
function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter % 0x100000000, 4);
  const hmac = crypto.createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

/**
 * 校验 6 位 TOTP 码。允许 ±1 个 30 秒窗口的时钟偏差
 * （手机与服务器时钟完全同步不现实）。
 */
export function verifyTotp(secretBase32: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const secret = base32Decode(secretBase32);
  if (secret.length === 0) return false;
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (const drift of [-1, 0, 1]) {
    const expected = hotp(secret, counter + drift);
    // 定长字符串比较（避免短路时序侧信道）
    if (code.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(code), Buffer.from(expected))) {
      return true;
    }
  }
  return false;
}

/** 生成 otpauth:// 链接（认证器 App 手动添加用） */
export function otpauthUrl(secretBase32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const issuerEnc = encodeURIComponent(issuer);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${issuerEnc}&algorithm=SHA1&digits=6&period=30`;
}
