# -*- coding: utf-8 -*-
"""删除误插入的旧路径 compat 导入行（保留 _shared 版本）。"""
import io
import os

D = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    'src', 'database', 'migrations',
)

BAD = "import { compat } from './sql-compat';\n"

fixed = 0
import time
for fn in sorted(os.listdir(D)):
    if not fn.endswith('.ts'):
        continue
    p = os.path.join(D, fn)
    src = io.open(p, encoding='utf-8').read()
    if BAD in src:
        for attempt in range(6):
            try:
                io.open(p, 'w', encoding='utf-8', newline='').write(src.replace(BAD, ''))
                fixed += 1
                break
            except OSError:
                time.sleep(1.5)
        else:
            raise SystemExit('still locked: ' + fn)
print('deduped files:', fixed)
