# -*- coding: utf-8 -*-
"""核查：迁移目录里不再有未包 compat() 的方言语句。"""
import re
import io
import os

D = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    'src', 'database', 'migrations',
)

CALL_RE = re.compile(
    r'queryRunner\s*\.\s*query\(\s*(`(?:[^`\\]|\\.)*`)\s*,?\s*\)',
    re.S,
)

bad = []
total = 0
for fn in sorted(os.listdir(D)):
    if not fn.endswith('.ts') or fn == 'sql-compat.ts':
        continue
    src = io.open(os.path.join(D, fn), encoding='utf-8').read()
    for m in CALL_RE.finditer(src):
        # 只统计"裸调用"：调用点前 60 字符内没有 compat(
        before = src[max(0, m.start() - 60):m.start()]
        if 'compat(' in before:
            continue
        total += 1
        lit = m.group(1).lower()
        if ('datetime' in lit or 'pragma' in lit or 'boolean' in lit
                or 'drop table' in lit or 'rename to' in lit
                or 'add column' in lit):
            bad.append((fn, m.group(1)[:70].replace('\n', ' ')))

print('bare query() calls:', total)
print('unwrapped dialect calls:', len(bad))
for f, l in bad[:6]:
    print(' -', f, '|', l)
