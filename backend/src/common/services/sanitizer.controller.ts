import { Controller, Post, Body, Get, Query } from '@nestjs/common';
import { ApiTags, ApiBody, ApiQuery } from '@nestjs/swagger';
import { SanitizerService, SensitivityLevel } from './sanitizer.service';

@ApiTags('数据脱敏')
@Controller('sanitizer')
export class SanitizerController {
  constructor(private readonly sanitizerService: SanitizerService) {}

  @Post('detect')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '待检测文本' },
      },
    },
  })
  detectSensitiveData(@Body('text') text: string) {
    const detections = this.sanitizerService.detectSensitiveData(text);
    const sensitivityLevel = this.sanitizerService.detectSensitivityLevel(text);

    return {
      detections,
      sensitivityLevel,
      total: detections.length,
    };
  }

  @Post('sanitize')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '待脱敏文本' },
        maskChar: { type: 'string', description: '掩码字符' },
        keepPrefix: { type: 'number', description: '保留前缀长度' },
        keepSuffix: { type: 'number', description: '保留后缀长度' },
      },
    },
  })
  sanitizeText(
    @Body('text') text: string,
    @Body('maskChar') maskChar?: string,
    @Body('keepPrefix') keepPrefix?: number,
    @Body('keepSuffix') keepSuffix?: number,
  ) {
    const sanitized = this.sanitizerService.sanitizeText(text, {
      maskChar: maskChar || '*',
      保留前缀: keepPrefix || 3,
      保留后缀: keepSuffix || 4,
    });

    return {
      original: text,
      sanitized,
    };
  }

  @Post('report')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '待分析文本' },
      },
    },
  })
  generateReport(@Body('text') text: string) {
    return this.sanitizerService.generateSanitizationReport(text);
  }

  @Post('mask/phone')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: '手机号' },
      },
    },
  })
  maskPhone(@Body('phone') phone: string) {
    return {
      original: phone,
      masked: this.sanitizerService.maskPhone(phone),
    };
  }

  @Post('mask/idcard')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        idCard: { type: 'string', description: '身份证号' },
      },
    },
  })
  maskIdCard(@Body('idCard') idCard: string) {
    return {
      original: idCard,
      masked: this.sanitizerService.maskIdCard(idCard),
    };
  }

  @Post('mask/email')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: '邮箱' },
      },
    },
  })
  maskEmail(@Body('email') email: string) {
    return {
      original: email,
      masked: this.sanitizerService.maskEmail(email),
    };
  }

  @Post('mask/bankcard')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        bankCard: { type: 'string', description: '银行卡号' },
      },
    },
  })
  maskBankCard(@Body('bankCard') bankCard: string) {
    return {
      original: bankCard,
      masked: this.sanitizerService.maskBankCard(bankCard),
    };
  }

  @Get('level')
  @ApiQuery({ name: 'text', description: '待检测文本' })
  detectLevel(@Query('text') text: string) {
    const level = this.sanitizerService.detectSensitivityLevel(text);
    return {
      text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
      sensitivityLevel: level,
    };
  }
}
