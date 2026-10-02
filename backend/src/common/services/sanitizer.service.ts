import { Injectable, Logger } from '@nestjs/common';

/**
 * 敏感数据类型
 */
export enum SensitiveDataType {
  PHONE = 'phone',           // 手机号
  ID_CARD = 'id_card',       // 身份证号
  EMAIL = 'email',           // 邮箱
  BANK_CARD = 'bank_card',   // 银行卡号
  NAME = 'name',             // 姓名
  ADDRESS = 'address',       // 地址
  COMPANY = 'company',       // 公司名
  CUSTOM = 'custom',         // 自定义
}

/**
 * 涉密等级
 */
export enum SensitivityLevel {
  PUBLIC = 'public',           // 公开
  INTERNAL = 'internal',       // 内部
  CONFIDENTIAL = 'confidential', // 机密
  SECRET = 'secret',           // 绝密
}

/**
 * 检测结果
 */
export interface DetectionResult {
  type: SensitiveDataType;
  value: string;
  position: { start: number; end: number };
  confidence: number;
}

/**
 * 脱敏配置
 */
export interface SanitizerConfig {
  maskChar: string;
 保留前缀: number;
 保留后缀: number;
}

/**
 * 脱敏服务
 * 提供敏感数据检测和脱敏功能
 */
@Injectable()
export class SanitizerService {
  private readonly logger = new Logger(SanitizerService.name);

  // 敏感数据正则模式
  private readonly patterns: Map<SensitiveDataType, RegExp> = new Map([
    // 手机号（中国大陆）
    [SensitiveDataType.PHONE, /(?:\+86)?1[3-9]\d{9}/g],
    // 身份证号（18位）
    [SensitiveDataType.ID_CARD, /[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]/g],
    // 邮箱
    [SensitiveDataType.EMAIL, /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g],
    // 银行卡号（16-19位）
    [SensitiveDataType.BANK_CARD, /[1-9]\d{15,18}/g],
    // IP地址
    [SensitiveDataType.CUSTOM, /(?:\d{1,3}\.){3}\d{1,3}/g],
  ]);

  // 涉密关键词
  private readonly secretKeywords: string[] = [
    '绝密', '机密', '秘密', '内部', 'confidential', 'secret', 'private',
    '密码', 'password', 'token', 'key', 'secret', 'api_key',
    '私钥', 'private_key', '证书', 'certificate',
  ];

  // 敏感业务词汇
  private readonly sensitiveBusinessTerms: string[] = [
    '报价', '成本', '利润', '折扣', '底价',
    '合同金额', '交易价格', '利润率',
  ];

  /**
   * 检测文本中的敏感数据
   */
  detectSensitiveData(text: string): DetectionResult[] {
    const results: DetectionResult[] = [];

    // 使用正则检测
    for (const [type, pattern] of this.patterns) {
      const regex = new RegExp(pattern);
      let match;

      while ((match = regex.exec(text)) !== null) {
        results.push({
          type,
          value: match[0],
          position: { start: match.index, end: match.index + match[0].length },
          confidence: this.calculateConfidence(type, match[0]),
        });
      }
    }

    // 检测涉密关键词
    const secretMatches = this.detectSecretKeywords(text);
    results.push(...secretMatches);

    return results;
  }

  /**
   * 检测涉密关键词
   */
  private detectSecretKeywords(text: string): DetectionResult[] {
    const results: DetectionResult[] = [];
    const lowerText = text.toLowerCase();

    for (const keyword of this.secretKeywords) {
      const index = lowerText.indexOf(keyword.toLowerCase());
      if (index !== -1) {
        results.push({
          type: SensitiveDataType.CUSTOM,
          value: text.substring(index, index + keyword.length),
          position: { start: index, end: index + keyword.length },
          confidence: 0.9,
        });
      }
    }

    return results;
  }

  /**
   * 计算检测置信度
   */
  private calculateConfidence(type: SensitiveDataType, value: string): number {
    switch (type) {
      case SensitiveDataType.PHONE:
        return /^1[3-9]\d{9}$/.test(value) ? 0.95 : 0.7;
      case SensitiveDataType.ID_CARD:
        return this.validateIdCard(value) ? 0.98 : 0.6;
      case SensitiveDataType.EMAIL:
        return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value) ? 0.9 : 0.5;
      case SensitiveDataType.BANK_CARD:
        return this.validateBankCard(value) ? 0.85 : 0.5;
      default:
        return 0.7;
    }
  }

  /**
   * 验证身份证号
   */
  private validateIdCard(id: string): boolean {
    if (id.length !== 18) return false;

    // 加权因子
    const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
    // 校验码对应值
    const checksums = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];

    let sum = 0;
    for (let i = 0; i < 17; i++) {
      sum += parseInt(id[i]) * weights[i];
    }

    const checksum = checksums[sum % 11];
    return id[17].toUpperCase() === checksum;
  }

  /**
   * 验证银行卡号（Luhn算法）
   */
  private validateBankCard(card: string): boolean {
    if (card.length < 16 || card.length > 19) return false;

    let sum = 0;
    let isDouble = false;

    for (let i = card.length - 1; i >= 0; i--) {
      let digit = parseInt(card[i]);

      if (isDouble) {
        digit *= 2;
        if (digit > 9) {
          digit -= 9;
        }
      }

      sum += digit;
      isDouble = !isDouble;
    }

    return sum % 10 === 0;
  }

  /**
   * 脱敏文本
   */
  sanitizeText(
    text: string,
    config: Partial<SanitizerConfig> = {},
  ): string {
    const defaultConfig: SanitizerConfig = {
      maskChar: '*',
      保留前缀: 3,
      保留后缀: 4,
    };

    const finalConfig = { ...defaultConfig, ...config };

    // 检测敏感数据
    const detections = this.detectSensitiveData(text);

    if (detections.length === 0) {
      return text;
    }

    // 按位置倒序排序，从后往前替换
    detections.sort((a, b) => b.position.start - a.position.start);

    let result = text;
    for (const detection of detections) {
      const masked = this.maskValue(detection.value, finalConfig);
      result =
        result.substring(0, detection.position.start) +
        masked +
        result.substring(detection.position.end);
    }

    return result;
  }

  /**
   * 对值进行脱敏
   */
  private maskValue(value: string, config: SanitizerConfig): string {
    const { maskChar, 保留前缀, 保留后缀 } = config;

    if (value.length <= 保留前缀 + 保留后缀) {
      return maskChar.repeat(value.length);
    }

    const prefix = value.substring(0, 保留前缀);
    const suffix = value.substring(value.length - 保留后缀);
    const maskedLength = value.length - 保留前缀 - 保留后缀;

    return prefix + maskChar.repeat(maskedLength) + suffix;
  }

  /**
   * 脱敏手机号
   */
  maskPhone(phone: string): string {
    if (phone.length !== 11) return phone;
    return phone.substring(0, 3) + '****' + phone.substring(7);
  }

  /**
   * 脱敏身份证号
   */
  maskIdCard(idCard: string): string {
    if (idCard.length !== 18) return idCard;
    return idCard.substring(0, 6) + '********' + idCard.substring(14);
  }

  /**
   * 脱敏邮箱
   */
  maskEmail(email: string): string {
    const parts = email.split('@');
    if (parts.length !== 2) return email;

    const username = parts[0];
    const domain = parts[1];

    if (username.length <= 2) {
      return username[0] + '**@' + domain;
    }

    return username.substring(0, 2) + '***@' + domain;
  }

  /**
   * 脱敏银行卡号
   */
  maskBankCard(card: string): string {
    if (card.length < 16) return card;
    return card.substring(0, 4) + ' **** **** ' + card.substring(card.length - 4);
  }

  /**
   * 检测文档涉密等级
   */
  detectSensitivityLevel(text: string): SensitivityLevel {
    const lowerText = text.toLowerCase();

    // 检测绝密关键词
    if (lowerText.includes('绝密') || lowerText.includes('top secret')) {
      return SensitivityLevel.SECRET;
    }

    // 检测机密关键词
    if (lowerText.includes('机密') || lowerText.includes('confidential')) {
      return SensitivityLevel.CONFIDENTIAL;
    }

    // 检测秘密关键词
    if (lowerText.includes('秘密') || lowerText.includes('secret')) {
      return SensitivityLevel.CONFIDENTIAL;
    }

    // 检测内部关键词
    if (lowerText.includes('内部') || lowerText.includes('internal')) {
      return SensitivityLevel.INTERNAL;
    }

    // 检测敏感业务词汇
    const hasSensitiveBusiness = this.sensitiveBusinessTerms.some(term =>
      lowerText.includes(term),
    );

    if (hasSensitiveBusiness) {
      return SensitivityLevel.INTERNAL;
    }

    // 检测敏感数据
    const detections = this.detectSensitiveData(text);
    if (detections.length > 0) {
      return SensitivityLevel.INTERNAL;
    }

    return SensitivityLevel.PUBLIC;
  }

  /**
   * 递归脱敏对象（公开方法，供中间件和其他服务调用）
   */
  sanitizeObject(obj: any, excludeFields: string[] = []): any {
    if (typeof obj !== 'object' || obj === null) {
      if (typeof obj === 'string') {
        return this.sanitizeText(obj);
      }
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitizeObject(item, excludeFields));
    }

    const result: any = {};
    for (const key of Object.keys(obj)) {
      if (excludeFields.includes(key.toLowerCase())) {
        result[key] = obj[key];
        continue;
      }

      const value = obj[key];

      if (typeof value === 'string') {
        result[key] = this.sanitizeText(value);
      } else if (typeof value === 'object') {
        result[key] = this.sanitizeObject(value, excludeFields);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * 生成脱敏报告
   */
  generateSanitizationReport(text: string): {
    originalLength: number;
    sanitizedLength: number;
    detections: DetectionResult[];
    sensitivityLevel: SensitivityLevel;
    summary: string;
  } {
    const detections = this.detectSensitiveData(text);
    const sensitivityLevel = this.detectSensitivityLevel(text);
    const sanitizedText = this.sanitizeText(text);

    const typeCounts = new Map<SensitiveDataType, number>();
    for (const d of detections) {
      typeCounts.set(d.type, (typeCounts.get(d.type) || 0) + 1);
    }

    const summaryParts: string[] = [];
    for (const [type, count] of typeCounts) {
      summaryParts.push(`${type}: ${count}处`);
    }

    return {
      originalLength: text.length,
      sanitizedLength: sanitizedText.length,
      detections,
      sensitivityLevel,
      summary: `检测到${detections.length}处敏感数据(${summaryParts.join(', ')})，涉密等级：${sensitivityLevel}`,
    };
  }
}
