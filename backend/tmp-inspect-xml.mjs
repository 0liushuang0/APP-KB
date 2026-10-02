import { readFileSync } from 'fs';
const base = 'd:/New-Project/AI_ML_Project/08AI-Knowledge-Base/backend/tmp-docx/word';
const h = readFileSync(`${base}/header1.xml`, 'utf8');
console.log('图片尺寸(emu):', h.match(/<wp:extent[^>]*\/>/)?.[0]);
console.log('header对齐:', [...h.matchAll(/<w:jc w:val="([^"]+)"/g)].map((m) => m[1]));
console.log('header字号(半磅):', [...h.matchAll(/<w:sz w:val="(\d+)"/g)].map((m) => m[1]));
console.log('header字体:', [...h.matchAll(/<w:rFonts[^>]*>/g)].map((m) => m[0]).slice(0, 4));

const d = readFileSync(`${base}/document.xml`, 'utf8');
const body = d.slice(d.indexOf('<w:body>'));
// 前 6 个段落的关键属性
const paras = body.split(/<w:p[ >]/).slice(1, 8);
paras.forEach((p, i) => {
  const text = [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
  const sz = [...p.matchAll(/<w:sz w:val="(\d+)"/g)].map((m) => m[1]);
  const jc = p.match(/<w:jc w:val="([^"]+)"/)?.[1] || '';
  const bold = p.includes('<w:b/>');
  const underline = p.includes('<w:u ');
  console.log(`段落${i}: [${text.slice(0, 40)}] 字号:${[...new Set(sz)]} 对齐:${jc} 加粗:${bold} 下划线:${underline}`);
});
// 全文档下划线使用统计
console.log('下划线 run 数:', (d.match(/<w:u /g) || []).length);
console.log('正文总段落数:', (d.match(/<w:p[ >]/g) || []).length);
