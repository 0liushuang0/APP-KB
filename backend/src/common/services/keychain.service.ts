import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * 系统密钥库服务。
 *
 * 问题：API Key 明文存在 .env 里，任何能读文件的进程都能拿到。
 *
 * 方案（分三级降级）：
 *   1. keytar —— 调 OS 密钥链（Windows Credential Manager / macOS Keychain / Linux Secret Service）
 *      需要原生编译，Docker 里不可用
 *   2. 加密 .env —— 用机器特征派生密钥，AES-256-GCM 加密后存回 .env
 *      同一台机器能解，拷走 .env 文件打不开
 *   3. 明文兜底 —— 都不可用时回退到原始行为，打一条警告日志
 *
 * 当前实现：方案 2（加密 .env），因为：
 * - keytar 在 Docker/无头 Linux 里需要装 libsecret，增加部署复杂度
 * - 桌面场景下"同一台机器能解"已经够用，核心威胁是 .env 文件泄漏
 */
@Injectable()
export class KeychainService implements OnModuleInit {
  private readonly logger = new Logger(KeychainService.name);
  private machineKey: Buffer | null = null;
  private readonly keychainDir: string;

  constructor() {
    this.keychainDir = path.resolve(process.cwd(), 'data', '.keychain');
  }

  onModuleInit(): void {
    this.machineKey = this.deriveMachineKey();
    if (this.machineKey) {
      this.logger.log('密钥库已初始化（机器特征加密模式）');
    } else {
      this.logger.warn('密钥库不可用，API Key 将以明文存储');
    }
  }

  /**
   * 从机器特征派生密钥。
   *
   * 使用 hostname + username + platform + homeDir 作为熵源，
   * 经 PBKDF2 派生 32 字节密钥。同一台机器每次启动结果一致，
   * 换台机器就解不开。
   */
  private deriveMachineKey(): Buffer | null {
    try {
      const entropy = [
        os.hostname(),
        os.userInfo().username,
        os.platform(),
        os.homedir(),
      ].join('|');

      // salt 固定即可，目的是让不同机器的相同 entropy 产出不同密钥
      const salt = 'aikb-keychain-v1';
      return crypto.pbkdf2Sync(entropy, salt, 100000, 32, 'sha256');
    } catch {
      return null;
    }
  }

  /**
   * 加密一个值。
   * 格式：base64(iv:tag:ciphertext)，iv=12B, tag=16B
   */
  encrypt(plaintext: string): string {
    if (!this.machineKey) return plaintext;

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.machineKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  /**
   * 解密一个值。
   * 如果解密失败（换了机器、格式不对），返回原文（可能是明文）。
   */
  decrypt(encrypted: string): string {
    if (!this.machineKey) return encrypted;

    try {
      const buf = Buffer.from(encrypted, 'base64');
      if (buf.length < 29) return encrypted; // 太短，不是加密格式

      const iv = buf.subarray(0, 12);
      const tag = buf.subarray(12, 28);
      const ciphertext = buf.subarray(28);

      const decipher = crypto.createDecipheriv('aes-256-gcm', this.machineKey, iv);
      decipher.setAuthTag(tag);
      return decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8');
    } catch {
      // 解密失败 = 密文损坏或换了机器，返回原文
      return encrypted;
    }
  }

  /**
   * 检查一个值是否已加密。
   * 加密后的值是合法的 base64 且长度 ≥ 29 字节。
   */
  isEncrypted(value: string): boolean {
    if (!value || value.length < 40) return false;
    try {
      const buf = Buffer.from(value, 'base64');
      return buf.length >= 29 && buf.toString('base64') === value;
    } catch {
      return false;
    }
  }

  /**
   * 安全地读取配置值：自动解密。
   * 如果值是加密格式则解密，否则原样返回。
   */
  resolveSecret(value: string | undefined): string {
    if (!value) return '';
    if (this.isEncrypted(value)) return this.decrypt(value);
    return value;
  }
}
