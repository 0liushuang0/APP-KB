#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AI 业务知识库系统 - 自动化测试脚本
用法：python scripts/test-all.py
"""

import json
import sys
import time
import tempfile
import os
from datetime import datetime
from urllib.parse import urljoin

import requests

BASE_URL = "http://localhost:3000/api"
AI_URL = "http://localhost:8100"
TOKEN = None
RESULTS = []
TEST_SUFFIX = datetime.now().strftime("%Y%m%d%H%M%S")


def record(name: str, success: bool, detail: str = ""):
    RESULTS.append({"step": name, "result": "PASS" if success else "FAIL", "detail": detail})
    icon = "[PASS]" if success else "[FAIL]"
    try:
        print(f"{icon} {name}: {detail}")
    except UnicodeEncodeError:
        print(f"{icon} {name.encode('utf-8').decode('utf-8', 'ignore')}: {detail.encode('utf-8').decode('utf-8', 'ignore')}")


def api(method: str, path: str, data=None, files=None, headers=None, raw=False):
    url = urljoin(BASE_URL + "/", path.lstrip("/"))
    h = headers or {}
    if TOKEN:
        h["Authorization"] = f"Bearer {TOKEN}"
    try:
        if files:
            resp = requests.request(method, url, headers=h, data=data, files=files, timeout=60)
        else:
            h.setdefault("Content-Type", "application/json")
            resp = requests.request(method, url, headers=h, json=data, timeout=60)
        if raw:
            return resp
        return resp.json()
    except Exception as e:
        return {"success": False, "error": str(e)}


def main():
    global TOKEN
    print("=" * 50)
    print("AI 业务知识库系统 - 自动化测试")
    print("=" * 50)

    # 1. 系统信息
    try:
        res = api("GET", "/system/info")
        assert res.get("success") and res["data"]["mode"] == "single"
        record("获取系统信息", True, json.dumps(res["data"], ensure_ascii=False))
    except Exception as e:
        record("获取系统信息", False, str(e))

    # 2. 单用户模式登录
    try:
        res = api("GET", "/auth/single-mode-login")
        assert res.get("success") and res["data"]["accessToken"]
        TOKEN = res["data"]["accessToken"]
        record("单用户模式登录", True, f"token={TOKEN[:20]}...")
    except Exception as e:
        record("单用户模式登录", False, str(e))
        return

    # 3. 当前用户
    try:
        res = api("GET", "/users/me")
        assert res.get("success")
        record("获取当前用户信息", True, res["data"].get("nickname") or res["data"].get("username"))
    except Exception as e:
        record("获取当前用户信息", False, str(e))

    customer_id = None
    # 4. 客户 CRUD
    try:
        res = api("POST", "/customers", {
            "name": f"测试客户-宝钢-{TEST_SUFFIX}",
            "code": f"test-bsg-{TEST_SUFFIX}",
            "industry": "钢铁",
            "description": "测试客户描述",
            "visibility": "public"
        })
        assert res.get("success"), res
        customer_id = res["data"]["id"]
        record("创建客户", True, f"id={customer_id}")
    except Exception as e:
        record("创建客户", False, str(e))

    try:
        res = api("GET", "/customers")
        assert res.get("success") and len(res["data"]) >= 1
        record("查询客户列表", True, f"count={len(res['data'])}")
    except Exception as e:
        record("查询客户列表", False, str(e))

    if customer_id:
        try:
            res = api("GET", f"/customers/{customer_id}")
            assert res.get("success")
            record("查询客户详情", True, res["data"].get("name"))
        except Exception as e:
            record("查询客户详情", False, str(e))

    proposal_id = None
    # 5. 方案 CRUD
    try:
        res = api("POST", "/proposals", {
            "proposalNo": f"PROP-{TEST_SUFFIX}-001",
            "title": "拉矫机选型方案",
            "customerId": customer_id,
            "productDescription": "拉矫机产线",
            "proposalType": "设备选型",
            "content": "## 方案概述\n\n本方案为宝钢提供拉矫机选型建议。",
            "requirements": "产能要求：每月 5000 吨",
            "visibility": "public"
        })
        assert res.get("success"), res
        proposal_id = res["data"]["id"]
        record("创建方案", True, f"id={proposal_id}")
    except Exception as e:
        record("创建方案", False, str(e))

    try:
        res = api("GET", "/proposals")
        assert res.get("success")
        record("查询方案列表", True, f"count={len(res['data'])}")
    except Exception as e:
        record("查询方案列表", False, str(e))

    quotation_id = None
    # 6. 报价 CRUD
    try:
        res = api("POST", "/quotations", {
            "quotationNo": f"QT-{TEST_SUFFIX}-001",
            "customerId": customer_id,
            "proposalId": proposal_id,
            "amount": 850000,
            "notes": "测试报价",
            "visibility": "public",
            "items": [
                {"name": "拉矫机主机", "quantity": 1, "unitPrice": 600000},
                {"name": "电气系统", "quantity": 1, "unitPrice": 150000},
                {"name": "安装调试", "quantity": 1, "unitPrice": 100000}
            ]
        })
        assert res.get("success"), res
        quotation_id = res["data"]["id"]
        record("创建报价", True, f"id={quotation_id}")
    except Exception as e:
        record("创建报价", False, str(e))

    try:
        res = api("GET", "/quotations")
        assert res.get("success")
        record("查询报价列表", True, f"count={len(res['data'])}")
    except Exception as e:
        record("查询报价列表", False, str(e))

    document_id = None
    # 7. 文档上传
    try:
        fd, path = tempfile.mkstemp(suffix=".txt")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write("这是 AI 业务知识库测试文档。\n拉矫机是钢铁冷轧生产线上的关键设备，用于消除带钢的板形缺陷。\n")
        with open(path, "rb") as f:
            res = api("POST", "/documents/upload", data={
                "title": "测试文档-拉矫机说明",
                "category": "产品资料",
                "visibility": "public"
            }, files={"file": ("test-doc.txt", f, "text/plain")})
        os.unlink(path)
        assert res.get("success"), res
        document_id = res["data"]["id"]
        record("上传测试文档", True, f"id={document_id}")
    except Exception as e:
        record("上传测试文档", False, str(e))

    # 等待解析
    time.sleep(3)

    # 8. RAG 搜索
    try:
        res = api("POST", "/search/rag", {
            "query": "拉矫机是什么设备",
            "sourceTypes": ["document"]
        })
        assert res.get("success")
        record("RAG 搜索文档内容", True, f"results={len(res['data'])}")
    except Exception as e:
        record("RAG 搜索文档内容", False, str(e))

    # 9. AI 助手
    try:
        res = api("POST", "/search/assistant", {
            "query": "拉矫机是什么",
            "sourceTypes": ["document"]
        })
        assert res.get("success")
        record("AI 助手问答", True, f"answer_length={len(res['data'].get('answer', ''))}")
    except Exception as e:
        record("AI 助手问答", False, str(e))

    # 10. 工作台统计
    try:
        res = api("GET", "/system/dashboard-stats")
        assert res.get("success")
        record("获取工作台统计", True, json.dumps(res["data"], ensure_ascii=False))
    except Exception as e:
        record("获取工作台统计", False, str(e))

    # 11. 审批数量
    try:
        res = api("GET", "/approvals/pending-count")
        assert res.get("success")
        record("检查待审核数量", True, f"pending={res['data']}")
    except Exception as e:
        record("检查待审核数量", False, str(e))

    # 12. AI 服务健康
    try:
        resp = requests.get(f"{AI_URL}/health/", timeout=10)
        assert resp.status_code == 200 and resp.json().get("status") == "ok"
        record("AI 服务健康检查", True, resp.text)
    except Exception as e:
        record("AI 服务健康检查", False, str(e))

    # 13. 团队模式登录尝试
    try:
        resp = requests.post(f"{BASE_URL}/auth/login", json={"username": "admin", "password": "admin123"}, timeout=10)
        record("团队模式普通登录尝试", True, f"status={resp.status_code}")
    except Exception as e:
        record("团队模式普通登录尝试", False, str(e))

    # 汇总
    print("\n" + "=" * 50)
    print("测试结果汇总")
    print("=" * 50)
    passed = sum(1 for r in RESULTS if r["result"] == "PASS")
    failed = sum(1 for r in RESULTS if r["result"] == "FAIL")
    for r in RESULTS:
        print(f"[{r['result']}] {r['step']}: {r['detail']}")
    print(f"\n通过: {passed}, 失败: {failed}")

    report_path = os.path.join(os.path.dirname(__file__), "..", "test-report.json")
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump({
            "time": datetime.now().isoformat(),
            "results": RESULTS,
            "summary": {"pass": passed, "fail": failed}
        }, f, ensure_ascii=False, indent=2)
    print(f"报告已保存: {report_path}")

    sys.exit(failed)


if __name__ == "__main__":
    main()
