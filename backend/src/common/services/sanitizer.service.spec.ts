import { SanitizerService, SensitiveDataType, SensitivityLevel } from './sanitizer.service';

describe('SanitizerService', () => {
  let svc: SanitizerService;

  beforeEach(() => {
    svc = new SanitizerService();
  });

  // ── detectSensitiveData ──
  describe('detectSensitiveData', () => {
    it('检测中国大陆手机号', () => {
      const results = svc.detectSensitiveData('请联系13812345678');
      expect(results.length).toBeGreaterThanOrEqual(1);
      const phone = results.find((r) => r.type === SensitiveDataType.PHONE);
      expect(phone).toBeDefined();
      expect(phone!.value).toBe('13812345678');
    });

    it('检测带+86前缀的手机号', () => {
      const results = svc.detectSensitiveData('+8613900001111');
      const phone = results.find((r) => r.type === SensitiveDataType.PHONE);
      expect(phone).toBeDefined();
      expect(phone!.value).toBe('+8613900001111');
    });

    it('检测18位身份证号', () => {
      // 110101199003070011 — 有效校验码（sum%11=0, checksum='1'）
      const results = svc.detectSensitiveData('身份证：110101199003070011');
      const idCard = results.find((r) => r.type === SensitiveDataType.ID_CARD);
      expect(idCard).toBeDefined();
      expect(idCard!.value).toBe('110101199003070011');
      expect(idCard!.confidence).toBeGreaterThanOrEqual(0.95);
    });

    it('检测邮箱地址', () => {
      const results = svc.detectSensitiveData('邮箱 test@example.com 请确认');
      const email = results.find((r) => r.type === SensitiveDataType.EMAIL);
      expect(email).toBeDefined();
      expect(email!.value).toBe('test@example.com');
    });

    it('检测银行卡号（16位）', () => {
      // 6222021234567890123 — 19位
      const results = svc.detectSensitiveData('卡号6222021234567890');
      const bank = results.find((r) => r.type === SensitiveDataType.BANK_CARD);
      expect(bank).toBeDefined();
    });

    it('检测涉密关键词', () => {
      const results = svc.detectSensitiveData('此文件包含机密信息');
      const kw = results.find((r) => r.confidence === 0.9);
      expect(kw).toBeDefined();
    });

    it('纯文本无敏感数据返回空数组', () => {
      const results = svc.detectSensitiveData('今天天气真好');
      expect(results).toEqual([]);
    });

    it('同时检测多种敏感数据', () => {
      const results = svc.detectSensitiveData('手机13800138000，邮箱a@b.com');
      const types = new Set(results.map((r) => r.type));
      expect(types.has(SensitiveDataType.PHONE)).toBe(true);
      expect(types.has(SensitiveDataType.EMAIL)).toBe(true);
    });
  });

  // ── maskPhone ──
  describe('maskPhone', () => {
    it('标准11位手机号脱敏', () => {
      expect(svc.maskPhone('13812345678')).toBe('138****5678');
    });

    it('非11位原样返回', () => {
      expect(svc.maskPhone('123')).toBe('123');
    });
  });

  // ── maskIdCard ──
  describe('maskIdCard', () => {
    it('标准18位身份证脱敏', () => {
      expect(svc.maskIdCard('11010119900307001X')).toBe('110101********001X');
    });

    it('非18位原样返回', () => {
      expect(svc.maskIdCard('12345')).toBe('12345');
    });
  });

  // ── maskEmail ──
  describe('maskEmail', () => {
    it('标准邮箱脱敏', () => {
      expect(svc.maskEmail('test@example.com')).toBe('te***@example.com');
    });

    it('用户名仅2个字符时特殊处理', () => {
      expect(svc.maskEmail('ab@test.com')).toBe('a**@test.com');
    });

    it('无@符号原样返回', () => {
      expect(svc.maskEmail('invalid')).toBe('invalid');
    });
  });

  // ── maskBankCard ──
  describe('maskBankCard', () => {
    it('16位银行卡脱敏', () => {
      expect(svc.maskBankCard('6222021234567890')).toBe('6222 **** **** 7890');
    });

    it('19位银行卡脱敏', () => {
      expect(svc.maskBankCard('6222021234567890123')).toBe('6222 **** **** 0123');
    });

    it('短于16位原样返回', () => {
      expect(svc.maskBankCard('12345')).toBe('12345');
    });
  });

  // ── detectSensitivityLevel ──
  describe('detectSensitivityLevel', () => {
    it('绝密关键词返回 SECRET', () => {
      expect(svc.detectSensitivityLevel('此文档为绝密')).toBe(SensitivityLevel.SECRET);
    });

    it('机密关键词返回 CONFIDENTIAL', () => {
      expect(svc.detectSensitivityLevel('这是机密文件')).toBe(SensitivityLevel.CONFIDENTIAL);
    });

    it('secret 关键词返回 CONFIDENTIAL', () => {
      expect(svc.detectSensitivityLevel('This is secret')).toBe(SensitivityLevel.CONFIDENTIAL);
    });

    it('内部关键词返回 INTERNAL', () => {
      expect(svc.detectSensitivityLevel('内部资料请勿外传')).toBe(SensitivityLevel.INTERNAL);
    });

    it('敏感业务词汇返回 INTERNAL', () => {
      expect(svc.detectSensitivityLevel('本次报价含利润分析')).toBe(SensitivityLevel.INTERNAL);
    });

    it('含手机号等PII返回 INTERNAL', () => {
      expect(svc.detectSensitivityLevel('联系人手机13800138000')).toBe(SensitivityLevel.INTERNAL);
    });

    it('无敏感内容返回 PUBLIC', () => {
      expect(svc.detectSensitivityLevel('今天天气不错')).toBe(SensitivityLevel.PUBLIC);
    });
  });

  // ── sanitizeObject ──
  describe('sanitizeObject', () => {
    it('递归脱敏嵌套对象', () => {
      const obj = { name: '张三', phone: '13812345678', child: { email: 'a@b.com' } };
      const result = svc.sanitizeObject(obj);
      expect(result.phone).toContain('****');
      expect(result.child.email).toContain('***');
    });

    it('数组元素也被脱敏', () => {
      const arr = ['邮箱x@y.com', '纯文本'];
      const result = svc.sanitizeObject(arr);
      expect(result[0]).toContain('***');
      expect(result[1]).toBe('纯文本');
    });

    it('excludeFields 中的字段不脱敏', () => {
      const obj = { phone: '13812345678', raw: '13800001111' };
      const result = svc.sanitizeObject(obj, ['raw']);
      expect(result.phone).toContain('****');
      expect(result.raw).toBe('13800001111');
    });

    it('null 原样返回', () => {
      expect(svc.sanitizeObject(null)).toBeNull();
    });

    it('数字原样返回', () => {
      expect(svc.sanitizeObject(42)).toBe(42);
    });

    it('嵌套多层递归正确', () => {
      const obj = { a: { b: { c: '电话13800138000' } } };
      const result = svc.sanitizeObject(obj);
      expect(result.a.b.c).toContain('****');
    });
  });

  // ── sanitizeText ──
  describe('sanitizeText', () => {
    it('无敏感数据原样返回', () => {
      expect(svc.sanitizeText('普通文本')).toBe('普通文本');
    });

    it('使用自定义掩码字符', () => {
      const result = svc.sanitizeText('手机13812345678', { maskChar: '#' });
      expect(result).toContain('#');
    });
  });

  // ── generateSanitizationReport ──
  describe('generateSanitizationReport', () => {
    it('生成完整报告', () => {
      const report = svc.generateSanitizationReport('手机13812345678，邮箱a@b.com');
      expect(report.originalLength).toBeGreaterThan(0);
      expect(report.detections.length).toBeGreaterThanOrEqual(2);
      expect(report.sensitivityLevel).toBeDefined();
      expect(report.summary).toContain('敏感数据');
    });

    it('无敏感数据时报告正确', () => {
      const report = svc.generateSanitizationReport('普通文本');
      expect(report.detections).toHaveLength(0);
      expect(report.sensitivityLevel).toBe(SensitivityLevel.PUBLIC);
    });
  });
});
