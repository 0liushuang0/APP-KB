/**
 * 方案 → 报价：按需求的产品类型从产品库带出报价明细（纯函数，可测）。
 *
 * 规则全部可解释，不靠"AI 猜"：
 *  1. 需求产品类型的最后一级按「+」拆开（如 装备/剪切设备/圆盘剪+碎边剪 → 圆盘剪、碎边剪），
 *     每一项到产品库找同一前缀、同一末级分类的产品；
 *  2. 同类有多个时，用"产品名的两字片段在需求标题/方案标题里出现了多少"打分
 *     （两弯两矫拉矫机 对 CGL-两弯两矫1450湿式拉矫机 = 83%，两弯一矫拉矫机 = 50%），
 *     最高分唯一且 ≥ 60% 才选中，否则这一行留给人选（给出候选）；
 *  3. 价格取型号价格表里与需求规格（如 1450）对得上的型号的销售价 → 标配价 → 参考价，
 *     没有价格表就用产品参考价；都没有时单价留 0 并标出"缺价"。
 */
export interface DraftProduct {
  id: string;
  name: string;
  category?: string | null;
  price?: any;
  unit?: string | null;
  priceList?: Array<{ model?: string; spec?: string; salePrice?: number; standardPrice?: number; referencePrice?: number; unit?: string }> | null;
}

export interface DraftItem {
  name: string;
  productId?: string;
  specification?: string;
  quantity: number;
  unitPrice: number;
  unit?: string;
  /** 为什么带出这一行（给人看） */
  reason: string;
  /** 没选定时的候选产品名 */
  candidates?: string[];
  priceMissing?: boolean;
}

const cjk = (s: string) => (s || '').replace(/[（(][^）)]*[）)]/g, '').replace(/[^一-龥]/g, '');

export function bigramScore(name: string, text: string): number {
  const n = cjk(name);
  if (n.length < 2) return 0;
  const grams = new Set<string>();
  for (let i = 0; i < n.length - 1; i++) grams.add(n.slice(i, i + 2));
  const t = cjk(text);
  let hit = 0;
  for (const g of grams) if (t.includes(g)) hit++;
  return hit / grams.size;
}

function pickPrice(p: DraftProduct, text: string): { unitPrice: number; spec?: string } {
  const list = Array.isArray(p.priceList) ? p.priceList.filter((m) => m?.model) : [];
  const priced = (m: any) => Number(m.salePrice ?? m.standardPrice ?? m.referencePrice) || 0;
  const byModel = list.find((m) => String(m.model).length >= 2 && text.includes(String(m.model)));
  if (byModel) return { unitPrice: priced(byModel), spec: byModel.model };
  if (list.length === 1) return { unitPrice: priced(list[0]), spec: list[0].model };
  return { unitPrice: Number(p.price) || 0 };
}

export function draftItems(
  input: { category?: string | null; text: string },
  products: DraftProduct[],
): DraftItem[] {
  const text = input.text || '';
  const items: DraftItem[] = [];
  const used = new Set<string>();
  const cat = (input.category || '').trim();

  const choose = (cands: DraftProduct[], label: string, why: string) => {
    if (!cands.length) return;
    const scored = cands.map((p) => ({ p, s: bigramScore(p.name, text) })).sort((a, b) => b.s - a.s);
    const top = scored[0];
    const unique = scored.length === 1 || top.s > scored[1].s;
    if (cands.length === 1 || (unique && top.s >= 0.6)) {
      if (used.has(top.p.id)) return;
      used.add(top.p.id);
      const price = pickPrice(top.p, text);
      items.push({
        name: top.p.name,
        productId: top.p.id,
        specification: price.spec,
        quantity: 1,
        unitPrice: price.unitPrice,
        unit: top.p.unit || '台',
        reason: cands.length === 1 ? why : `${why}，名称匹配度 ${Math.round(top.s * 100)}%`,
        priceMissing: !price.unitPrice,
      });
    } else {
      items.push({
        name: label,
        quantity: 1,
        unitPrice: 0,
        unit: '台',
        reason: `${why}，同类有 ${cands.length} 个产品，请选定`,
        candidates: scored.map((x) => x.p.name),
        priceMissing: true,
      });
    }
  };

  if (cat.includes('/')) {
    const segs = cat.split('/');
    const prefix = segs.slice(0, -1).join('/');
    const parts = segs[segs.length - 1].split('+').map((x) => x.trim()).filter(Boolean);
    for (const part of parts) {
      const cands = products.filter((p) => (p.category || '') === `${prefix}/${part}`);
      choose(cands, part, `需求产品类型「${part}」`);
    }
  }
  if (!items.length) {
    // 没有产品类型或类型下没货：退到全库按名称打分，只收高匹配
    const strong = products
      .map((p) => ({ p, s: bigramScore(p.name, text) }))
      .filter((x) => x.s >= 0.75)
      .sort((a, b) => b.s - a.s)
      .slice(0, 3);
    for (const { p, s } of strong) {
      if (used.has(p.id)) continue;
      used.add(p.id);
      const price = pickPrice(p, text);
      items.push({
        name: p.name,
        productId: p.id,
        specification: price.spec,
        quantity: 1,
        unitPrice: price.unitPrice,
        unit: p.unit || '台',
        reason: `名称匹配度 ${Math.round(s * 100)}%`,
        priceMissing: !price.unitPrice,
      });
    }
  }
  return items;
}
