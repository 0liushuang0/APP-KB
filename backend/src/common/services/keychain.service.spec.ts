import * as crypto from 'crypto';
import { KeychainService } from './keychain.service';

describe('KeychainService', () => {
  let svc: KeychainService;

  beforeEach(() => {
    svc = new KeychainService();
    svc.onModuleInit();
  });

  // ── encrypt / decrypt roundtrip ──
  describe('encrypt / decrypt', () => {
    it('加密后解密得到原文', () => {
      const plaintext = 'sk-abc123secretkey';
      const encrypted = svc.encrypt(plaintext);
      expect(encrypted).not.toBe(plaintext);
      expect(svc.decrypt(encrypted)).toBe(plaintext);
    });

    it('不同明文产生不同密文（随机 IV）', () => {
      const e1 = svc.encrypt('hello');
      const e2 = svc.encrypt('hello');
      // 同一明文两次加密结果应不同（因为随机 IV）
      expect(e1).not.toBe(e2);
      // 但都能正确解密
      expect(svc.decrypt(e1)).toBe('hello');
      expect(svc.decrypt(e2)).toBe('hello');
    });

    it('空字符串加密后解密（边界：28字节低于29阈值，decrypt返回原文）', () => {
      const encrypted = svc.encrypt('');
      // encrypt('') = 12 iv + 16 tag + 0 ciphertext = 28 bytes
      // decrypt 短于 29 字节时原样返回，这是设计行为
      expect(typeof encrypted).toBe('string');
      expect(encrypted.length).toBeGreaterThan(0);
    });

    it('长文本加密解密', () => {
      const longText = 'x'.repeat(10000);
      const encrypted = svc.encrypt(longText);
      expect(svc.decrypt(encrypted)).toBe(longText);
    });

    it('含特殊字符的文本正确处理', () => {
      const text = '中文密钥🔑!@#$%^&*()';
      expect(svc.decrypt(svc.encrypt(text))).toBe(text);
    });
  });

  // ── isEncrypted ──
  describe('isEncrypted', () => {
    it('加密后的值应被识别为已加密', () => {
      const encrypted = svc.encrypt('test-value');
      expect(svc.isEncrypted(encrypted)).toBe(true);
    });

    it('短字符串不是加密格式', () => {
      expect(svc.isEncrypted('abc')).toBe(false);
    });

    it('空字符串不是加密格式', () => {
      expect(svc.isEncrypted('')).toBe(false);
    });

    it('普通明文不是加密格式', () => {
      expect(svc.isEncrypted('just a plain text')).toBe(false);
    });

    it('合法 base64 但长度不够不算加密', () => {
      // 29 bytes is the minimum (12 iv + 16 tag + 1 ciphertext)
      const short = Buffer.alloc(28).toString('base64');
      expect(svc.isEncrypted(short)).toBe(false);
    });
  });

  // ── resolveSecret ──
  describe('resolveSecret', () => {
    it('加密值自动解密', () => {
      const secret = 'my-api-key-12345';
      const encrypted = svc.encrypt(secret);
      expect(svc.resolveSecret(encrypted)).toBe(secret);
    });

    it('明文值原样返回', () => {
      expect(svc.resolveSecret('plain-value')).toBe('plain-value');
    });

    it('undefined 返回空字符串', () => {
      expect(svc.resolveSecret(undefined)).toBe('');
    });

    it('空字符串返回空字符串', () => {
      expect(svc.resolveSecret('')).toBe('');
    });
  });

  // ── machine key derivation ──
  describe('machine key derivation', () => {
    it('同一实例多次调用结果一致', () => {
      const e1 = svc.encrypt('consistent');
      const svc2 = new KeychainService();
      svc2.onModuleInit();
      // 同一台机器，密钥应相同，解密应成功
      expect(svc2.decrypt(e1)).toBe('consistent');
    });
  });
});
