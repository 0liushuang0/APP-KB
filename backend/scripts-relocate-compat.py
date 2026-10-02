# -*- coding: utf-8 -*-
"""把迁移文件里的 compat 导入改指向 _shared/，并把旧的 sql-compat.ts 清成无导出的说明文件。"""
import io
import os

D = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    'src', 'database', 'migrations',
)

OLD = os.path.join(D, 'sql-compat.ts')
PLACEHOLDER = (
    '/**\n'
    ' * 本文件已迁移到 ./_shared/sql-compat.ts。\n'
    ' * database.config.ts 用 migrations/*{.ts,.js} 收集迁移类，任何导出都会被\n'
    ' * TypeORM 实例化，所以这里必须保持零导出（空文件会导致构建产物缺失报错，\n'
    ' * 用纯注释占位）。\n'
    ' */\n'
    'export {};\n'
)

changed = 0
for fn in sorted(os.listdir(D)):
    if not fn.endswith('.ts'):
        continue
    p = os.path.join(D, fn)
    src = io.open(p, encoding='utf-8').read()
    if "from './sql-compat'" in src:
        io.open(p, 'w', encoding='utf-8', newline='').write(
            src.replace("from './sql-compat'", "from './_shared/sql-compat'"))
        changed += 1

io.open(OLD, 'w', encoding='utf-8', newline='').write(PLACEHOLDER)
print('imports rewritten:', changed)
print('old file neutralized:', OLD)
