import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { SanitizerService, SensitivityLevel } from './sanitizer.service';

/**
 * 脱敏中间件配置
 */
export interface SanitizerMiddlewareConfig {
  /** 是否启用请求脱敏 */
  sanitizeRequest?: boolean;
  /** 是否启用响应脱敏 */
  sanitizeResponse?: boolean;
  /** 排除的路径 */
  excludePaths?: string[];
  /** 排除的字段 */
  excludeFields?: string[];
  /** 涉密等级阈值（超过此等级才脱敏） */
  sensitivityThreshold?: SensitivityLevel;
}

/**
 * 脱敏中间件
 * 自动检测和脱敏请求/响应中的敏感数据
 */
@Injectable()
export class SanitizerMiddleware implements NestMiddleware {
  private readonly logger = new Logger(SanitizerMiddleware.name);

  private readonly defaultConfig: SanitizerMiddlewareConfig = {
    sanitizeRequest: true,
    sanitizeResponse: false,
    excludePaths: ['/health', '/api/docs', '/swagger'],
    excludeFields: ['password', 'token', 'secret', 'key'],
    sensitivityThreshold: SensitivityLevel.INTERNAL,
  };

  constructor(
    private readonly sanitizerService: SanitizerService,
    private readonly config: SanitizerMiddlewareConfig = {},
  ) {
    this.config = { ...this.defaultConfig, ...config };
  }

  use(req: Request, res: Response, next: NextFunction): void {
    // 检查是否在排除路径中
    if (this.shouldExclude(req.path)) {
      return next();
    }

    // 请求脱敏
    if (this.config.sanitizeRequest && req.body) {
      this.sanitizeRequestBody(req);
    }

    // 响应脱敏（通过拦截响应）
    if (this.config.sanitizeResponse) {
      this.interceptResponse(req, res);
    }

    next();
  }

  /**
   * 检查是否应该排除
   */
  private shouldExclude(path: string): boolean {
    return this.config.excludePaths?.some(excludePath =>
      path.startsWith(excludePath),
    ) || false;
  }

  /**
   * 脱敏请求体
   */
  private sanitizeRequestBody(req: Request): void {
    try {
      const body = req.body;

      if (typeof body === 'object' && body !== null) {
        const sanitized = this.sanitizeObject(body);
        req.body = sanitized;
      }
    } catch (error) {
      this.logger.error(`Request sanitization failed: ${error.message}`);
    }
  }

  /**
   * 递归脱敏对象
   */
  private sanitizeObject(obj: any): any {
    if (typeof obj !== 'object' || obj === null) {
      if (typeof obj === 'string') {
        return this.sanitizeStringValue(obj);
      }
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item));
    }

    const result: any = {};
    for (const key of Object.keys(obj)) {
      // 检查是否在排除字段中
      if (this.config.excludeFields?.includes(key.toLowerCase())) {
        result[key] = obj[key];
        continue;
      }

      const value = obj[key];

      if (typeof value === 'string') {
        result[key] = this.sanitizeStringValue(value);
      } else if (typeof value === 'object') {
        result[key] = this.sanitizeObject(value);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * 脱敏字符串值
   */
  private sanitizeStringValue(value: string): string {
    // 检测涉密等级
    const level = this.sanitizerService.detectSensitivityLevel(value);

    // 如果低于阈值，不脱敏
    const levels = [
      SensitivityLevel.PUBLIC,
      SensitivityLevel.INTERNAL,
      SensitivityLevel.CONFIDENTIAL,
      SensitivityLevel.SECRET,
    ];

    const thresholdIndex = levels.indexOf(this.config.sensitivityThreshold);
    const currentIndex = levels.indexOf(level);

    if (currentIndex < thresholdIndex) {
      return value;
    }

    // 进行脱敏
    return this.sanitizerService.sanitizeText(value);
  }

  /**
   * 拦截响应
   */
  private interceptResponse(req: Request, res: Response): void {
    const originalSend = res.send;
    const sanitizerService = this.sanitizerService;

    res.send = function (body: any) {
      try {
        if (typeof body === 'string') {
          // 尝试解析 JSON
          try {
            const parsed = JSON.parse(body);
            const sanitized = sanitizerService.sanitizeObject(parsed);
            body = JSON.stringify(sanitized);
          } catch {
            // 不是 JSON，直接脱敏字符串
            body = sanitizerService.sanitizeText(body);
          }
        } else if (typeof body === 'object') {
          body = sanitizerService.sanitizeObject(body);
        }
      } catch (error) {
        // 脱敏失败，返回原响应
      }

      return originalSend.call(this, body);
    };
  }
}
