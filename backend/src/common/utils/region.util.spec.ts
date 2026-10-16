import { normalizeRegion, inferCountry, parseRegionDict, DEFAULT_REGION_DICT } from './region.util';

describe('区域字典归并', () => {
  it('标准值不动、别名归并', () => {
    expect(normalizeRegion('华东区')).toEqual({ region: '华东区', country: null, status: 'ok' });
    expect(normalizeRegion('华东')).toEqual({ region: '华东区', country: null, status: 'alias' });
    expect(normalizeRegion(' 华中 ')).toMatchObject({ region: '华中区', status: 'alias' });
  });

  it('区域里写的国家 / 境外片区 → 海外 + 国家', () => {
    expect(normalizeRegion('俄罗斯', DEFAULT_REGION_DICT, '莫斯科')).toEqual({ region: '海外', country: '俄罗斯', status: 'overseas' });
    expect(normalizeRegion('南亚区域', DEFAULT_REGION_DICT, '印度')).toEqual({ region: '海外', country: '印度', status: 'overseas' });
  });

  it('「海外」从地址认国家', () => {
    expect(normalizeRegion('海外', DEFAULT_REGION_DICT, '399-405, Rehri Road, Landhi, Karachi').country).toBe('巴基斯坦');
    expect(normalizeRegion('海外', DEFAULT_REGION_DICT, 'JSW Centre, Bandra Kurla Complex, Mumbai').country).toBe('印度');
    expect(normalizeRegion('海外', DEFAULT_REGION_DICT, 'São Francisco do Sul, Santa Catarina').country).toBe('巴西');
    expect(normalizeRegion('海外', DEFAULT_REGION_DICT, '').country).toBeNull();
  });

  it('认不出的原样保留，标 unknown；空值标 empty', () => {
    expect(normalizeRegion('火星区')).toEqual({ region: '火星区', country: null, status: 'unknown' });
    expect(normalizeRegion('')).toEqual({ region: null, country: null, status: 'empty' });
  });

  it('自定义字典与坏配置回退', () => {
    const d = parseRegionDict(JSON.stringify({ regions: [{ value: '华东', aliases: ['华东区'] }], overseas: {} }));
    expect(normalizeRegion('华东区', d)).toMatchObject({ region: '华东', status: 'alias' });
    expect(parseRegionDict('{bad')).toBe(DEFAULT_REGION_DICT);
    expect(inferCountry('Cherepovets, Vologda Region')).toBe('俄罗斯');
  });
});
