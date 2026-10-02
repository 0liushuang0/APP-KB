import { evaluateFormula, validateFormula } from './formula.engine';

const ev = (expr: string, scope: Record<string, number> = {}) => evaluateFormula(expr, scope);

describe('formula engine', () => {
  describe('运算与优先级', () => {
    it.each([
      ['1 + 2 * 3', 7],
      ['(1 + 2) * 3', 9],
      ['2 ^ 3 ^ 2', 512], // 幂运算右结合
      ['-3 + 5', 2],
      ['-(2 + 3)', -5],
      ['10 % 3', 1],
      ['2 * -3', -6], // 运算符后的一元负号
    ])('%s = %d', (expr: string, expected: number) => {
      expect(ev(expr)).toBeCloseTo(expected, 6);
    });
  });

  describe('变量代入', () => {
    it('多变量按正确顺序参与运算', () => {
      expect(ev('a * b', { a: 3, b: 4 })).toBe(12);
      // 非交换运算：操作数顺序错了这里就会挂
      expect(ev('a - b', { a: 10, b: 3 })).toBe(7);
      expect(ev('a / b', { a: 10, b: 4 })).toBe(2.5);
    });

    it('支持中文变量名', () => {
      expect(ev('厚度 * 2', { 厚度: 5 })).toBe(10);
    });

    it('未定义变量报错而不是当 0', () => {
      // 静默当 0 会算出一个看似合理的错误数字，比直接报错危险
      expect(() => ev('undefinedVar + 1')).toThrow(/未定义的变量/);
    });
  });

  describe('函数与常量', () => {
    it.each([
      ['sqrt(16)', 4],
      ['round(3.14159, 2)', 3.14],
      ['round(3.7)', 4],
      ['min(3, 1, 2)', 1],
      ['max(3, 1, 2)', 3],
      ['pow(2, 10)', 1024],
      ['abs(-5)', 5],
      ['if(1 > 0, 10, 20)', 10],
      ['if(0, 10, 20)', 20],
      ['cos(0)', 1],
      ['round(PI, 4)', 3.1416],
    ])('%s = %d', (expr: string, expected: number) => {
      expect(ev(expr)).toBeCloseTo(expected, 6);
    });

    it('比较运算返回 1 / 0', () => {
      expect(ev('3 > 2')).toBe(1);
      expect(ev('3 <= 2')).toBe(0);
      expect(ev('3 == 3')).toBe(1);
      expect(ev('3 != 3')).toBe(0);
    });
  });

  describe('安全性 —— 模板公式由管理员编辑，必须拒绝一切非算术输入', () => {
    it.each([
      ['process.exit(1)'],
      ['constructor'], // 原型链上的名字不能算已定义变量
      ['toString'],
      ['a[0]'],
      ['1; 2'],
      ['foo(1)'], // 未知函数
    ])('拒绝 %s', (expr: string) => {
      expect(() => ev(expr, { a: 1 })).toThrow();
    });
  });

  describe('错误处理', () => {
    it.each<[string, RegExp]>([
      ['1 / 0', /除数为 0/],
      ['(1 + 2', /括号不匹配/],
      ['1 + )', /括号不匹配/],
      ['sqrt(1, 2)', /需要 1 个参数/],
      ['1 +', /缺少操作数/],
      ['', /公式为空/],
    ])('%s 抛出可读错误', (expr: string, pattern: RegExp) => {
      expect(() => ev(expr)).toThrow(pattern);
    });
  });

  describe('真实模板公式（单位换算正确性）', () => {
    it('矫直力 4·M/L：M=15000 N·m, L=120mm → 500 kN', () => {
      expect(
        ev('round(4 * plasticMoment / rollPitch, 2)', { plasticMoment: 15000, rollPitch: 120 }),
      ).toBe(500);
    });

    it('每米重量：2mm × 1000mm × 7850kg/m³ → 15.7 kg/m', () => {
      expect(
        ev('thickness * width * density / 1000000', { thickness: 2, width: 1000, density: 7850 }),
      ).toBeCloseTo(15.7, 6);
    });

    it('活塞环形面积：φ200 / φ150', () => {
      const expected = (Math.PI / 4) * (200 ** 2 - 150 ** 2);
      expect(
        ev('PI / 4 * (pistonOuterD ^ 2 - pistonInnerD ^ 2)', {
          pistonOuterD: 200,
          pistonInnerD: 150,
        }),
      ).toBeCloseTo(expected, 4);
    });

    it('联轴器理论扭矩 T=9550P/n：55kW @ 1480rpm', () => {
      expect(ev('round(9550 * power / rpm, 2)', { power: 55, rpm: 1480 })).toBeCloseTo(354.9, 1);
    });
  });

  describe('validateFormula', () => {
    it('合法公式返回 null', () => {
      expect(validateFormula('a + b', ['a', 'b'])).toBeNull();
    });

    it('引用未知变量时返回错误说明', () => {
      expect(validateFormula('a + zzz', ['a'])).toMatch(/未定义的变量/);
    });
  });
});
