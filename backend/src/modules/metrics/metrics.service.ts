import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * 轻量运行指标（进程内存/CPU、HTTP 吞吐与延迟、连接池、磁盘、备份新鲜度、AI 可达）。
 *
 * 不引 prom-client 的原因：指标不到 20 个、格式是几行文本，
 * 自带实现可控可审计，还顺带产出给前端健康页用的 JSON 摘要。
 * Prometheus 抓取：GET /api/metrics（文本格式）；人工查看：GET /api/metrics/summary。
 */

const DURATION_BUCKETS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

interface RouteStats {
  count: number;
  errors: number;
  // 桶计数与总和，渲染直方图
  buckets: number[];
  sumMs: number;
}

@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly logger = new Logger(MetricsService.name);
  private readonly startedAt = Date.now();
  private readonly routes = new Map<string, RouteStats>();
  // 最近 1 小时错误环形缓冲（错误率用），上限防内存膨胀
  private readonly recent: Array<{ t: number; status: number }> = [];
  private aiUp: boolean | null = null;
  private lastAiCheck = 0;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  onModuleInit(): void {
    this.logger.log('运行指标已启用（/api/metrics）');
  }

  /** 拦截器埋点：route 形如 "GET /api/customers" */
  record(route: string, status: number, durationMs: number): void {
    let s = this.routes.get(route);
    if (!s) {
      s = { count: 0, errors: 0, buckets: new Array(DURATION_BUCKETS.length + 1).fill(0), sumMs: 0 };
      this.routes.set(route, s);
    }
    s.count += 1;
    s.sumMs += durationMs;
    if (status >= 500) s.errors += 1;
    let placed = false;
    for (let i = 0; i < DURATION_BUCKETS.length; i++) {
      if (durationMs <= DURATION_BUCKETS[i]) { s.buckets[i] += 1; placed = true; break; }
    }
    if (!placed) s.buckets[DURATION_BUCKETS.length] += 1;

    if (status >= 500) {
      this.recent.push({ t: Date.now(), status });
      if (this.recent.length > 5000) this.recent.splice(0, this.recent.length - 5000);
    }
  }

  /** 最近 windowMs 内的请求总量与 5xx 量（错误率口径） */
  errorStats(windowMs = 60 * 60 * 1000): { total: number; errors: number; rate: number } {
    const total = [...this.routes.values()].reduce((s, r) => s + r.count, 0);
    const since = Date.now() - windowMs;
    const errors = this.recent.filter((r) => r.t >= since).length;
    // total 是进程启动以来的累计，错误率以同口径近似（长运行下偏保守）
    return { total, errors, rate: total > 0 ? Math.round((errors / Math.min(total, 10000)) * 10000) / 100 : 0 };
  }

  private diskInfo(): { freeBytes: number; totalBytes: number; freeRatio: number } {
    try {
      const dir = path.resolve(process.cwd(), 'data');
      const st = fs.statfsSync(dir);
      const totalBytes = st.blocks * st.bsize;
      const freeBytes = st.bavail * st.bsize;
      return { freeBytes, totalBytes, freeRatio: totalBytes > 0 ? freeBytes / totalBytes : 1 };
    } catch {
      return { freeBytes: 0, totalBytes: 0, freeRatio: 1 };
    }
  }

  /** 最新备份时间（全量与 db-only 各自取最新） */
  backupFreshness(): { fullAgeMs: number | null; dbAgeMs: number | null } {
    try {
      const dir = path.resolve(process.cwd(), 'data', 'backups');
      if (!fs.existsSync(dir)) return { fullAgeMs: null, dbAgeMs: null };
      const now = Date.now();
      const age = (prefix: string): number | null => {
        const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix));
        if (!files.length) return null;
        const mt = Math.max(...files.map((f) => fs.statSync(path.join(dir, f)).mtimeMs));
        return now - mt;
      };
      return {
        fullAgeMs: age('backup-'),
        dbAgeMs: age('backup-db-'),
      };
    } catch {
      return { fullAgeMs: null, dbAgeMs: null };
    }
  }

  async checkAiService(): Promise<boolean> {
    // 30 秒内复用上次结果，避免健康接口把 AI 服务打挂
    if (Date.now() - this.lastAiCheck < 30_000 && this.aiUp !== null) return this.aiUp;
    this.lastAiCheck = Date.now();
    const base = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8100';
    // URL 解析校验：仅 http/https 且不带凭据（base 来自管理员 env，此处纵深防御）
    let parsedBase: URL;
    try {
      parsedBase = new URL(base);
    } catch {
      this.aiUp = false;
      return this.aiUp;
    }
    if (!/^https?:$/.test(parsedBase.protocol) || parsedBase.username || parsedBase.password) {
      this.aiUp = false;
      return this.aiUp;
    }
    try {
      // /health 有 API Key 保护且尾斜杠会 307，带 Key 请求真实探活
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch(`${base}/health/`, {
        signal: ctrl.signal,
        headers: { 'X-API-Key': process.env.AI_SERVICE_API_KEY || '' },
      });
      clearTimeout(timer);
      this.aiUp = res.status === 200 || res.status === 401; // 401=服务活着但 Key 未配，也算可达
    } catch {
      this.aiUp = false;
    }
    return this.aiUp;
  }

  private dbPool(): { total: number; idle: number; waiting: number } {
    // TypeORM 0.3 PostgresDriver：连接池挂在 driver.master（pg Pool）
    const pool = (this.dataSource.driver as any)?.master;
    return {
      total: pool?.totalCount ?? 0,
      idle: pool?.idleCount ?? 0,
      waiting: pool?.waitingCount ?? 0,
    };
  }

  private cpuPercent(): number {
    const usage = process.cpuUsage();
    const total = usage.user + usage.system;
    const upMs = Date.now() - this.startedAt;
    // 进程启动以来的平均 CPU 占单核百分比
    return upMs > 0 ? Math.round((total / 1000 / upMs) * 1000) / 10 : 0;
  }

  /** JSON 摘要（前端健康页直接消费） */
  async summary(): Promise<any> {
    const mem = process.memoryUsage();
    const disk = this.diskInfo();
    const backup = this.backupFreshness();
    const [aiUp, pool] = [await this.checkAiService(), this.dbPool()];
    return {
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      process: {
        cpuPercent: this.cpuPercent(),
        rssMB: Math.round(mem.rss / 1048576),
        heapUsedMB: Math.round(mem.heapUsed / 1048576),
        pid: process.pid,
        nodeVersion: process.version,
        host: os.hostname(),
      },
      system: {
        memTotalGB: Math.round(os.totalmem() / 1073741824 * 10) / 10,
        memFreeGB: Math.round(os.freemem() / 1073741824 * 10) / 10,
        diskFreeGB: Math.round(disk.freeBytes / 1073741824 * 10) / 10,
        diskFreeRatio: Math.round(disk.freeRatio * 1000) / 10,
      },
      db: { ...pool, type: this.dataSource.options.type },
      backup: {
        fullAgeHours: backup.fullAgeMs != null ? Math.round(backup.fullAgeMs / 3600000 * 10) / 10 : null,
        dbAgeHours: backup.dbAgeMs != null ? Math.round(backup.dbAgeMs / 3600000 * 10) / 10 : null,
      },
      aiServiceUp: aiUp,
      http: this.errorStats(),
      topRoutes: [...this.routes.entries()]
        .map(([route, s]) => ({
          route,
          count: s.count,
          errors: s.errors,
          avgMs: s.count ? Math.round(s.sumMs / s.count) : 0,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
    };
  }

  /** Prometheus 文本格式（抓取端点） */
  async prometheus(): Promise<string> {
    const lines: string[] = [];
    const push = (name: string, help: string, type: string, rows: string[]) => {
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, ...rows);
    };
    const mem = process.memoryUsage();
    const disk = this.diskInfo();
    const backup = this.backupFreshness();
    const aiUp = await this.checkAiService();
    const pool = this.dbPool();
    const err = this.errorStats();

    push('aikb_uptime_seconds', 'Process uptime in seconds', 'gauge',
      [`aikb_uptime_seconds ${Math.floor((Date.now() - this.startedAt) / 1000)}`]);
    push('process_resident_memory_bytes', 'Resident memory size', 'gauge',
      [`process_resident_memory_bytes ${mem.rss}`]);
    push('aikb_process_cpu_percent', 'Average process CPU of one core', 'gauge',
      [`aikb_process_cpu_percent ${this.cpuPercent()}`]);
    push('aikb_db_pool_connections', 'DB pool connections', 'gauge', [
      `aikb_db_pool_connections{state="total"} ${pool.total}`,
      `aikb_db_pool_connections{state="idle"} ${pool.idle}`,
      `aikb_db_pool_connections{state="waiting"} ${pool.waiting}`,
    ]);
    push('aikb_disk_free_bytes', 'Free bytes of data volume', 'gauge',
      [`aikb_disk_free_bytes ${disk.freeBytes}`]);
    push('aikb_disk_free_ratio', 'Free ratio of data volume', 'gauge',
      [`aikb_disk_free_ratio ${disk.freeRatio.toFixed(4)}`]);
    if (backup.fullAgeMs != null) {
      push('aikb_backup_last_success_seconds_ago', 'Seconds since last full backup', 'gauge',
        [`aikb_backup_last_success_seconds_ago ${Math.floor(backup.fullAgeMs / 1000)}`]);
    }
    if (backup.dbAgeMs != null) {
      push('aikb_backup_db_last_success_seconds_ago', 'Seconds since last db-only backup', 'gauge',
        [`aikb_backup_db_last_success_seconds_ago ${Math.floor(backup.dbAgeMs / 1000)}`]);
    }
    push('aikb_ai_service_up', 'AI service reachable', 'gauge',
      [`aikb_ai_service_up ${aiUp ? 1 : 0}`]);

    const reqRows: string[] = [];
    const histRows: string[] = [];
    for (const [route, s] of this.routes) {
      const escaped = route.replace(/"/g, "'");
      const label = `{route="${escaped}"}`;
      reqRows.push(`aikb_http_requests_total${label} ${s.count}`);
      reqRows.push(`aikb_http_errors_total${label} ${s.errors}`);
      DURATION_BUCKETS.forEach((b, i) => {
        histRows.push(`aikb_http_request_duration_ms_bucket{route="${escaped}",le="${b}"} ${s.buckets[i]}`);
      });
      histRows.push(`aikb_http_request_duration_ms_bucket{route="${escaped}",le="+Inf"} ${s.buckets[DURATION_BUCKETS.length]}`);
      histRows.push(`aikb_http_request_duration_ms_sum{route="${escaped}"} ${Math.round(s.sumMs)}`);
      histRows.push(`aikb_http_request_duration_ms_count{route="${escaped}"} ${s.count}`);
    }
    push('aikb_http_requests_total', 'Total HTTP requests by route', 'counter', reqRows);
    if (histRows.length) {
      lines.push('# HELP aikb_http_request_duration_ms HTTP duration histogram', '# TYPE aikb_http_request_duration_ms histogram', ...histRows);
    }
    push('aikb_http_error_rate', 'Approx error rate (5xx)', 'gauge',
      [`aikb_http_error_rate ${err.rate.toFixed(4)}`]);
    return lines.join('\n') + '\n';
  }
}
