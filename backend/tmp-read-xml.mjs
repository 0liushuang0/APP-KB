// 提取 header/footer 文本（UTF-8 输出）+ 检查页眉图片引用
import { readFileSync, readdirSync, writeFileSync } from 'fs';

const base = 'd:/New-Project/AI_ML_Project/08AI-Knowledge-Base/backend/tmp-docx/word';

function extract(xml) {
  // 按段落切分，取每段内所有 w:t 文本
  const paras = xml.split(/<w:p[ >]/).slice(1);
  const lines = [];
  for (const p of paras) {
    const texts = [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);
    // 表格单元格分隔
    const cellCount = (p.match(/<w:tc[ >]/g) || []).length;
    let line = texts.join('');
    if (cellCount > 1) {
      // 粗略按单元格重切
      const cells = p.split(/<w:tc[ >]/).slice(1).map((c) =>
        [...c.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(''),
      );
      line = cells.join(' | ');
    }
    if (line.trim()) lines.push(line);
    else if (p.includes('<w:drawing') || p.includes('<w:pict')) lines.push('[图片/图形]');
  }
  return lines.join('\n');
}

for (const name of ['header1.xml', 'footer1.xml', 'document.xml']) {
  try {
    const xml = readFileSync(`${base}/${name}`, 'utf8');
    const out = name === 'document.xml' ? '' : extract(xml);
    if (name !== 'document.xml') {
      writeFileSync(`d:/New-Project/AI_ML_Project/08AI-Knowledge-Base/backend/tmp-${name}.txt`, out);
      console.log(`--- ${name} ---`);
    }
    // 统计 document.xml 中的表格和图片
    if (name === 'document.xml') {
      console.log('document.xml 表格数:', (xml.match(/<w:tbl>/g) || []).length);
      console.log('document.xml 图片数:', (xml.match(/<w:drawing>/g) || []).length);
      // 页面设置
      const sect = xml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/);
      if (sect) console.log('sectPr:', sect[0].replace(/>\s*</g, '>\n<').slice(0, 1500));
    }
  } catch (e) {
    console.log(name, '不存在或读取失败');
  }
}
console.log('media 目录:', readdirSync(`${base}/media`));
