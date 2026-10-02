"""
需求模板中间层下沉：把"既有自己模板、又挂了叶子"的中间层(2级)节点改为纯分组节点。

规则（用户确认）：
  1. 中间层有字段 → 复制到它下面**目前为空**的叶子（已有字段的叶子保留自身定义）。
  2. 引用该中间层的需求(requirements.templateCategory) 重指到第一个叶子。
  3. 引用该中间层的产品(products.category) 优先按"产品名==叶子末段"精准重指，
     匹配不到则落到第一个叶子。
  4. 删除中间层模板行。

用法：
  python scripts/cleanup-mid-templates.py            # dry-run，只打印计划不改库
  python scripts/cleanup-mid-templates.py --apply    # 先备份 app.db，再事务内执行
"""
from __future__ import annotations
import json
import os
import shutil
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, 'backend', 'data', 'app.db')
APPLY = '--apply' in sys.argv


def field_count(s):
    try:
        p = json.loads(s or '[]')
        return len(p) if isinstance(p, list) else 0
    except Exception:
        return 0


def main():
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row

    # 找出全部 2级中间层模板(下面挂了 3级叶子)
    mids = []
    for r in db.execute('SELECT id, category, fields FROM param_templates'):
        c = r['category']
        parts = c.split('/')
        if len(parts) == 2:
            cnt = db.execute(
                'SELECT COUNT(*) FROM param_templates WHERE category LIKE ?', (c + '/%',)
            ).fetchone()[0]
            if cnt > 0:
                mids.append(dict(r))

    print(f'=== 发现 {len(mids)} 个"有叶子"的中间层模板 ===')
    print(f'模式: {"APPLY(执行)" if APPLY else "DRY-RUN(只读)"}\n')

    plan = []  # (mid_cat, first_leaf, copied_to_leaves, req_repoints, prod_repoints)
    for m in mids:
        cat = m['category']
        leaves = [
            dict(x)
            for x in db.execute(
                'SELECT id, category, fields FROM param_templates WHERE category LIKE ? ORDER BY category',
                (cat + '/%',),
            )
        ]
        first_leaf = leaves[0]['category']
        leaf_by_name = {l['category'].split('/')[-1]: l['category'] for l in leaves}

        # 1) 中间层字段 → 空 叶子
        copied_to = []
        if field_count(m['fields']) > 0:
            for l in leaves:
                if field_count(l['fields']) == 0:
                    copied_to.append(l['category'])

        # 2) 需求重指
        req_rows = [
            dict(x)
            for x in db.execute(
                'SELECT id FROM requirements WHERE templateCategory = ?', (cat,)
            )
        ]
        # 注：产品不绑定模板，不重指（见 apply 段注释）。

        plan.append((cat, first_leaf, copied_to, len(req_rows)))

    # 打印计划
    for cat, first_leaf, copied_to, req_n in plan:
        print(f'■ {cat}')
        print(f'   第一个叶子(需求默认重指目标): {first_leaf}')
        if copied_to:
            print(f'   字段复制到空叶子({len(copied_to)}): {", ".join(c.split("/")[-1] for c in copied_to)}')
        print(f'   需求重指: {req_n} 条 → {first_leaf}')
        print(f'   → 删除中间层模板 [{cat}]')
        print()

    if not APPLY:
        print('（DRY-RUN，未改动数据库。确认无误后加 --apply 执行。）')
        return

    # 执行：先备份，再事务
    bak = DB + '.bak-midcleanup'
    shutil.copy(DB, bak)
    print(f'已备份: {bak}\n开始执行...')
    try:
        with db:
            for m in mids:
                cat = m['category']
                leaves = [
                    dict(x)
                    for x in db.execute(
                        'SELECT id, category, fields FROM param_templates WHERE category LIKE ? ORDER BY category',
                        (cat + '/%',),
                    )
                ]
                first_leaf = leaves[0]['category']
                leaf_by_name = {l['category'].split('/')[-1]: l['category'] for l in leaves}

                if field_count(m['fields']) > 0:
                    for l in leaves:
                        if field_count(l['fields']) == 0:
                            db.execute(
                                'UPDATE param_templates SET fields = ? WHERE id = ?',
                                (m['fields'], l['id']),
                            )
                db.execute(
                    'UPDATE requirements SET templateCategory = ? WHERE templateCategory = ?',
                    (first_leaf, cat),
                )
                # 注：产品(products.category)不绑定参数模板（后端无按 category 查模板的逻辑），
                # 删中间层模板不影响产品分类，故【不重指产品】。之前误重指会造成产品导航
                # "支承辊>支承辊"式的重复层级与错归，已撤销。仅重指需求(templateCategory)。
                db.execute('DELETE FROM param_templates WHERE id = ?', (m['id'],))
        print('✅ 执行完成。')
    except Exception as exc:
        print(f'❌ 执行失败，已回滚: {exc}')
        print(f'   如库受损，用备份恢复: {bak}')
        raise


if __name__ == '__main__':
    main()
