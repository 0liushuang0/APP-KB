import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 加密配置
 */
export interface EncryptionConfig {
  algorithm: string;
  keyLength: number;
  ivLength: number;
  tagLength: number;
}

/**
 * 加密结果
 */
export interface EncryptionResult {
  encryptedPath: string;
  iv: string;
  tag: string;
  keyId: string;
  checksum: string;
}

/**
 * 文件加密服务
 * 使用 AES-256-GCM 加密敏感文件
 */
@Injectable()
export class FileEncryptionService {
  private readonly logger = new Logger(FileEncryptionService.name);

  private readonly defaultConfig: EncryptionConfig = {
    algorithm: 'aes-256-gcm',
    keyLength: 32,
    ivLength: 16,
    tagLength: 16,
  };

  private encryptionKey: Buffer | null = null;
  private keyId: string = 'default';

  constructor(private configService: ConfigService) {
    this.initializeKey();
  }

  /**
   * 初始化加密密钥
   */
  private initializeKey(): void {
    const keyHex = this.configService.get<string>('FILE_ENCRYPTION_KEY');
    const enabled = this.configService.get<string>('FILE_ENCRYPTION_ENABLED') === 'true';

    if (!enabled) {
      this.logger.log('File encryption is disabled');
      return;
    }

    if (keyHex) {
      // 使用配置的密钥
      this.encryptionKey = Buffer.from(keyHex, 'hex');
      this.keyId = this.generateKeyId(this.encryptionKey);
      this.logger.log(`File encryption initialized with configured key (ID: ${this.keyId})`);
    } else {
      // 生成随机密钥
      this.encryptionKey = crypto.randomBytes(this.defaultConfig.keyLength);
      this.keyId = this.generateKeyId(this.encryptionKey);
      this.logger.warn(
        `File encryption initialized with generated key (ID: ${this.keyId}). ` +
        `Set FILE_ENCRYPTION_KEY environment variable for production use.`
      );
    }
  }

  /**
   * 生成密钥ID
   */
  private generateKeyId(key: Buffer): string {
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    return hash.substring(0, 16);
  }

  /**
   * 检查加密是否启用
   */
  isEncryptionEnabled(): boolean {
    return this.encryptionKey !== null;
  }

  /**
   * 加密文件
   */
  async encryptFile(
    inputPath: string,
    outputDir?: string,
  ): Promise<EncryptionResult> {
    if (!this.encryptionKey) {
      throw new Error('Encryption is not enabled. Set FILE_ENCRYPTION_ENABLED=true');
    }

    // 读取源文件
    const plaintext = fs.readFileSync(inputPath);

    // 生成 IV
    const iv = crypto.randomBytes(this.defaultConfig.ivLength);

    // 创建加密器
    const cipher = crypto.createCipheriv(
      this.defaultConfig.algorithm,
      this.encryptionKey,
      iv,
    ) as crypto.CipherGCM;

    // 加密
    const encrypted = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);

    // 获取认证标签
    const tag = cipher.getAuthTag();

    // 计算校验和
    const checksum = crypto
      .createHash('sha256')
      .update(plaintext)
      .digest('hex');

    // 确定输出路径
    const fileName = path.basename(inputPath);
    const encryptedFileName = `${fileName}.enc`;
    const encryptedPath = outputDir
      ? path.join(outputDir, encryptedFileName)
      : path.join(path.dirname(inputPath), encryptedFileName);

    // 确保输出目录存在
    const outputDirPath = path.dirname(encryptedPath);
    if (!fs.existsSync(outputDirPath)) {
      fs.mkdirSync(outputDirPath, { recursive: true });
    }

    // 写入加密文件
    // 格式: [IV (16 bytes)] + [Tag (16 bytes)] + [Encrypted Data]
    const encryptedData = Buffer.concat([iv, tag, encrypted]);
    fs.writeFileSync(encryptedPath, encryptedData);

    this.logger.log(`Encrypted file: ${inputPath} -> ${encryptedPath}`);

    return {
      encryptedPath,
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      keyId: this.keyId,
      checksum,
    };
  }

  /**
   * 解密文件
   */
  async decryptFile(
    encryptedPath: string,
    outputPath?: string,
  ): Promise<string> {
    if (!this.encryptionKey) {
      throw new Error('Encryption is not enabled');
    }

    // 读取加密文件
    const encryptedData = fs.readFileSync(encryptedPath);

    // 解析加密数据
    const iv = encryptedData.subarray(0, this.defaultConfig.ivLength);
    const tag = encryptedData.subarray(
      this.defaultConfig.ivLength,
      this.defaultConfig.ivLength + this.defaultConfig.tagLength,
    );
    const encrypted = encryptedData.subarray(
      this.defaultConfig.ivLength + this.defaultConfig.tagLength,
    );

    // 创建解密器
    const decipher = crypto.createDecipheriv(
      this.defaultConfig.algorithm,
      this.encryptionKey,
      iv,
    ) as crypto.DecipherGCM;

    // 设置认证标签
    decipher.setAuthTag(tag);

    // 解密
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    // 确定输出路径
    const decryptedPath = outputPath || encryptedPath.replace('.enc', '');

    // 写入解密文件
    fs.writeFileSync(decryptedPath, decrypted);

    this.logger.log(`Decrypted file: ${encryptedPath} -> ${decryptedPath}`);

    return decryptedPath;
  }

  /**
   * 加密 Buffer 数据
   */
  encryptBuffer(plaintext: Buffer): {
    encrypted: Buffer;
    iv: string;
    tag: string;
    keyId: string;
  } {
    if (!this.encryptionKey) {
      throw new Error('Encryption is not enabled');
    }

    const iv = crypto.randomBytes(this.defaultConfig.ivLength);

    const cipher = crypto.createCipheriv(
      this.defaultConfig.algorithm,
      this.encryptionKey,
      iv,
    ) as crypto.CipherGCM;

    const encrypted = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);

    const tag = cipher.getAuthTag();

    return {
      encrypted: Buffer.concat([iv, tag, encrypted]),
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      keyId: this.keyId,
    };
  }

  /**
   * 解密 Buffer 数据
   */
  decryptBuffer(encryptedData: Buffer): Buffer {
    if (!this.encryptionKey) {
      throw new Error('Encryption is not enabled');
    }

    const iv = encryptedData.subarray(0, this.defaultConfig.ivLength);
    const tag = encryptedData.subarray(
      this.defaultConfig.ivLength,
      this.defaultConfig.ivLength + this.defaultConfig.tagLength,
    );
    const encrypted = encryptedData.subarray(
      this.defaultConfig.ivLength + this.defaultConfig.tagLength,
    );

    const decipher = crypto.createDecipheriv(
      this.defaultConfig.algorithm,
      this.encryptionKey,
      iv,
    ) as crypto.DecipherGCM;

    decipher.setAuthTag(tag);

    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
  }

  /**
   * 验证文件完整性
   */
  verifyFileIntegrity(filePath: string, expectedChecksum: string): boolean {
    const content = fs.readFileSync(filePath);
    const actualChecksum = crypto
      .createHash('sha256')
      .update(content)
      .digest('hex');

    return actualChecksum === expectedChecksum;
  }

  /**
   * 生成随机加密密钥
   */
  static generateKey(): string {
    return crypto.randomBytes(32).toString('hex');
  }
}
