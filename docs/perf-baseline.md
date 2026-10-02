# 性能基线档案

> 由 scripts/perf-baseline.mjs 生成；每次运行追加一节。P99 < 500ms 为框架达标线。

## 2026-09-29 13:07:09（N=40/接口，base=http://localhost:3101，Node v25.2.1）

| 接口 | P50 | P95 | P99 | avg | max |
|---|---|---|---|---|---|
| GET /api/auth/mode（公开） | 2.9ms | 12.1ms | 12.8ms | 3.6ms | 12.8ms |
| GET /api/system/info（公开） | 7.5ms | 9.8ms | 10.5ms | 7.5ms | 10.5ms |
| GET /api/customers?pageSize=20（列表+权限过滤） | 27.4ms | 33.4ms | 34.4ms | 27.1ms | 34.4ms |
| GET /api/quotations?pageSize=20（列表+关联） | 18.4ms | 27.9ms | 29.3ms | 18.9ms | 29.3ms |
| GET /api/documents?pageSize=20（文档列表） | 18.1ms | 25.5ms | 27.1ms | 18.8ms | 27.1ms |
| GET /api/system/dashboard-stats（工作台聚合） | 18.6ms | 24.5ms | 26ms | 18.7ms | 26ms |
| GET /api/system/module-stats（六模块计数聚合） | 61.9ms | 91.9ms | 100.7ms | 63.3ms | 100.7ms |
## 2026-09-29 18:39:29（N=30/接口，base=http://localhost:3101，Node v25.2.1）

| 接口 | P50 | P95 | P99 | avg | max |
|---|---|---|---|---|---|
| GET /api/auth/mode（公开） | 3.5ms | 5.8ms | 6.5ms | 4ms | 6.5ms |
| GET /api/system/info（公开） | 7.9ms | 10.1ms | 10.7ms | 8.2ms | 10.7ms |
| GET /api/customers?pageSize=20（列表+权限过滤） | 33.9ms | 40.9ms | 54.3ms | 34.2ms | 54.3ms |
| GET /api/quotations?pageSize=20（列表+关联） | 21.1ms | 22.6ms | 24.9ms | 20.7ms | 24.9ms |
| GET /api/documents?pageSize=20（文档列表） | 22.6ms | 31.5ms | 32.6ms | 23ms | 32.6ms |
| GET /api/system/dashboard-stats（工作台聚合） | 12.1ms | 13.8ms | 15.8ms | 12ms | 15.8ms |
| GET /api/system/module-stats（六模块计数聚合） | 11.6ms | 13.7ms | 14.3ms | 11.6ms | 14.3ms |
