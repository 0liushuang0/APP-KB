# -*- coding: utf-8 -*-
"""端口迁移：3001→3101、5174→5274、8000→8100（避开 40-PMP-system 冲突）。

只改本项目的配置与默认值；docker-compose 容器内端口（backend:3000、
ai-service:8000）与宿主机不冲突，不动。
"""
import io
import os
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (相对路径, [(旧, 新), ...])
EDITS = [
    ('.env', [
        ('PORT=3001', 'PORT=3101'),
        ('CORS_ORIGIN=http://localhost:5174', 'CORS_ORIGIN=http://localhost:5274'),
        ('AI_SERVICE_URL=http://localhost:8000', 'AI_SERVICE_URL=http://localhost:8100'),
        ('PUBLIC_URL=http://localhost:3001', 'PUBLIC_URL=http://localhost:3101'),
        ('FRONTEND_PORT=5174', 'FRONTEND_PORT=5274'),
        ('VITE_API_BASE_URL=http://localhost:3001', 'VITE_API_BASE_URL=http://localhost:3101'),
    ]),
    ('run.bat', [
        ('"3001,5174,8000 |', '"3101,5274,8100 |'),
        ('(port 8000)', '(port 8100)'),
        ('--port 8000', '--port 8100'),
        ('(port 3001)', '(port 3101)'),
        ('(port 5174)', '(port 5274)'),
        ('http://localhost:5174', 'http://localhost:5274'),
        ('http://localhost:3001', 'http://localhost:3101'),
        ('http://localhost:8000', 'http://localhost:8100'),
    ]),
    (os.path.join('frontend', 'vite.config.ts'), [
        ('port: 5174', 'port: 5274'),
        ("target: 'http://localhost:3001'", "target: 'http://localhost:3101'"),
    ]),
    (os.path.join('backend', 'src', 'config', 'app.config.ts'), [
        ("process.env.PORT || '3001'", "process.env.PORT || '3101'"),
        ("'http://127.0.0.1:8000'", "'http://127.0.0.1:8100'"),
        ("'http://localhost:5174'", "'http://localhost:5274'"),
    ]),
    (os.path.join('backend', 'src', 'main.ts'), [
        ("|| 'http://localhost:5174'", "|| 'http://localhost:5274'"),
        ('|| 3001;', '|| 3101;'),
    ]),
    (os.path.join('scripts', 'test-all.py'), [
        ('AI_URL = "http://localhost:8000"', 'AI_URL = "http://localhost:8100"'),
    ]),
    ('README.md', [
        ('http://localhost:5174', 'http://localhost:5274'),
        ('http://localhost:3001', 'http://localhost:3101'),
        ('http://localhost:8000', 'http://localhost:8100'),
        ('Port: 5174', 'Port: 5274'),
        ('Port: 3001', 'Port: 3101'),
        ('Port: 8000', 'Port: 8100'),
        ('--port 8000', '--port 8100'),
        ('--port 3001', '--port 3101'),
    ]),
]

for rel, pairs in EDITS:
    path = os.path.join(ROOT, rel)
    src = io.open(path, encoding='utf-8').read()
    out = src
    hits = 0
    for old, new in pairs:
        hits += out.count(old)
        out = out.replace(old, new)
    if out != src:
        for attempt in range(8):
            try:
                io.open(path, 'w', encoding='utf-8', newline='').write(out)
                print('%s: %d 处替换' % (rel, hits))
                break
            except OSError:
                time.sleep(1.5)
        else:
            raise SystemExit('locked: ' + rel)
    else:
        print('%s: 无匹配（跳过）' % rel)
