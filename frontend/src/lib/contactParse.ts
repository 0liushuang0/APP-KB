/**
 * 从名片 / 邮件签名 / 聊天记录里粘贴的文字识别联系人。
 *
 * 实测 209 家客户只有 2 条联系人 —— 不是没有联系人，是一个个字段手敲太费事。
 * 这里按常见格式拆字段，识别结果只填进表单由人确认，不直接保存。
 * 多个联系人用空行分隔。纯本地规则，不调 AI、不上传。
 */
export interface ParsedContact {
  name: string
  title?: string
  department?: string
  phone?: string
  email?: string
  wechat?: string
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/
const MOBILE_CN = /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d[-\s]?\d{4}[-\s]?\d{4}(?!\d)/
const PHONE_INTL = /\+\d{1,3}[\s-]?(?:\(?\d{1,4}\)?[\s-]?){2,5}\d{2,4}/
const LANDLINE = /(?<!\d)0\d{2,3}[-\s]?\d{7,8}(?:[-\s转]\d{1,5})?(?!\d)/
const TITLE_WORDS =
  /(董事长|总经理|副总经理|总裁|副总|总监|经理|主管|主任|部长|厂长|副厂长|总工程师|高级工程师|工程师|技术员|采购|销售|助理|专员|Manager|Director|Engineer|President|CEO|CTO|Purchasing|Sales|Buyer)/i
const DEPT = /([一-龥]{2,10}(?:部|处|科|中心|车间|分厂|事业部))/
const LABEL = (k: string) => new RegExp(`(?:${k})\\s*[:：]\\s*(.+)`, 'i')

const clean = (s?: string) => (s || '').replace(/\s+/g, ' ').trim()
const digits = (s: string) => s.replace(/[^\d+]/g, '')

function parseBlock(block: string): ParsedContact | null {
  const lines = block
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (!lines.length) return null
  const text = lines.join('\n')
  const c: ParsedContact = { name: '' }

  c.email = text.match(EMAIL)?.[0]
  const mobile = text.match(MOBILE_CN)?.[0]
  const intl = text.match(PHONE_INTL)?.[0]
  const land = text.match(LANDLINE)?.[0]
  const phone = mobile || intl || land
  if (phone) c.phone = mobile ? digits(mobile).replace(/^\+?86/, '') : clean(phone)

  const wechat = text.match(LABEL('微信|WeChat|wx'))?.[1]
  if (wechat) c.wechat = clean(wechat.split(/[\s,，;；]/)[0])

  // 姓名: 先找「姓名/联系人/Name:」标签, 再找单独一行的 2-4 个汉字, 再找英文名行
  const labeled = text.match(LABEL('姓名|联系人|Name|Contact'))?.[1]
  if (labeled) {
    c.name = clean(labeled.split(/[\s,，;；(（]/)[0])
  } else {
    const cjk = lines.find((l) => /^[一-龥]{2,4}$/.test(l) && !TITLE_WORDS.test(l) && !DEPT.test(l))
    const cjkWithTitle = lines.map((l) => l.match(/^([一-龥]{2,4})[\s|｜/／,，]+/)).find(Boolean)
    const en = lines.find((l) => /^[A-Z][a-z]+(?:\s[A-Z][a-z]+){1,2}$/.test(l))
    c.name = cjk || cjkWithTitle?.[1] || en || ''
  }

  const titleLine = text.match(LABEL('职务|职位|Title|Position'))?.[1] || lines.find((l) => TITLE_WORDS.test(l) && !EMAIL.test(l))
  if (titleLine) {
    const t = clean(titleLine.replace(c.name, '').replace(/^[|｜/／,，\s]+/, ''))
    const m = t.match(new RegExp(`[^,，;；|｜]*${TITLE_WORDS.source}[^,，;；|｜]*`, 'i'))
    c.title = clean(m?.[0] || t).slice(0, 30)
  }
  const dept = text.match(LABEL('部门|Department|Dept'))?.[1] || text.match(DEPT)?.[1]
  if (dept) c.department = clean(dept).slice(0, 30)

  // 什么都没认出来就不算一个联系人
  if (!c.name && !c.phone && !c.email) return null
  if (!c.name && c.email) c.name = c.email.split('@')[0]
  return c
}

export function parseContacts(input: string): ParsedContact[] {
  return (input || '')
    .split(/\n\s*\n/)
    .map(parseBlock)
    .filter((c): c is ParsedContact => !!c)
}
