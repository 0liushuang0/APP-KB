/**
 * 客户区域受控字典（纯函数，可测）。
 *
 * 原来区域同时有「华中区/华中」「华东区/华东」「海外/俄罗斯/南亚区域」：分布图、筛选被拆碎，
 * 前端下拉写的是「华东」、库里 45 家是「华东区」，按区域筛选只能筛出 1 家。
 *
 * 规则：
 *  · 标准值取库里的多数写法（华北区/华东区/…/海外）；别名（华东、华东地区…）一律归到标准值；
 *  · 区域里写的是国家或境外片区（俄罗斯、南亚区域…）→ 区域归「海外」，国家写进 country；
 *  · 片区没写国家（南亚区域、海外）时再从地址里认国家（Mumbai → 印度、Karachi → 巴基斯坦…）；
 *  · 认不出的原样保留并标为 unknown，交给人在「区域字典」里补映射，不瞎猜。
 * 字典存系统配置 region_dict，可在 设置 → 区域字典 里改。
 */
export interface RegionDict {
  regions: Array<{ value: string; aliases: string[] }>;
  /** 写在区域字段里的境外国家/片区 → 国家（空串表示只知道在海外、国家要从地址认） */
  overseas: Record<string, string>;
}

export const REGION_DICT_KEY = 'region_dict';

export const DEFAULT_REGION_DICT: RegionDict = {
  regions: [
    { value: '华北区', aliases: ['华北', '华北地区', '北方区'] },
    { value: '华东区', aliases: ['华东', '华东地区'] },
    { value: '华中区', aliases: ['华中', '华中地区'] },
    { value: '华南区', aliases: ['华南', '华南地区'] },
    { value: '西北区', aliases: ['西北', '西北地区'] },
    { value: '西南区', aliases: ['西南', '西南地区'] },
    { value: '东北区', aliases: ['东北', '东北地区'] },
    { value: '海外', aliases: ['国外', '境外', '海外区域', '国际', 'overseas'] },
  ],
  overseas: {
    俄罗斯: '俄罗斯',
    印度: '印度',
    巴基斯坦: '巴基斯坦',
    巴西: '巴西',
    越南: '越南',
    印度尼西亚: '印度尼西亚',
    印尼: '印度尼西亚',
    土耳其: '土耳其',
    伊朗: '伊朗',
    哈萨克斯坦: '哈萨克斯坦',
    南亚区域: '',
    南亚: '',
    东南亚: '',
    中东: '',
    欧洲: '',
    中亚: '',
  },
};

/** 地址里的国家线索（中英文城市/省邦/国名） */
const COUNTRY_HINTS: Array<[RegExp, string]> = [
  [/india|mumbai|bombay|delhi|gujarat|maharashtra|hazira|surat|thane|chennai|kolkata|bangalore|bengaluru|pune|印度/i, '印度'],
  [/pakistan|karachi|lahore|islamabad|巴基斯坦/i, '巴基斯坦'],
  [/russia|moscow|cherepovets|vologda|magnitogorsk|lipetsk|samara|volgograd|chelyabinsk|俄罗斯|莫斯科|切列波维茨|马格尼托哥尔斯克|萨马拉|伏尔加格勒|卡姆斯克|卡缅斯克/i, '俄罗斯'],
  [/brazil|santa catarina|são paulo|sao paulo|rio de janeiro|minas gerais|巴西/i, '巴西'],
  [/vietnam|viet nam|hanoi|ho chi minh|越南/i, '越南'],
  [/indonesia|jakarta|印尼|印度尼西亚/i, '印度尼西亚'],
  [/turkey|türkiye|istanbul|ankara|土耳其/i, '土耳其'],
  [/iran|tehran|伊朗/i, '伊朗'],
  [/kazakhstan|almaty|哈萨克斯坦/i, '哈萨克斯坦'],
  [/uzbekistan|tashkent|乌兹别克/i, '乌兹别克斯坦'],
  [/thailand|bangkok|泰国/i, '泰国'],
  [/malaysia|kuala lumpur|马来西亚/i, '马来西亚'],
  [/egypt|cairo|埃及/i, '埃及'],
  [/saudi|riyadh|jeddah|沙特/i, '沙特阿拉伯'],
  [/emirates|dubai|abu dhabi|阿联酋|迪拜/i, '阿联酋'],
  [/mexico|méxico|墨西哥/i, '墨西哥'],
  [/korea|seoul|韩国/i, '韩国'],
  [/japan|tokyo|osaka|日本/i, '日本'],
  [/germany|deutschland|德国/i, '德国'],
  [/italy|italia|意大利/i, '意大利'],
  [/united states|usa|u\.s\.a|美国/i, '美国'],
];

export async function loadRegionDict(manager: { createQueryBuilder: () => any }): Promise<RegionDict> {
  try {
    const row = await manager
      .createQueryBuilder()
      .select('c.value', 'value')
      .from('system_configs', 'c')
      .where('c.key = :k', { k: REGION_DICT_KEY })
      .getRawOne();
    return parseRegionDict(row?.value);
  } catch {
    return DEFAULT_REGION_DICT;
  }
}

export function parseRegionDict(raw?: string | null): RegionDict {
  if (!raw) return DEFAULT_REGION_DICT;
  try {
    const d = JSON.parse(raw);
    const regions = Array.isArray(d?.regions)
      ? d.regions
          .filter((r: any) => r && typeof r.value === 'string' && r.value.trim())
          .map((r: any) => ({ value: r.value.trim(), aliases: (Array.isArray(r.aliases) ? r.aliases : []).map((a: any) => String(a).trim()).filter(Boolean) }))
      : DEFAULT_REGION_DICT.regions;
    const overseas = d?.overseas && typeof d.overseas === 'object' ? d.overseas : DEFAULT_REGION_DICT.overseas;
    return { regions: regions.length ? regions : DEFAULT_REGION_DICT.regions, overseas };
  } catch {
    return DEFAULT_REGION_DICT;
  }
}

export function inferCountry(address?: string | null): string | null {
  const a = String(address || '');
  if (!a.trim()) return null;
  for (const [re, country] of COUNTRY_HINTS) if (re.test(a)) return country;
  return null;
}

export interface RegionNormalization {
  region: string | null;
  country: string | null;
  /** ok=已是标准值；alias=别名归并；overseas=国家/片区归海外；unknown=字典里没有（原样保留）；empty=没填 */
  status: 'ok' | 'alias' | 'overseas' | 'unknown' | 'empty';
}

export function normalizeRegion(raw: string | null | undefined, dict: RegionDict = DEFAULT_REGION_DICT, address?: string | null): RegionNormalization {
  const v = String(raw ?? '').trim();
  if (!v) return { region: null, country: null, status: 'empty' };
  const overseasValue = dict.regions.find((r) => r.value === '海外')?.value || '海外';
  const lower = v.toLowerCase();
  for (const r of dict.regions) {
    if (r.value === v) {
      return { region: r.value, country: r.value === overseasValue ? inferCountry(address) : null, status: 'ok' };
    }
  }
  for (const r of dict.regions) {
    if (r.aliases.some((a) => a.toLowerCase() === lower)) {
      return { region: r.value, country: r.value === overseasValue ? inferCountry(address) : null, status: 'alias' };
    }
  }
  if (Object.prototype.hasOwnProperty.call(dict.overseas, v)) {
    const c = dict.overseas[v] || inferCountry(address) || null;
    return { region: overseasValue, country: c, status: 'overseas' };
  }
  return { region: v, country: null, status: 'unknown' };
}
