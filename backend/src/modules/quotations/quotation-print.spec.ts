import { toChineseAmount, toEnglishAmount } from './quotation-print.service';
import { parseRates, toCny } from '../../common/utils/currency.util';

describe('报价单大写金额', () => {
  it('人民币大写', () => {
    expect(toChineseAmount(1205000)).toBe('壹佰贰拾万伍仟元整');
    expect(toChineseAmount(10.5)).toBe('壹拾元伍角');
    expect(toChineseAmount(1000500)).toBe('壹佰万零伍佰元整');
    expect(toChineseAmount(100000005)).toBe('壹亿零伍元整');
    expect(toChineseAmount(1010)).toBe('壹仟零壹拾元整');
    expect(toChineseAmount(2960000.08)).toBe('贰佰玖拾陆万元零捌分');
  });

  it('英文大写（外贸惯例 SAY ... ONLY）', () => {
    expect(toEnglishAmount(120000, 'USD')).toBe('SAY US DOLLARS ONE HUNDRED TWENTY THOUSAND ONLY');
    expect(toEnglishAmount(1250345.5, 'EUR')).toBe(
      'SAY EUROS ONE MILLION TWO HUNDRED FIFTY THOUSAND THREE HUNDRED FORTY-FIVE AND CENTS FIFTY ONLY',
    );
    expect(toEnglishAmount(0, 'USD')).toBe('SAY US DOLLARS ZERO ONLY');
  });
});

describe('币种折算', () => {
  it('单据汇率优先，其次配置汇率；人民币原样', () => {
    expect(toCny(100, 'USD', 7.2)).toBe(720);
    expect(toCny(100, 'USD', null, { CNY: 1, USD: 7 })).toBe(700);
    expect(toCny(100, null)).toBe(100);
    expect(toCny('1000.5', 'CNY', 7)).toBe(1000.5);
  });

  it('汇率配置写坏时回退参考值', () => {
    expect(parseRates('not json').USD).toBeGreaterThan(0);
    expect(parseRates('{"USD": -1, "EUR": 8}')).toMatchObject({ CNY: 1, EUR: 8 });
    expect(parseRates('{"USD": -1}').USD).toBeGreaterThan(0);
  });
});
