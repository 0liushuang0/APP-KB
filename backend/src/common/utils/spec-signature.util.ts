/**
 * 规格签名：把一组 {name,value} 规格归一化后拼成稳定字符串，
 * 用于跨供应商匹配"同规格"外购件（物料主档 ↔ 供应产品）。
 *
 * 归一化要解决的是"同一种规格写法不一"：
 *   "Φ100" / "φ100" / "Φ 100" / "PHI100"
 *   "200mm" / "200 mm" / "200MM"
 *   "行程 200" / "行程200"
 * 都应得到同一段。这里做：全角→半角、希腊字母统一、大小写统一、去空白。
 */
export interface SpecItem {
  name: string;
  value: string;
}

function normalize(s: string): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .trim()
    // 全角→半角（数字字母及空格）
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    // 希腊字母统一小写（Φ/φ/ϕ → φ）
    .replace(/[Φϕ]/g, 'φ')
    .toLowerCase()
    // 去掉所有空白（"200 mm" → "200mm"、"缸 径" → "缸径"）
    .replace(/\s+/g, '');
}

/**
 * 计算规格签名。空规格返回空串（不参与匹配）。
 * 例：[{name:'缸径',value:'Φ100'},{name:'行程',value:'200mm'}]
 *     → '缸径=φ100|行程=200mm'（按 name 排序，保证顺序无关）
 */
export function computeSpecSignature(specs: SpecItem[] | null | undefined): string {
  if (!Array.isArray(specs) || specs.length === 0) return '';
  const parts = specs
    .filter((s) => s && s.name)
    .map((s) => `${normalize(s.name)}=${normalize(s.value ?? '')}`)
    .sort();
  return parts.join('|');
}
