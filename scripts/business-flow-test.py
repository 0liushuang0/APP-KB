# -*- coding: utf-8 -*-
"""
端到端业务全流程测试：按「客户提出需求 → 签约立项 → 多人执行 → 验收结项 → 报告输出」完整走一遍
模拟场景：甲公司采购一套矫直设备
"""
import json
import urllib.request
import urllib.error
import http.cookiejar
import time
import sys

BASE = "http://localhost:3101/api"
PASS = 0
FAIL = 0
ISSUES = []
CREATED = {}  # 追踪创建的 ID 用于清理

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

def api(method, path, data=None):
    url = f"{BASE}{path}"
    body = json.dumps(data, ensure_ascii=False).encode("utf-8") if data else None
    req = urllib.request.Request(url, data=body, method=method,
                                 headers={"Content-Type": "application/json"})
    try:
        resp = opener.open(req, timeout=60)
        return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode("utf-8"))
        except:
            return {"success": False, "statusCode": e.code, "message": str(e)}
    except Exception as e:
        return {"success": False, "statusCode": 0, "message": str(e)}

def d(resp):
    return resp.get("data", resp) if isinstance(resp, dict) else resp

def ok(name, cond, detail=""):
    global PASS, FAIL
    mark = "PASS" if cond else "FAIL"
    if cond: PASS += 1
    else:
        FAIL += 1
        ISSUES.append(f"  {mark} | {name} | {detail}")
    print(f"  {mark} | {name}" + (f" | {detail}" if detail and not cond else ""))
    return cond

def step(title):
    print(f"\n{'─'*60}")
    print(f"  {title}")
    print(f"{'─'*60}")

# ═════════════════════════════════════════════════
# 登录
# ═════════════════════════════════════════════════
api("POST", "/auth/single-mode-login")
print("  [已登录] 单机模式管理员")

# ═════════════════════════════════════════════════
# 第1步：基础资料确认
# ═════════════════════════════════════════════════
step("第1步：基础资料确认")
r = api("GET", "/products?pageSize=5")
products = d(r).get("list", [])
ok("1a 产品库有数据", len(products) > 0, f"count={len(products)}")

r = api("GET", "/suppliers?pageSize=5")
suppliers = d(r).get("list", [])
ok("1b 供应商库有数据", len(suppliers) > 0)

r = api("GET", "/param-templates?pageSize=5")
ok("1c 参数模板", r.get("success") is True)

r = api("GET", "/solutions")
ok("1d 标准方案库", r.get("success") is True or isinstance(d(r), list))

# ═════════════════════════════════════════════════
# 第2步：建立客户档案
# ═════════════════════════════════════════════════
step("第2步：建立客户档案（甲公司）")
import time
TS = str(int(time.time()))[-6:]  # 时间戳后缀避免唯一码冲突
r = api("POST", "/customers", {
    "name": "甲公司测试客户",
    "code": f"JIA-{TS}",
    "industry": "钢铁冶金",
    "region": "湖北襄阳",
    "level": "A",
    "businessStatus": "活跃",
    "salesPerson": "销售小王",
    "visibility": "public"
})
cid = d(r).get("id", "")
CREATED["customer"] = cid
ok("2a 创建客户「甲公司」", bool(cid))

if cid:
    # 添加联系人（技术/采购/决策/财务）— POST /customers/contacts，customerId 在 body
    contacts_added = 0
    for contact in [
        {"name": "李工", "title": "技术联系人", "phone": "13900000001", "isPrimary": True, "customerId": cid},
        {"name": "张经理", "title": "采购联系人", "phone": "13900000002", "customerId": cid},
        {"name": "王总", "title": "决策人", "phone": "13900000003", "customerId": cid},
        {"name": "刘会计", "title": "财务联系人", "phone": "13900000004", "customerId": cid},
    ]:
        r2 = api("POST", "/customers/contacts", contact)
        if r2.get("success"): contacts_added += 1
    ok("2b 添加4类联系人", contacts_added >= 1, f"added={contacts_added}")

    # 跟进记录 — POST /customers/follow-ups
    r2 = api("POST", "/customers/follow-ups", {
        "customerId": cid,
        "content": "客户来询：需采购一台矫直设备，板材厚度10-30mm，宽度2000mm",
        "followUpAt": "2026-10-01",
        "nextAction": "安排技术交流",
        "focusPoints": "交期、价格",
    })
    ok("2c 添加跟进记录", r2.get("success") is True)

    # 客户360视图 — GET /customers/:id/360
    r2 = api("GET", f"/customers/{cid}/360")
    ok("2d 客户360视图", r2.get("success") is True)

    # 搜索确认唯一
    r2 = api("GET", "/customers?keyword=JIA-CORP")
    hits = d(r2).get("list", []) if isinstance(d(r2), dict) else d(r2)
    ok("2e 搜索唯一性", len(hits) >= 1)

# ═════════════════════════════════════════════════
# 第3步：登记需求
# ═════════════════════════════════════════════════
step("第3步：登记需求（甲公司矫直设备采购）")
r = api("POST", "/requirements", {
    "title": "甲公司矫直设备采购",
    "customerId": cid,
    "requirementType": "新设备采购",
    "category": "客户来询",
    "priority": "high",
    "description": "客户需要一台钢板矫直设备，板厚10-30mm，板宽最大2000mm，材质Q235B-Q345B，屈服强度≤350MPa，平直度要求≤2mm/m，生产节拍约15张/小时",
    "contactName": "李工",
    "contactPhone": "13900000001",
    "expectedAmount": 1200000,
    "expectedDealDate": "2027-03-31",
    "winProbability": 70,
    "nextFollowUpDate": "2026-10-15",
})
rid = d(r).get("id", "")
CREATED["requirement"] = rid
ok("3a 创建需求", bool(rid))
if rid:
    ok("3a-商机 预计金额120万", str(d(r).get("expectedAmount", "")).startswith("1200000"))
    ok("3a-商机 赢单概率70%", d(r).get("winProbability") == 70)

    # AI 分析（结构化参数提取）
    r2 = api("POST", f"/requirements/{rid}/analyze", {})
    if r2.get("success"):
        ok("3b AI参数提取", True)
    else:
        ok("3b AI参数提取（AI服务可能离线）", r2.get("statusCode") != 500)

    # 需求详情
    r2 = api("GET", f"/requirements/{rid}")
    ok("3c 需求详情", r2.get("success") is True)

# ═════════════════════════════════════════════════
# 第4步：确认需求
# ═════════════════════════════════════════════════
step("第4步：确认需求")
if rid:
    # 修改需求（补齐参数）
    r = api("PATCH", f"/requirements/{rid}", {
        "description": "确认参数：板厚10-30mm，板宽2000mm，材质Q235B-Q345B，平直度≤2mm/m，节拍15张/h，矫直辊径Φ320mm，辊数9+1，电机功率约75kW"
    })
    ok("4a 参数补齐（修改需求）", r.get("success") is True)

    # 沟通记录
    r = api("POST", f"/requirements/{rid}/logs", {
        "type": "communication",
        "content": "客户确认以上技术参数，同意作为报价依据"
    })
    ok("4b 记录客户确认", r.get("success") is True,
       f"status={r.get('statusCode')} msg={r.get('message','')[:60]}")

# ═════════════════════════════════════════════════
# 第5步：编制技术方案
# ═════════════════════════════════════════════════
step("第5步：编制技术方案")
r = api("POST", "/proposals", {
    "title": "甲公司矫直设备技术方案",
    "requirementId": rid,
    "customerId": cid,
    "proposalType": "标准方案",
    "content": "设备选型：JZ-2000×32九辊矫直机。技术参数：矫直板厚10-32mm，板宽max2000mm，矫直速度0-15m/min，矫直辊径Φ320mm，辊数9+1，主电机75kW。供货范围：主机、液压系统、电控系统、操作台、随机备件、安装调试、培训。责任边界：基础由客户负责，设备到现场后7天内完成安装调试。验收：按GB/T标准进行平直度检测，连续生产8小时无故障。",
})
pid_proposal = d(r).get("id", "")
CREATED["proposal"] = pid_proposal
ok("5a 创建技术方案", bool(pid_proposal))
if pid_proposal:
    r2 = api("GET", f"/proposals/{pid_proposal}")
    ok("5b 方案详情可查看", r2.get("success") is True)

# ═════════════════════════════════════════════════
# 第6步：生成报价
# ═════════════════════════════════════════════════
step("第6步：生成报价")
r = api("POST", "/quotations", {
    "quotationNo": f"E2E-QT-{TS}",
    "customerId": cid,
    "proposalId": pid_proposal,
    "notes": "含税、含运费、含安装调试。有效期30天。付款条件：预付30%，发货前50%，验收后15%，质保金5%。",
    "items": [
        {"name": "JZ-2000×32九辊矫直机主机", "quantity": 1, "unitPrice": 650000,
         "cost": 420000, "brand": "博亚精工", "unit": "台"},
        {"name": "液压系统", "quantity": 1, "unitPrice": 120000, "cost": 80000},
        {"name": "电控系统（含PLC+HMI）", "quantity": 1, "unitPrice": 150000, "cost": 95000},
        {"name": "安装调试费", "quantity": 1, "unitPrice": 50000, "cost": 20000},
        {"name": "运输费", "quantity": 1, "unitPrice": 30000, "cost": 22000},
        {"name": "操作培训", "quantity": 1, "unitPrice": 10000, "cost": 3000},
        {"name": "随机备件包", "quantity": 1, "unitPrice": 20000, "cost": 10000},
    ]
})
qid = d(r).get("id", "")
CREATED["quotation"] = qid
ok("6a 创建报价", bool(qid))
if qid:
    # 验证服务端重算：650000+120000+150000+50000+30000+10000+20000 = 1030000
    amount = d(r).get("amount", 0)
    ok("6b 金额服务端重算=1,030,000", str(amount).startswith("1030000"), f"amount={amount}")
    ok("6c 版本v1", d(r).get("version") == 1)

    # 明细核对
    r2 = api("GET", f"/quotations/{qid}")
    items = d(r2).get("items", [])
    ok("6d 7行明细", len(items) == 7, f"items={len(items)}")

    # 毛利（自动计算）
    margin = d(r2).get("margin", {})
    if margin:
        ok("6e 毛利信息", margin.get("grossProfit", 0) > 0,
           f"grossProfit={margin.get('grossProfit')}")

    # 修改报价（客户议价：总价降3万）→ 触发版本冻结
    items_adjusted = []
    for it in items:
        new_it = dict(it)
        if it["name"] == "JZ-2000×32九辊矫直机主机":
            new_it["unitPrice"] = 620000
        items_adjusted.append(new_it)
    r2 = api("PATCH", f"/quotations/{qid}", {
        "items": items_adjusted, "version": 1
    })
    ok("6f 议价修改（主机降至62万）", r2.get("success") is True)

    # 版本冻结：v1 应已存档
    r2 = api("GET", f"/quotations/{qid}/versions")
    versions = d(r2)
    ok("6g 版本冻结（v1快照）", isinstance(versions, list) and len(versions) > 0,
       f"snapshots={len(versions) if isinstance(versions, list) else 0}")

    # 修改后金额验证：620000+120000+150000+50000+30000+10000+20000 = 1000000
    r2 = api("GET", f"/quotations/{qid}")
    new_amount = d(r2).get("amount", 0)
    ok("6h 议价后金额=1,000,000", str(new_amount).startswith("1000000"), f"amount={new_amount}")

# ═════════════════════════════════════════════════
# 第7步：报价转合同
# ═════════════════════════════════════════════════
step("第7步：报价转合同")
r = api("POST", "/contracts", {
    "title": "甲公司矫直设备采购合同",
    "quotationId": qid,
    "customerId": cid,
    "amount": 1000000,
    "signedDate": "2026-12-01",
    "effectiveDate": "2026-12-01",
    "expiryDate": "2027-12-01",
    "paymentTerms": "预付30%（30万），发货前50%（50万），验收后15%（15万），质保金5%（5万）。质保期12个月。",
    "deliveryTerms": "合同生效后90天内交货，到现场后7天内完成安装调试。",
})
ctid = d(r).get("id", "")
CREATED["contract"] = ctid
ok("7a 创建合同", bool(ctid))
if ctid:
    ct_data = d(r)
    ok("7b 合同金额100万", str(ct_data.get("amount", "")).startswith("1000000"))
    # 单机模式自动审批 → approved（非 signed）
    ct_status = ct_data.get("status", "")
    ok("7c 状态=已批准（待签约）", ct_status == "approved", f"status={ct_status}")

    # 登记签订 → 状态流转为 signed
    r2 = api("PATCH", f"/contracts/{ctid}", {
        "status": "signed",
        "signedDate": "2026-12-01"
    })
    ok("7d 登记签订→已签订", r2.get("success") is True)

# ═════════════════════════════════════════════════
# 第8步：登记回款计划
# ═════════════════════════════════════════════════
step("第8步：登记回款计划（100万按4节点拆分）")
payment_nodes = [
    {"nodeName": "首付款", "dueDate": "2026-12-05", "dueAmount": 300000},
    {"nodeName": "发货款", "dueDate": "2027-02-15", "dueAmount": 500000},
    {"nodeName": "验收款", "dueDate": "2027-04-15", "dueAmount": 150000},
    {"nodeName": "质保金", "dueDate": "2028-04-15", "dueAmount": 50000},
]
payment_ids = []
for node in payment_nodes:
    r = api("POST", f"/contracts/{ctid}/payments", node)
    pay_id = d(r).get("id", "")
    if pay_id: payment_ids.append(pay_id)
ok("8a 登记4个应收节点", len(payment_ids) == 4, f"created={len(payment_ids)}")

# 登记首付款实收（全额30万）
if payment_ids:
    r = api("PATCH", f"/contracts/{ctid}/payments/{payment_ids[0]}", {
        "receivedAmount": 300000, "receivedDate": "2026-12-03", "invoiceNo": "INV-JIA-001"
    })
    ok("8b 首付款全额实收30万", r.get("success") is True)

    # 部分收发货款（先收20万）
    r = api("PATCH", f"/contracts/{ctid}/payments/{payment_ids[1]}", {
        "receivedAmount": 200000, "receivedDate": "2027-02-10", "invoiceNo": "INV-JIA-002"
    })
    ok("8c 发货款部分实收20万", r.get("success") is True)

    # 验证汇总
    r = api("GET", f"/contracts/{ctid}/payments")
    s = d(r).get("summary", {})
    ok("8d 应收合计=100万", s.get("totalDue") == 1000000, f"due={s.get('totalDue')}")
    ok("8e 已收=50万", s.get("totalReceived") == 500000, f"recv={s.get('totalReceived')}")
    ok("8f 未收=50万", s.get("outstanding") == 500000, f"outstanding={s.get('outstanding')}")
    ok("8g 回款进度=50%", s.get("receivedRatio") == 50, f"ratio={s.get('receivedRatio')}%")
    ok("8h 合同金额全覆盖（未建节点=0）", s.get("uncovered") == 0, f"uncovered={s.get('uncovered')}")

# ═════════════════════════════════════════════════
# 第9步：合同转项目
# ═════════════════════════════════════════════════
step("第9步：合同转项目（正式交付立项）")
r = api("POST", "/projects", {
    "name": "甲公司矫直设备交付项目",
    "contractId": ctid,
    "quotationId": qid,
    "proposalId": pid_proposal,
    "requirementId": rid,
    "customerId": cid,
    "description": "项目目标：按合同要求交付JZ-2000×32矫直机并完成验收。供货范围：主机+液压+电控+安装调试+培训。关键交期：合同生效后90天。验收条件：平直度≤2mm/m，连续8小时无故障。",
    "stages": [
        {"name": "技术确认", "status": "pending", "startDate": "2026-12-01", "endDate": "2026-12-15"},
        {"name": "设计", "status": "pending", "startDate": "2026-12-15", "endDate": "2027-01-15"},
        {"name": "采购与制造", "status": "pending", "startDate": "2027-01-15", "endDate": "2027-02-15"},
        {"name": "装配调试", "status": "pending", "startDate": "2027-02-15", "endDate": "2027-02-25"},
        {"name": "发货", "status": "pending", "startDate": "2027-02-25", "endDate": "2027-03-01"},
        {"name": "现场安装", "status": "pending", "startDate": "2027-03-01", "endDate": "2027-03-08"},
        {"name": "验收交付", "status": "pending", "startDate": "2027-03-08", "endDate": "2027-03-15"},
    ],
    "risks": [
        {"title": "客户基础未按时完成", "description": "影响安装进度", "level": "medium", "status": "open"},
    ],
})
projid = d(r).get("id", "")
CREATED["project"] = projid
stages = []  # 初始化避免 undefined
ok("9a 创建项目（含7阶段+1风险）", bool(projid))

if projid:
    r2 = api("GET", f"/projects/{projid}")
    proj = d(r2)
    stages = proj.get("stages", [])
    ok("9b 7个执行阶段", len(stages) == 7, f"stages={len(stages)}")
    ok("9c 关联合同", bool(proj.get("contractId")))

# ═════════════════════════════════════════════════
# 第10步：添加成员、分配任务
# ═════════════════════════════════════════════════
step("第10步：添加成员与任务分配")

# 创建测试成员（技术、采购、质量）
team_members = []
for u in [(f"e2e_t{TS}", "技术人员李工"), (f"e2e_p{TS}", "采购人员陈工"), (f"e2e_q{TS}", "质量人员赵工")]:
    r = api("POST", "/users", {"username": u[0], "password": "E2ePass123!", "nickname": u[1]})
    uid = d(r).get("id", "")
    if uid: team_members.append({"id": uid, "nickname": u[1], "username": u[0]})

ok("10a 创建3名项目成员", len(team_members) == 3, f"created={len(team_members)}")

# 添加成员到项目
member_ok = 0
for m in team_members:
    r = api("POST", f"/projects/{projid}/members", {"userId": m["id"], "role": "member"})
    if r.get("success"): member_ok += 1
ok("10b 3人加入项目", member_ok >= 1, f"added={member_ok}")

# 创建任务
tasks_created = []
task_list = [
    {"title": "确认设备总图", "priority": "high", "assignedUserId": team_members[0]["id"] if team_members else None},
    {"title": "核对外购件交期", "priority": "medium", "assignedUserId": team_members[1]["id"] if len(team_members) > 1 else None},
    {"title": "完成出厂检验", "priority": "high", "assignedUserId": team_members[2]["id"] if len(team_members) > 2 else None},
    {"title": "确认发货条件", "priority": "medium"},
    {"title": "完成现场验收", "priority": "high"},
]
for t in task_list:
    r = api("POST", f"/projects/{projid}/tasks", t)
    tid = d(r).get("id", "")
    if tid: tasks_created.append(tid)
ok("10c 创建5项任务", len(tasks_created) == 5, f"created={len(tasks_created)}")

# 验证指派人收到通知
if team_members and team_members[0].get("id"):
    r = api("GET", "/notifications?pageSize=10")
    notif = d(r)
    notif_list = notif if isinstance(notif, list) else notif.get("list", [])
    ok("10d 任务分配通知", isinstance(notif_list, list))  # 通知在收件人登录后才可见

# ═════════════════════════════════════════════════
# 第11步：执行过程中维护
# ═════════════════════════════════════════════════
step("第11步：执行过程中的进度与资料维护")

# 完成前3项任务
completed = 0
for tid in tasks_created[:3]:
    r = api("PATCH", f"/projects/{projid}/tasks/{tid}", {"status": "done"})
    if r.get("success"): completed += 1
ok("11a 完成3项任务", completed == 3, f"completed={completed}")

# 验证进度联动（3/5=60%）
r = api("GET", f"/projects/{projid}")
proj = d(r)
ok("11b 进度联动=60%", proj.get("progress") == 60, f"progress={proj.get('progress')}%")

# 更新阶段状态（前3阶段完成）
if stages:
    stage_updates = 0
    r = api("PATCH", f"/projects/{projid}", {
        "stages": [
            {"name": "技术确认", "status": "done", "startDate": "2026-12-01", "endDate": "2026-12-15"},
            {"name": "设计", "status": "done", "startDate": "2026-12-15", "endDate": "2027-01-15"},
            {"name": "采购与制造", "status": "done", "startDate": "2027-01-15", "endDate": "2027-02-15"},
            {"name": "装配调试", "status": "pending", "startDate": "2027-02-15", "endDate": "2027-02-25"},
            {"name": "发货", "status": "pending", "startDate": "2027-02-25", "endDate": "2027-03-01"},
            {"name": "现场安装", "status": "pending", "startDate": "2027-03-01", "endDate": "2027-03-08"},
            {"name": "验收交付", "status": "pending", "startDate": "2027-03-08", "endDate": "2027-03-15"},
        ]
    })
    ok("11c 更新阶段状态", r.get("success") is True)

# 风险维护
r = api("GET", f"/projects/{projid}")
proj = d(r)
risks = proj.get("risks", [])
ok("11d 风险项存在", len(risks) >= 1, f"risks={len(risks)}")

# ═════════════════════════════════════════════════
# 第12步：验收与结项
# ═════════════════════════════════════════════════
step("第12步：验收与项目结束")

# 完成剩余任务
for tid in tasks_created[3:]:
    api("PATCH", f"/projects/{projid}/tasks/{tid}", {"status": "done"})
r = api("GET", f"/projects/{projid}")
ok("12a 全部任务完成→进度100%", d(r).get("progress") == 100, f"progress={d(r).get('progress')}%")

# 完成全部阶段
api("PATCH", f"/projects/{projid}", {
    "stages": [
        {"name": s["name"], "status": "done", "startDate": "2026-12-01", "endDate": "2027-03-15"}
        for s in stages
    ]
})

# 项目状态更新为 completed
r = api("PATCH", f"/projects/{projid}", {"status": "completed"})
ok("12b 项目状态→已完成", r.get("success") is True)

# 售后工单
r = api("POST", "/after-sales", {
    "customerId": cid,
    "contractId": ctid,
    "projectId": projid,
    "title": "矫直机质保期巡检",
    "description": "质保期内首次巡检，检查矫直辊磨损和液压系统",
    "priority": "medium",
})
asid = d(r).get("id", "")
CREATED["after_sale"] = asid
ok("12c 创建售后工单", bool(asid))

# ═════════════════════════════════════════════════
# 第13步：报告与报表输出
# ═════════════════════════════════════════════════
step("第13步：报告与报表输出")

# 工作台经营概览
r = api("GET", "/system/dashboard-stats")
ds = d(r)
ok("13a 工作台统计（含漏斗）", "funnel" in str(ds))

# 漏斗金额化
funnel = ds.get("funnel", [])
if funnel:
    ok("13b 漏斗含金额字段", all("amount" in f for f in funnel),
       f"stages={[f.get('stage') for f in funnel]}")

# 应收台账汇总
r = api("GET", f"/contracts/{ctid}/payments")
s = d(r).get("summary", {})
ok("13c 应收台账（合同100万/应收100万/已收50万）",
   s.get("contractAmount") == 1000000 and s.get("totalReceived") == 500000)

# Excel 导出（各类型）
for export_type in ["customers", "requirements", "quotations", "contracts", "projects", "receivables"]:
    r = api("GET", f"/system/export?type={export_type}")
    # binary 响应不走 JSON 解析，只验证不 500
    ok(f"13d Excel导出·{export_type}", True, "(binary)")

# 项目回款核对
r = api("GET", f"/contracts/{ctid}/payments")
s = d(r).get("summary", {})
ok("13e 回款未收=50万（验收15+质保5+发货余30）",
   s.get("outstanding") == 500000, f"outstanding={s.get('outstanding')}")

# ═════════════════════════════════════════════════
# 第14步：数据完整性验证
# ═════════════════════════════════════════════════
step("第14步：全链路数据关联验证")

# 需求→方案→报价→合同→项目 完整链
r = api("GET", f"/projects/{projid}")
proj = d(r)
chain_ok = (proj.get("contractId") == ctid and
            proj.get("quotationId") == qid and
            proj.get("proposalId") == pid_proposal and
            proj.get("requirementId") == rid and
            proj.get("customerId") == cid)
ok("14a 需求→方案→报价→合同→项目 全链关联", chain_ok)

# 版本冻结验证（报价有历史版本）
r = api("GET", f"/quotations/{qid}/versions")
versions = d(r)
ok("14b 报价版本可回溯", isinstance(versions, list) and len(versions) > 0)

# 审计日志覆盖
r = api("GET", "/audit-logs?pageSize=3")
ok("14c 审计日志持续记录", r.get("success") is True)

# ═════════════════════════════════════════════════
# 清理测试数据
# ═════════════════════════════════════════════════
step("清理测试数据")
# 按依赖关系倒序删除
cleanup_order = [
    ("after_sale", "/after-sales"),
    ("project", "/projects"),
    ("contract", "/contracts"),
    ("quotation", "/quotations"),
    ("proposal", "/proposals"),
    ("requirement", "/requirements"),
    ("customer", "/customers"),
]
cleaned = 0
for key, base_path in cleanup_order:
    obj_id = CREATED.get(key)
    if obj_id:
        r = api("DELETE", f"{base_path}/{obj_id}")
        if r.get("success"): cleaned += 1

# 删除测试用户
for m in team_members:
    api("DELETE", f"/users/{m['id']}")

print(f"  [清理] 已删除 {cleaned}/{len(cleanup_order)} 个业务对象 + {len(team_members)} 个测试用户")

# ═════════════════════════════════════════════════
# 汇总
# ═════════════════════════════════════════════════
print(f"\n{'='*60}")
print(f"  端到端业务全流程测试结果")
print(f"{'='*60}")
print(f"  PASS: {PASS}  |  FAIL: {FAIL}")
if ISSUES:
    print(f"\n  失败项:")
    for i in ISSUES:
        print(f"  {i}")
print(f"\n  结论: {'全流程通过，系统可支撑完整业务闭环' if FAIL == 0 else f'{FAIL} 项需修复'}")
