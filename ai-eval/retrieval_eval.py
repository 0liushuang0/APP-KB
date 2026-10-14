#!/usr/bin/env python
"""检索评测（固定题集，可重复对比）。

为什么另起一个：原 run-eval.mjs 取「前 N 篇文档」做样本，实际抽到的全是证照图片，
命中率 0% —— 测的是图片能不能被检索，不是业务资料能不能被找到，结论没有参考价值。

做法：
  1. 首次运行从真实业务数据里**确定性**抽题（按 id 排序取前 N，不随机），每题的标准出处已知：
       产品「X 是什么产品、有哪些规格参数」→ product:X
       供应商「X 能供应哪些产品」        → supplier:X
       客户「X 是哪个行业、哪个区域的客户」→ customer:X
       资料「《标题》主要讲了什么」        → document/knowledge:该资料
     题集写进 ai-eval/local/question-set.json，之后每次评测都用同一套题（换模型/改检索前后才可比）。
  2. 直接调 AI 服务 /rag/hybrid-search（与系统问答同一检索），看标准出处是否在前 1 / 前 5 名。
  3. 结果按类型汇总，追加写入 ai-eval/local/results.md。

只读：只查数据库、只调检索接口，不登录、不写业务数据。题集含客户/供应商名称等业务数据，
所以放在 local/（已加入 .gitignore），不进代码库。

用法：
  python ai-eval/retrieval_eval.py            用已有题集评测（没有则先生成）
  python ai-eval/retrieval_eval.py --rebuild  重新抽题（会改变基线，慎用）
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCAL = Path(__file__).resolve().parent / "local"
SET_FILE = LOCAL / "question-set.json"
PER_TYPE = 10


def read_env(path: Path) -> dict:
    env = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            m = re.match(r"\s*([A-Z_]+)\s*=\s*(.*)", line)
            if m:
                env[m.group(1)] = m.group(2).strip().strip('"')
    return env


def connect(env: dict):
    import psycopg2

    c = psycopg2.connect(host=env["DB_HOST"], port=env["DB_PORT"], user=env["DB_USERNAME"],
                         password=env["DB_PASSWORD"], dbname=env["DB_NAME"], connect_timeout=5)
    c.set_session(readonly=True)
    return c


def clean_title(t: str) -> str:
    t = re.sub(r"\.[A-Za-z0-9]{2,5}$", "", t or "").strip()
    return t


def build_set(env: dict) -> list[dict]:
    cur = connect(env).cursor()
    qs: list[dict] = []

    cur.execute("""select id::text, name from products
                   where coalesce(trim(description),'') <> '' or coalesce("specs"::text,'[]') not in ('[]','null')
                   order by id limit %s""", (PER_TYPE,))
    qs += [{"type": "product", "id": i, "q": f"{n}是什么产品，有哪些规格参数？"} for i, n in cur.fetchall()]

    cur.execute("select id::text, name from suppliers order by id limit %s", (PER_TYPE,))
    qs += [{"type": "supplier", "id": i, "q": f"{n}能供应哪些产品？"} for i, n in cur.fetchall()]

    cur.execute("select id::text, name from customers order by id limit %s", (PER_TYPE,))
    qs += [{"type": "customer", "id": i, "q": f"{n}是哪个行业、哪个区域的客户？"} for i, n in cur.fetchall()]

    # 业务资料: 已审批、非知识资料、有正文(>50 字), 跳过图片(标题多为编号, 不是业务问题)
    cur.execute("""select id::text, coalesce(title, "fileName") from documents
                   where status = 'approved' and category not like 'knowledge%%'
                     and length(coalesce("parsedText",'')) > 50
                     and lower("fileName") !~ '\\.(jpg|jpeg|png|gif|bmp)$'
                   order by id limit %s""", (PER_TYPE,))
    qs += [{"type": "document", "id": i, "q": f"《{clean_title(t)}》主要讲了什么？"} for i, t in cur.fetchall()]

    cur.execute("""select id::text, coalesce(title, "fileName") from documents
                   where status = 'approved' and category like 'knowledge%%'
                   order by id limit %s""", (PER_TYPE,))
    qs += [{"type": "knowledge", "id": i, "q": f"《{clean_title(t)}》主要讲了什么？"} for i, t in cur.fetchall()]
    return [q for q in qs if q["q"] and "《》" not in q["q"]]


def search(url: str, key: str, query: str, k: int) -> list[dict]:
    req = urllib.request.Request(url.rstrip("/") + "/rag/hybrid-search",
                                 data=json.dumps({"query": query, "top_k": k}).encode(),
                                 headers={"Content-Type": "application/json", "X-API-Key": key})
    return json.loads(urllib.request.urlopen(req, timeout=60).read()).get("results", [])


def hit_rank(results: list[dict], q: dict) -> int | None:
    for rank, r in enumerate(results, 1):
        ids = {str(r.get("source_id") or ""), str(r.get("document_id") or "")}
        if q["id"] in ids or any(x.startswith(q["id"]) for x in ids if x):
            return rank
    return None


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--rebuild", action="store_true")
    ap.add_argument("--k", type=int, default=5)
    ap.add_argument("--url", default="http://127.0.0.1:3102")
    args = ap.parse_args()

    db_env = read_env(ROOT / ".env")
    key = read_env(ROOT / "backend" / ".env").get("AI_SERVICE_API_KEY", "")
    LOCAL.mkdir(exist_ok=True)
    if args.rebuild or not SET_FILE.exists():
        qs = build_set(db_env)
        SET_FILE.write_text(json.dumps({"builtAt": datetime.now().isoformat(timespec="seconds"), "questions": qs},
                                       ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"已生成题集 {len(qs)} 题 → {SET_FILE}")
    qs = json.loads(SET_FILE.read_text(encoding="utf-8"))["questions"]

    by_type: dict[str, list] = {}
    lat = []
    for q in qs:
        t0 = time.time()
        try:
            res = search(args.url, key, q["q"], args.k)
            rank = hit_rank(res, q)
        except Exception as exc:  # 检索服务异常也记入结果(算未命中), 不中断整轮
            print(f"  ! 检索失败 {q['type']}:{q['id'][:8]} {exc}")
            rank = None
        lat.append((time.time() - t0) * 1000)
        by_type.setdefault(q["type"], []).append(rank)

    lines = [f"\n## {datetime.now():%Y-%m-%d %H:%M}（题集 {len(qs)} 题，top_k={args.k}）\n",
             "| 类型 | 题数 | 命中@1 | 命中@5 |", "|---|---|---|---|"]
    tot1 = tot5 = 0
    for t, ranks in by_type.items():
        h1 = sum(1 for r in ranks if r == 1)
        h5 = sum(1 for r in ranks if r is not None)
        tot1 += h1
        tot5 += h5
        lines.append(f"| {t} | {len(ranks)} | {h1}（{h1 * 100 // len(ranks)}%） | {h5}（{h5 * 100 // len(ranks)}%） |")
    n = len(qs) or 1
    lat.sort()
    p50 = lat[len(lat) // 2] if lat else 0
    p95 = lat[int(len(lat) * 0.95) - 1] if lat else 0
    lines.append(f"| **合计** | {len(qs)} | {tot1}（{tot1 * 100 // n}%） | {tot5}（{tot5 * 100 // n}%） |")
    lines.append(f"\n检索延迟 P50 {p50:.0f}ms · P95 {p95:.0f}ms")
    report = "\n".join(lines)
    print(report)
    res_file = LOCAL / "results.md"
    if not res_file.exists():
        res_file.write_text("# 检索评测记录（固定题集）\n", encoding="utf-8")
    with res_file.open("a", encoding="utf-8") as fh:
        fh.write(report + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
