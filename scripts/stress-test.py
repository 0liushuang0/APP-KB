# -*- coding: utf-8 -*-
"""
压力测试 v2：区分限流(429)与真实错误，在限流范围内测真实性能 + 极限突破测试
"""
import json, time, threading, random, urllib.request, urllib.error, http.cookiejar, sys
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "http://localhost:3101/api"
RESULTS = {}

def make_opener():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

admin_opener = make_opener()
def admin_login():
    req = urllib.request.Request(f"{BASE}/auth/single-mode-login", method="POST",
                                 headers={"Content-Type": "application/json"}, data=b"{}")
    admin_opener.open(req, timeout=10)

def api(opener, method, path, data=None):
    url = f"{BASE}{path}"
    body = json.dumps(data, ensure_ascii=False).encode("utf-8") if data else None
    req = urllib.request.Request(url, data=body, method=method,
                                 headers={"Content-Type": "application/json"})
    t0 = time.perf_counter()
    try:
        resp = opener.open(req, timeout=30)
        ms = (time.perf_counter() - t0) * 1000
        return {"ms": ms, "code": resp.status, "ok": resp.status < 400, "limited": False}
    except urllib.error.HTTPError as e:
        ms = (time.perf_counter() - t0) * 1000
        return {"ms": ms, "code": e.code, "ok": e.code < 400,
                "limited": e.code == 429, "error": e.code >= 500}
    except Exception as ex:
        return {"ms": (time.perf_counter() - t0) * 1000, "code": 0, "ok": False,
                "limited": False, "error": True, "msg": str(ex)[:60]}

def pct(arr, p):
    return round(sorted(arr)[min(len(arr)-1, int(len(arr)*p))], 1) if arr else 0

def analyze(name, results, elapsed, note=""):
    ok = [r["ms"] for r in results if r["ok"]]
    limited = sum(1 for r in results if r["limited"])
    errors = sum(1 for r in results if r.get("error"))
    total = len(results)
    rps = round(total / elapsed, 1) if elapsed > 0 else 0
    ok_rps = round(len(ok) / elapsed, 1) if elapsed > 0 and ok else 0
    RESULTS[name] = {
        "total": total, "ok": len(ok), "limited": limited, "errors": errors,
        "ok_rate": round(len(ok)/total*100, 1) if total else 0,
        "p50": pct(ok, 0.5), "p95": pct(ok, 0.95), "p99": pct(ok, 0.99),
        "max": round(max(ok), 1) if ok else 0,
        "rps": rps, "ok_rps": ok_rps, "elapsed": round(elapsed, 1), "note": note,
    }
    r = RESULTS[name]
    status = "OK" if errors == 0 and r["p99"] < 500 else ("LIMITED" if limited > 0 else "ERROR")
    print(f"  [{status}] {name}: {total}次/{r['elapsed']}s | 成功{r['ok']} 限流{limited} 错误{errors} | "
          f"有效RPS={r['ok_rps']} | P50={r['p50']}ms P95={r['p95']}ms P99={r['p99']}ms{note}")

def section(t):
    print(f"\n{'='*60}\n  {t}\n{'='*60}")

def paced_concurrent(name, workers, total_req, method, path, data_fn=None, delay=0.1):
    """限速并发：每个 worker 之间加 delay 秒间隔，避免触发限流"""
    openers = []
    for _ in range(workers):
        op = make_opener()
        req = urllib.request.Request(f"{BASE}/auth/single-mode-login", method="POST",
                                     headers={"Content-Type": "application/json"}, data=b"{}")
        try: op.open(req, timeout=5)
        except: pass
        openers.append(op)

    results = []
    start = time.time()

    def worker(task_id):
        op = openers[task_id % workers]
        d = data_fn(task_id) if data_fn else None
        if task_id > 0:
            time.sleep(delay * (task_id // workers))
        return api(op, method, path, d)

    with ThreadPoolExecutor(max_workers=workers) as exe:
        futures = [exe.submit(worker, i) for i in range(total_req)]
        for f in as_completed(futures):
            results.append(f.result())
    elapsed = time.time() - start
    analyze(name, results, elapsed)

def burst_test(name, workers, total_req, method, path, data_fn=None):
    """突发：全部同时发出，测试限流器行为"""
    openers = [make_opener() for _ in range(min(workers, 5))]  # 减少登录次数
    for op in openers:
        req = urllib.request.Request(f"{BASE}/auth/single-mode-login", method="POST",
                                     headers={"Content-Type": "application/json"}, data=b"{}")
        try: op.open(req, timeout=5)
        except: pass

    results = []
    start = time.time()
    def worker(i):
        return api(openers[i % len(openers)], method, path, data_fn(i) if data_fn else None)
    with ThreadPoolExecutor(max_workers=workers) as exe:
        futures = [exe.submit(worker, i) for i in range(total_req)]
        for f in as_completed(futures):
            results.append(f.result())
    elapsed = time.time() - start
    analyze(name, results, elapsed, note=" (突发·限流器测试)")

# ═══════════════════════════════════════
admin_login()
print("  [管理员已登录]")

# ═══════════════════════════════════════
section("S1 基线（单线程串行）")
for name, path in [
    ("auth/mode", "/auth/mode"),
    ("customers", "/customers?pageSize=20"),
    ("quotations", "/quotations?pageSize=20"),
    ("documents", "/documents?pageSize=20"),
    ("dashboard", "/system/dashboard-stats"),
    ("module-stats", "/system/module-stats"),
]:
    rs = []
    for i in range(8):
        r = api(admin_opener, "GET", path)
        rs.append(r)
    # 去掉前2个预热
    rs = rs[2:]
    ok_ms = [r["ms"] for r in rs if r["ok"]]
    RESULTS[f"S1 {name}"] = {
        "total": len(rs), "ok": len(ok_ms), "limited": 0, "errors": 0,
        "ok_rate": 100, "p50": pct(ok_ms, .5), "p95": pct(ok_ms, .95), "p99": pct(ok_ms, .99),
        "max": round(max(ok_ms), 1) if ok_ms else 0, "rps": 0, "ok_rps": round(1000/(sum(ok_ms)/len(ok_ms)),1) if ok_ms else 0,
        "elapsed": 0, "note": " (串行基线)",
    }
    r = RESULTS[f"S1 {name}"]
    print(f"  [OK] S1 {name}: P50={r['p50']}ms P95={r['p95']}ms P99={r['p99']}ms | ~{r['ok_rps']} req/s单线程")

# ═══════════════════════════════════════
section("S2 正常并发（限速 0.15s/请求避免触发限流）")
paced_concurrent("S2 5线程读客户", 5, 50, "GET", "/customers?pageSize=20", delay=0.15)
paced_concurrent("S2 10线程读需求", 10, 50, "GET", "/requirements?pageSize=20", delay=0.2)
paced_concurrent("S2 10线程读文档", 10, 50, "GET", "/documents?pageSize=20", delay=0.2)
paced_concurrent("S2 5线程聚合统计", 5, 25, "GET", "/system/dashboard-stats", delay=0.3)

# ═══════════════════════════════════════
section("S3 并发写（限速 0.3s/请求）")
paced_concurrent("S3 5线程创建客户", 5, 15, "POST", "/customers",
                 lambda i: {"name": f"ST-C{i}-{int(time.time())}", "visibility": "public"}, delay=0.3)
paced_concurrent("S3 5线程创建需求", 5, 15, "POST", "/requirements",
                 lambda i: {"title": f"ST-R{i}-{int(time.time())}", "priority": "low"}, delay=0.3)

# ═══════════════════════════════════════
section("S4 突发限流测试（全速并发·预期触发限流器）")
burst_test("S4 突发·20线程读", 20, 100, "GET", "/customers?pageSize=5")
burst_test("S4 突发·10线程写", 10, 30, "POST", "/customers",
           lambda i: {"name": f"Burst-{i}-{int(time.time())}", "visibility": "public"})

# ═══════════════════════════════════════
section("S5 持续负载（30秒·限速~20 req/s）")
# ═══════════════════════════════════════
print("  30秒混合负载（读70%/写30%，限速20 req/s）...")
durations, ok_count, limited_count, error_count = [], 0, 0, 0
start = time.time()
i = 0
while time.time() - start < 30:
    rand = random.random()
    if rand < 0.7:
        r = api(admin_opener, "GET", "/customers?pageSize=10")
    else:
        r = api(admin_opener, "POST", "/customers",
                {"name": f"Sust-{i}-{int(time.time())}", "visibility": "public"})
    if r["ok"]:
        durations.append(r["ms"]); ok_count += 1
    elif r["limited"]:
        limited_count += 1
    else:
        error_count += 1
    i += 1
    time.sleep(0.05)  # ~20 req/s
elapsed = time.time() - start
total = i
RESULTS["S5 持续负载30s"] = {
    "total": total, "ok": ok_count, "limited": limited_count, "errors": error_count,
    "ok_rate": round(ok_count/total*100, 1),
    "p50": pct(durations, .5), "p95": pct(durations, .95), "p99": pct(durations, .99),
    "max": round(max(durations), 1) if durations else 0,
    "rps": round(total/elapsed, 1), "ok_rps": round(ok_count/elapsed, 1),
    "elapsed": round(elapsed, 1), "note": " (30s持续)",
}
r = RESULTS["S5 持续负载30s"]
print(f"  [{'OK' if error_count == 0 else 'ERR'}] S5: {total}次/{r['elapsed']}s | "
      f"成功{ok_count} 限流{limited_count} 错误{error_count} | "
      f"P50={r['p50']}ms P95={r['p95']}ms P99={r['p99']}ms")

# ═══════════════════════════════════════
section("S6 系统恢复")
# ═══════════════════════════════════════
time.sleep(5)
r = api(admin_opener, "GET", "/metrics/summary")
if r["ok"]:
    try:
        h = json.loads(urllib.request.urlopen(
            urllib.request.Request(f"{BASE}/metrics/summary"), timeout=5
        ).read().decode("utf-8"))["data"]
        print(f"  CPU: {h['process']['cpuPercent']}%  RSS: {h['process']['rssMB']}MB  Heap: {h['process']['heapUsedMB']}MB")
        print(f"  DB Pool: {h['db']['total']}连接(空闲{h['db']['idle']})  AI: {'正常' if h['aiServiceUp'] else '不可达'}")
        print(f"  磁盘: {h['system']['diskFreeGB']}GB剩余({h['system']['diskFreeRatio']}%)  错误率: {h['http']['rate']}%")
        print(f"  运行时间: {h['uptimeSeconds'] // 60}分钟")
    except: print("  (健康数据获取异常)")
# 功能恢复验证
for name, path in [("客户列表", "/customers?pageSize=3"), ("工作台", "/system/dashboard-stats")]:
    r = api(admin_opener, "GET", path)
    print(f"  恢复后{name}: {'正常' if r['ok'] else '异常'} ({r['ms']:.0f}ms)")

# ═══════════════════════════════════════
section("汇总报告")
# ═══════════════════════════════════════
print(f"\n  {'场景':<30} {'总数':>5} {'成功':>5} {'限流':>5} {'错误':>5} {'P50':>7} {'P95':>7} {'P99':>7}")
print("  " + "-" * 80)
for name, r in RESULTS.items():
    print(f"  {name:<28} {r['total']:>5} {r['ok']:>5} {r.get('limited',0):>5} {r.get('errors',0):>5} "
          f"{r['p50']:>6}ms {r['p95']:>6}ms {r['p99']:>6}ms")

total_all = sum(r["total"] for r in RESULTS.values())
ok_all = sum(r["ok"] for r in RESULTS.values())
err_all = sum(r.get("errors", 0) for r in RESULTS.values())
lim_all = sum(r.get("limited", 0) for r in RESULTS.values())
worst_p99 = max((r["p99"] for r in RESULTS.values() if r["ok"] > 5), default=0)

print(f"\n  总请求: {total_all}  成功: {ok_all}  限流: {lim_all}  真实错误: {err_all}")
print(f"  最差P99: {worst_p99}ms ({'达标' if worst_p99 < 500 else '超标'}，标准<500ms)")
print(f"  限流器: {'正常工作（突发流量被正确拦截）' if lim_all > 0 else '未触发'}")
print(f"  系统稳定性: {'稳定（零真实错误）' if err_all == 0 else f'{err_all}个真实错误'}")
