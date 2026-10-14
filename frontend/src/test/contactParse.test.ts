import { describe, expect, it } from 'vitest'
import { parseContacts } from '../lib/contactParse'

describe('parseContacts', () => {
  it('parses a Chinese business card', () => {
    const [c] = parseContacts(`张伟
设备部 副部长
手机：138 1234 5678
邮箱：zhangwei@baosteel.com
微信：zw_baosteel`)
    expect(c).toMatchObject({ name: '张伟', phone: '13812345678', email: 'zhangwei@baosteel.com', wechat: 'zw_baosteel', department: '设备部' })
    expect(c.title).toContain('部长')
  })

  it('parses an email signature with name and title on one line', () => {
    const [c] = parseContacts(`Best regards
李娜 | 采购经理
Tel: 021-12345678
lina@company.cn`)
    expect(c).toMatchObject({ name: '李娜', phone: '021-12345678', email: 'lina@company.cn' })
    expect(c.title).toContain('采购经理')
  })

  it('parses an English signature with international phone', () => {
    const [c] = parseContacts(`Rajesh Kumar
Purchasing Manager
+91 22 1234 5678
rajesh.kumar@jsw.in`)
    expect(c).toMatchObject({ name: 'Rajesh Kumar', email: 'rajesh.kumar@jsw.in' })
    expect(c.phone).toContain('+91')
    expect(c.title).toMatch(/Manager/)
  })

  it('splits multiple contacts by blank lines and uses labels when present', () => {
    const list = parseContacts(`姓名：王强
职务：技术总监
电话：13900001111

联系人：赵敏（销售）
邮箱 zhaomin@a.com
手机 13700002222`)
    expect(list.map((c) => c.name)).toEqual(['王强', '赵敏'])
    expect(list[0].title).toBe('技术总监')
    expect(list[1].phone).toBe('13700002222')
  })

  it('ignores text without any contact info', () => {
    expect(parseContacts('请尽快报价，谢谢\n\n')).toEqual([])
  })
})
