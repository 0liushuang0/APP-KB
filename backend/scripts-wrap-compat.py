# -*- coding: utf-8 -*-
"""把迁移文件里含 SQLite 方言的 queryRunner.query(`...`) 调用包上 compat()。

只处理模板字面量形式的调用，且仅当字面量里含 datetime / PRAGMA 时才包装——
不含方言差异的语句保持原样，diff 最小。SQLite 路径零行为变化。
"""
import re
import io
import os
import time

MIG_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    'src', 'database', 'migrations',
)

CALL_RE = re.compile(
    r'queryRunner\s*\.\s*query\((\s*)(`(?:[^`\\]|\\.)*`)(\s*),?\s*\)',
    re.S,
)

report = {}
for fname in sorted(os.listdir(MIG_DIR)):
    if not fname.endswith('.ts') or fname == 'sql-compat.ts':
        continue
    path = os.path.join(MIG_DIR, fname)
    with io.open(path, 'r', encoding='utf-8') as f:
        src = f.read()

    wrapped = [0]

    def repl(m):
        ws1, lit, ws2 = m.group(1), m.group(2), m.group(3)
        low = lit.lower()
        if ('datetime' in low or 'pragma' in low or 'boolean' in low
                or 'drop table' in low or 'rename to' in low
                or 'add column' in low or 'strftime' in low):
            wrapped[0] += 1
            return 'queryRunner.query(compat(queryRunner, %s%s%s))' % (ws1, lit, ws2)
        return m.group(0)

    out = CALL_RE.sub(repl, src)
    if wrapped[0]:
        if "sql-compat'" not in out:
            # 在首个 import 之后插入 compat 导入
            out = re.sub(
                r"(^import[^\n]*\n)",
                r"\1import { compat } from './_shared/sql-compat';\n",
                out,
                count=1,
                flags=re.M,
            )
        for attempt in range(8):
            try:
                with io.open(path, 'w', encoding='utf-8', newline='') as f:
                    f.write(out)
                break
            except OSError:
                time.sleep(1.5)
        else:
            raise SystemExit('still locked: ' + fname)
        report[fname] = wrapped[0]

for k, v in report.items():
    print('%s: wrapped %d call(s)' % (k, v))
print('total files:', len(report))
