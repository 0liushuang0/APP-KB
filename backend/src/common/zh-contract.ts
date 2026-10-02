// 复制自 packages/zh-contract-ts/zh-contract.ts (0.4.0), 勿在此单独修改
/**
 * 智汇平台集成契约 · TypeScript/NestJS 版 (contract zh/1, package 0.4.0)
 *
 * 与 packages/zh-contract-py 对等: 各 NestJS 子系统暴露 /api/zh/v1/* 集成接口的公共约定。
 * 分发: 本文件是唯一源; 复制到应用的 src/common/zh-contract.ts 使用(拆分独立交付时随应用带走),
 *       升级时整体替换, 不在应用内单独修改。
 *
 * 约定: 请求头 X-ZH-Service-Token 与环境变量 ZH_SERVICE_TOKEN 常量时间比较; 匿名 401;
 *       未配置 ZH_SERVICE_TOKEN(单独运行)时 503。列表接口支持 updated_since 增量。
 * 0.4.0: 统一设置(settings/schema + settings, 平台接管清单) 与 统一登录(X-ZH-Identity 签名身份)。
 */
import {
  BadRequestException,
  ConflictException,
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname } from 'path';

export const ZH_CONTRACT_VERSION = 'zh/1';

@Injectable()
export class ZhServiceTokenGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const got = String(ctx.switchToHttp().getRequest().headers['x-zh-service-token'] || '');
    if (!got) throw new UnauthorizedException('缺少服务令牌');
    const expected = process.env.ZH_SERVICE_TOKEN || '';
    if (!expected) throw new ServiceUnavailableException('未接入智汇平台(ZH_SERVICE_TOKEN 未配置)');
    const a = Buffer.from(got);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException('服务令牌无效');
    return true;
  }
}

export const zhIso = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

export function zhParseSince(v?: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(+d)) throw new BadRequestException(`updated_since 不是 ISO 时间: ${v}`);
  return d;
}

/** 内存中按 updatedAt 增量过滤+排序+限量(规避 SQLite/PG 时间字面量差异导致的漏数) */
export function zhPage<T extends { updatedAt: Date | string; id?: unknown }>(rows: T[], since: Date | null, limit?: string, offset?: string, after?: string): T[] {
  const n = Math.min(Math.max(Number(limit) || 500, 1), 2000);
  const start = after ? 0 : Math.max(0, Number(offset) || 0);
  let cursor: [number, string] | null = null;
  if (after) {
    try {
      const pair = JSON.parse(after);
      if (!Array.isArray(pair) || pair.length !== 2 || !Number.isFinite(+new Date(pair[0]))) throw new Error();
      cursor = [+new Date(pair[0]), String(pair[1])];
    } catch { throw new BadRequestException('after 游标无效'); }
  }
  return rows
    .filter((r) => !since || new Date(r.updatedAt) > since)
    .filter((r) => !cursor || +new Date(r.updatedAt) > cursor[0] || (+new Date(r.updatedAt) === cursor[0] && String(r.id).localeCompare(cursor[1]) > 0))
    .sort((x, y) => +new Date(x.updatedAt) - +new Date(y.updatedAt) || String(x.id).localeCompare(String(y.id)))
    .slice(start, start + n);
}

export function zhNextAfter(rows: { updatedAt: Date | string; id?: unknown }[], limit?: string): string | null {
  if (rows.length < Math.min(Math.max(Number(limit) || 500, 1), 2000)) return null;
  const last = rows[rows.length - 1];
  return JSON.stringify([zhIso(last.updatedAt), String(last.id)]);
}


// ---------------- 统一设置 (0.4.0) ----------------
export interface ZhSettingItem {
  key: string;
  label: string;
  category: 'enterprise' | 'brand' | 'ai' | 'params' | 'integration' | 'security' | 'other';
  type: 'string' | 'text' | 'number' | 'boolean' | 'secret' | 'color' | 'select';
  value: unknown;
  zh_key: string | null;
  managed: boolean;
  editable: boolean;
  options?: { value: string; label: string }[] | null;
  help?: string | null;
}

export function zhMaskSecret(v?: string | null): string {
  if (!v) return '';
  return v.length <= 4 ? '****' : `****${v.slice(-4)}`;
}

export const zhIsMasked = (v: unknown): boolean => typeof v === 'string' && (v.startsWith('****') || /^•{4,}/.test(v));

export function zhSettingItem(
  key: string, label: string, category: ZhSettingItem['category'], value: unknown,
  opts: Partial<Pick<ZhSettingItem, 'type' | 'zh_key' | 'managed' | 'editable' | 'options' | 'help'>> = {},
): ZhSettingItem {
  const managed = !!opts.managed;
  return { key, label, category, value, type: opts.type ?? 'string', zh_key: opts.zh_key ?? null, managed,
    editable: (opts.editable ?? true) && !managed, options: opts.options ?? null, help: opts.help ?? null };
}

/** 平台接管清单(本地 JSON 文件); 只在接入平台(有 ZH_SERVICE_TOKEN)时生效 */
export class ZhManagedStore {
  constructor(private readonly file: string) {}

  load(): { managed: string[]; version: number } {
    try {
      if (!existsSync(this.file)) return { managed: [], version: 0 };
      const d = JSON.parse(readFileSync(this.file, 'utf-8'));
      return { managed: Array.isArray(d.managed) ? d.managed.map(String) : [], version: Number(d.version) || 0 };
    } catch {
      return { managed: [], version: 0 };
    }
  }

  save(managed: string[], version = 0): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ managed: [...new Set(managed)].sort(), version, updated_at: new Date().toISOString() }), 'utf-8');
    renameSync(tmp, this.file);
  }

  active(): Set<string> {
    return process.env.ZH_SERVICE_TOKEN ? new Set(this.load().managed) : new Set();
  }
}

/** 应用自己的设置接口保存前调用: 改动被平台接管的项时 409(值未变/掩码回填不算改动) */
export function zhRejectManagedChanges(
  store: ZhManagedStore, values: Record<string, unknown>, current: Record<string, unknown>, labels: Record<string, string> = {},
): void {
  const changed = [...store.active()].filter(
    (k) => k in values && !zhIsMasked(values[k]) && String(values[k] ?? '') !== String(current[k] ?? ''),
  );
  if (changed.length) {
    throw new ConflictException(`以下设置由智汇工作台统一管理，请到工作台「系统设置」修改：${changed.map((k) => labels[k] ?? k).join('、')}`);
  }
}

export interface ZhSettingsBody {
  zh_values?: Record<string, unknown>;
  managed?: string[];
  values?: Record<string, unknown>;
  version?: number;
}

/** PUT /api/zh/v1/settings 通用流程; mapping: zh_key → 内部键 */
export async function zhApplyPlatformSettings(
  body: ZhSettingsBody, mapping: Record<string, string>, store: ZhManagedStore,
  write: (updates: Record<string, string>) => Promise<void>,
) {
  const updates: Record<string, string> = {};
  const unsupported: string[] = [];
  for (const [zk, v] of Object.entries(body.zh_values ?? {})) {
    const ik = mapping[zk];
    if (!ik) { unsupported.push(zk); continue; }
    if (v === null || v === undefined || zhIsMasked(v)) continue;
    updates[ik] = String(v);
  }
  if (Array.isArray(body.managed)) {
    store.save(body.managed.filter((z) => z in mapping).map((z) => mapping[z]), Number(body.version) || 0);
  }
  const locked = store.active();
  const rejected: Record<string, string> = {};
  for (const [k, v] of Object.entries(body.values ?? {})) {
    if (locked.has(k)) { rejected[k] = '由智汇工作台统一管理'; continue; }
    if (v === null || v === undefined || zhIsMasked(v)) continue;
    updates[k] = String(v);
  }
  if (Object.keys(updates).length) await write(updates);
  return { ok: true, applied: Object.keys(updates).sort(), unsupported, rejected, managed: store.load().managed };
}

// ---------------- 统一登录: 平台签名身份 (0.4.0) ----------------
export interface ZhIdentity { sub: string; name: string; role: 'admin' | 'user'; aud: string; iat: number; exp: number }

/** 校验 X-ZH-Identity(base64url(载荷).base64url(HMAC-SHA256)), 失败返回 null */
export function zhVerifyIdentity(token: string | undefined | null, audience?: string): ZhIdentity | null {
  const key = process.env.ZH_IDENTITY_KEY || '';
  if (!key || !token || token.split('.').length !== 2) return null;
  const [body, sig] = token.split('.');
  const expected = createHmac('sha256', key).update(body).digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8')) as ZhIdentity;
    if (!claims || Number(claims.exp) < Date.now() / 1000) return null;
    if (audience && claims.aud !== audience) return null;
    return claims;
  } catch {
    return null;
  }
}
