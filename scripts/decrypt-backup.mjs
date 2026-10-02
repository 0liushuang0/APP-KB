#!/usr/bin/env node
/**
 * 备份解密工具（配对 backend 的 AES-256-GCM 备份加密）。
 *
 * 用法：
 *   node scripts/decrypt-backup.mjs <backup.zip.enc> [输出.zip] [--key <密钥文件路径>]
 *
 * 密钥来源（二选一）：
 *   --key 指定密钥文件（64 位 hex，换机恢复时用异地保管的那份）
 *   默认读 backend/data/.backup-key（本机恢复）
 *
 * 文件格式：[12B iv][密文流][16B GCM tag]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const keyIdx = args.indexOf('--key');
const keyFile = keyIdx >= 0 ? args[keyIdx + 1] : null;
const positional = args.filter((_, i) => i !== keyIdx && i !== keyIdx + 1);

if (positional.length < 1) {
  console.error('用法：node scripts/decrypt-backup.mjs <backup.zip.enc> [输出.zip] [--key <密钥文件>]');
  process.exit(1);
}

const input = positional[0];
const output =
  positional[1] || input.replace(/\.enc$/, '') || input + '.decrypted.zip';

const defaultKey = path.resolve(process.cwd(), 'backend', 'data', '.backup-key');
const keyPath = keyFile || defaultKey;
if (!fs.existsSync(keyPath)) {
  console.error(`✗ 找不到密钥文件：${keyPath}`);
  console.error('  本机恢复应存在 backend/data/.backup-key；换机恢复请用 --key 指定异地保管的密钥。');
  process.exit(1);
}
const hex = fs.readFileSync(keyPath, 'utf8').trim();
if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
  console.error('✗ 密钥文件格式错误（应为 64 位 hex 字符串）');
  process.exit(1);
}
const key = Buffer.from(hex, 'hex');

if (!fs.existsSync(input)) {
  console.error(`✗ 找不到备份文件：${input}`);
  process.exit(1);
}

const fileSize = fs.statSync(input).size;
const iv = Buffer.alloc(12);
const tag = Buffer.alloc(16);

const inFd = fs.openSync(input, 'r');
fs.readSync(inFd, iv, 0, 12, 0);
fs.readSync(inFd, tag, 0, 16, fileSize - 16);
fs.closeSync(inFd);

const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
decipher.setAuthTag(tag);

await new Promise((resolve, reject) => {
  const rs = fs.createReadStream(input, { start: 12, end: fileSize - 17 });
  const ws = fs.createWriteStream(output);
  rs.pipe(decipher).pipe(ws);
  ws.on('finish', resolve);
  rs.on('error', reject);
  ws.on('error', reject);
  decipher.on('error', reject);
}).catch((err) => {
  console.error('✗ 解密失败（密钥不匹配或文件损坏）：', err.message);
  process.exit(1);
});

console.log(`✓ 解密完成：${output}（${(fs.statSync(output).size / 1024 / 1024).toFixed(1)} MB）`);
