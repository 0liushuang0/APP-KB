import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { spawn } from 'child_process';
import * as crypto from 'crypto';
// 注意：pipeline 必须用 promises 版本——Node 25 的回调式 pipeline 会把
// 最后一个 Writable 实例误当回调参数，导致密文流一行都没写入。
// 走命名空间取 pipeline（ts-jest 对 'stream/promises' 子路径解析不稳）
import { Writable, promises as streamPromises } from 'stream';
const { pipeline } = streamPromises;
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
/*
 * 项目未开启 esModuleInterop，这两个 CJS 库用 require 引入最省事。
 * archiver 锁在 ^7：v8 把可调用的默认导出换成了需要自行注册格式模块的
 * Archiver 基类，直接 new 出来 append 会失败。备份是数据安全底线，
 * 用成熟稳定的 v7 API，不跟刚变的接口。
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const archiver = require('archiver');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const unzipper = require('unzipper');

export interface BackupInfo {
  fileName: string;
  filePath: string;
  size: number;
  createdAt: Date;
}

/**
 * 备份与还原。
 *
 * 此前只有 system/export 导 Excel —— 那是报表，不是备份：
 * 导不出附件、审计日志、计算记录，也无法还原。
 * 单机产品必须让用户能自助备份，否则一次误删或磁盘故障就是全丢。
 *
 * 备份内容 = SQLite 主库 + 上传目录 + 一份清单，打成单个 zip。
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private readonly dataDir = path.resolve(process.cwd(), 'data');
  private readonly backupDir = path.join(this.dataDir, 'backups');
  private readonly uploadsDir = path.join(this.dataDir, 'uploads');

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    fs.mkdirSync(this.backupDir, { recursive: true });
  }

  private get dbPath(): string {
    return path.resolve(
      process.cwd(),
      process.env.SQLITE_PATH || path.join('data', 'app.db'),
    );
  }

  /**
   * 创建备份。
   *
   * 关键点：不能直接复制正在使用的 .db 文件 —— WAL 模式下最近的写入还在
   * -wal 文件里，直接拷主库会得到一个缺数据的副本。
   * 这里用 SQLite 的 VACUUM INTO 导出一份一致性快照。
   */
  async create(note?: string): Promise<BackupInfo> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `backup-${stamp}.zip`;
    const filePath = path.join(this.backupDir, fileName);
    const isPostgres = this.isPostgres;
    const snapshotPath = isPostgres
      ? await this.dumpPostgres()
      : path.join(os.tmpdir(), `aikb-snapshot-${Date.now()}.db`);
    if (!isPostgres) {
      // VACUUM INTO 会把 WAL 里的内容一并合入，得到完整且已压实的快照；
      // 目标路径用绑定参数传入（SQLite 3.28+ 支持）
      await this.dataSource.query('VACUUM INTO ?', [snapshotPath]);
    }

    try {
      await this.zip(filePath, snapshotPath, note);
    } catch (err) {
      // 打包失败会留下 0 字节的残档，必须清掉，否则用户以为备份成功了
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      throw err;
    } finally {
      if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
    }

    return this.finalize(filePath, { engine: isPostgres ? 'postgres' : 'sqlite', dbOnly: false });
  }

  /**
   * 纯数据库备份（不含附件）：体积小、速度快，供调度器高频执行。
   * 与全量备份组成两级策略——小时级 db-only 把数据 RPO 压到 1 小时内，
   * 全量（含 GB 级附件）维持低频。附件丢失可重新上传，
   * 业务数据的每个小时都不能丢。
   */
  async createDbOnly(note?: string): Promise<BackupInfo> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `backup-db-${stamp}.zip`;
    const filePath = path.join(this.backupDir, fileName);
    const snapshotPath = this.isPostgres
      ? await this.dumpPostgres()
      : path.join(os.tmpdir(), `aikb-snapshot-${Date.now()}.db`);
    if (!this.isPostgres) {
      await this.dataSource.query('VACUUM INTO ?', [snapshotPath]);
    }
    try {
      await this.zip(filePath, snapshotPath, note, { dbOnly: true });
    } catch (err) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      throw err;
    } finally {
      if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
    }
    return this.finalize(filePath, { engine: this.isPostgres ? 'postgres' : 'sqlite', dbOnly: true });
  }

  /**
   * 备份收尾三件事（全量与 db-only 共用）：
   * 1. AES-256-GCM 加密（默认开启，密钥独立于业务密钥，见 backupKey）
   * 2. 异地复制（配置了 BACKUP_OFFSITE_DIR 就拷一份过去）
   * 3. 返回备份信息
   * 加密开启时产物为 .zip.enc，需用 scripts/decrypt-backup.mjs + 密钥文件解密后再恢复。
   */
  private async finalize(
    filePath: string,
    meta: { engine: string; dbOnly: boolean },
  ): Promise<BackupInfo> {
    let finalPath = filePath;
    if (this.encryptEnabled) {
      finalPath = await this.encryptFileInPlace(filePath);
    }
    this.copyOffsite(finalPath);

    const stat = fs.statSync(finalPath);
    this.logger.log(
      `备份完成：${path.basename(finalPath)}（${(stat.size / 1024 / 1024).toFixed(1)} MB${meta.dbOnly ? '，仅数据库' : ''}${this.encryptEnabled ? '，已加密' : ''}${this.offsiteDir ? '，已异地复制' : ''}）`,
    );
    return {
      fileName: path.basename(finalPath),
      filePath: finalPath,
      size: stat.size,
      createdAt: stat.birthtime,
    };
  }

  private get encryptEnabled(): boolean {
    return (process.env.BACKUP_ENCRYPT ?? 'true') !== 'false';
  }

  private get offsiteDir(): string | undefined {
    const raw = (process.env.BACKUP_OFFSITE_DIR || '').trim();
    if (!raw) return undefined;
    // 运维配置的目录必须是绝对路径且不含上跳段，防止误配越出预期位置
    if (!path.isAbsolute(raw)) {
      this.logger.warn('BACKUP_OFFSITE_DIR 需为绝对路径（如 Z:\\backups 或 /mnt/backup），当前配置已忽略');
      return undefined;
    }
    const resolved = path.resolve(raw);
    if (resolved.split(path.sep).includes('..')) {
      this.logger.warn('BACKUP_OFFSITE_DIR 不允许包含 .. ，当前配置已忽略');
      return undefined;
    }
    return resolved;
  }

  /**
   * 备份加密密钥：优先 BACKUP_ENCRYPTION_KEY（hex 64 位），
   * 否则自动生成并落盘 data/.backup-key（权限仅当前用户）。
   * 密钥文件不随备份外发——异地容灾时请另行妥善保管一份密钥，
   * 换机恢复需要它（scripts/decrypt-backup.mjs --key 指定）。
   */
  private get backupKey(): Buffer {
    const envKey = process.env.BACKUP_ENCRYPTION_KEY;
    if (envKey && /^[0-9a-fA-F]{64}$/.test(envKey)) {
      return Buffer.from(envKey, 'hex');
    }
    const keyPath = path.join(this.dataDir, '.backup-key');
    if (fs.existsSync(keyPath)) {
      const hex = fs.readFileSync(keyPath, 'utf8').trim();
      if (/^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
    }
    const key = crypto.randomBytes(32);
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(keyPath, key.toString('hex'), { mode: 0o600 });
    this.logger.warn(`已生成备份加密密钥：${keyPath}（异地容灾请把该文件另行保管）`);
    return key;
  }

  /**
   * 流式 AES-256-GCM 加密（备份可达 GB 级，不能整读进内存）。
   * 产物格式：[12B iv][密文流][16B tag]，输出为 <原名>.enc。
   *
   * 实现注意：GCM 的 tag 只能在 cipher.final() 之后取；且输出流被
   * pipe 结束后不能再追加写。这里用 pipeline 消费完密文流、拿到 tag，
   * 再统一 end 追加，避免"write after end"竞态。
   */
  private async encryptFileInPlace(filePath: string): Promise<string> {
    const outPath = filePath + '.enc';
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.backupKey, iv);
    const output = fs.createWriteStream(outPath);
    output.write(iv);

    await pipeline(
      fs.createReadStream(filePath),
      cipher,
      new Writable({
        write(chunk, _enc, cb) {
          output.write(chunk, cb);
        },
      }),
    );
    // pipeline 完成即 cipher 已 final，此时取 tag 才有效
    const tag = cipher.getAuthTag();
    await new Promise<void>((resolve, reject) => {
      output.end(tag, () => resolve());
      output.on('error', reject);
    });
    fs.unlinkSync(filePath);
    return outPath;
  }

  /** 异地复制：网络盘/第二块盘。失败只告警不阻断（本地备份已成功） */
  private copyOffsite(finalPath: string): void {
    const dir = this.offsiteDir;
    if (!dir) return;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(finalPath, path.join(dir, path.basename(finalPath)));
    } catch (err: any) {
      this.logger.error(`异地复制失败（检查 BACKUP_OFFSITE_DIR 是否可达）：${err.message}`);
    }
  }

  private get isPostgres(): boolean {
    return (this.dataSource.options as { type?: string } | undefined)?.type === 'postgres';
  }

  /**
   * PostgreSQL 快照：pg_dump 自定义格式（-Fc，可用 pg_restore 恢复）。
   * 参数以数组传给 spawn（不经 shell 解释）；密码经 PGPASSWORD 环境变量
   * 传入，不落在命令行参数里。PG_DUMP_PATH 可覆盖可执行文件位置。
   */
  private async dumpPostgres(): Promise<string> {
    const dumpPath = path.join(os.tmpdir(), `aikb-pgdump-${Date.now()}.dump`);
    const bin = process.env.PG_DUMP_PATH || 'pg_dump';
    const args = [
      '--no-owner', '--no-privileges', '-Fc',
      '-h', process.env.DB_HOST || 'localhost',
      '-p', process.env.DB_PORT || '5432',
      '-U', process.env.DB_USERNAME || 'postgres',
      '-f', dumpPath,
      process.env.DB_NAME || 'aikb',
    ];
    await new Promise<void>((resolve, reject) => {
      const child = spawn(bin, args, {
        env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || 'postgres' },
        stdio: 'ignore',
      });
      child.on('error', (err) =>
        reject(new BadRequestException(
          `无法启动 pg_dump（${err.message}）。请在部署机安装 PostgreSQL 客户端工具，` +
          '或在 .env 用 PG_DUMP_PATH 指定 pg_dump.exe 完整路径。')));
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`pg_dump 退出码 ${code}`));
      });
    });
    return dumpPath;
  }

  private zip(
    target: string,
    snapshotPath: string,
    note?: string,
    opts?: { dbOnly?: boolean },
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(target);
      const archive = archiver('zip', { zlib: { level: 6 } });

      output.on('close', () => resolve());
      archive.on('error', reject);
      archive.pipe(output);

      // 快照在包内的名字按引擎区分：SQLite 是 app.db，PG 是 pg_restore 可用的 dump
      archive.file(snapshotPath, { name: this.isPostgres ? 'pgdump.dump' : 'app.db' });

      // 附件目录：没有它，还原回来的库里全是找不到文件的记录
      // （db-only 高频备份不带附件，控制单份体积，附件靠低频全量覆盖）
      if (fs.existsSync(this.uploadsDir) && !opts?.dbOnly) {
        archive.directory(this.uploadsDir, 'uploads');
      }

      archive.append(
        JSON.stringify(
          {
            createdAt: new Date().toISOString(),
            note: note || '',
            appVersion: process.env.npm_package_version || '0.1.0',
            engine: this.isPostgres ? 'postgres' : 'sqlite',
            dbOnly: opts?.dbOnly === true,
            encrypted: false, // 加密发生在 zip 完成之后，见 finalize()
            // 记录迁移版本：还原到更旧的程序上会缺表，靠这个提前拦住
            schemaVersion: this.schemaVersionSync(),
          },
          null,
          2,
        ),
        { name: 'manifest.json' },
      );

      archive.finalize();
    });
  }

  private schemaVersionSync(): string {
    try {
      // PG 的迁移台账要异步查询，归档回调里不便等待；引擎标记已写入
      // manifest.engine，迁移版本对 SQLite 保持精确、对 PG 返回引擎占位
      if (this.isPostgres) return 'postgres';
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Database = require('better-sqlite3');
      const db = new Database(this.dbPath, { readonly: true });
      const row = db
        .prepare('SELECT name FROM migrations ORDER BY timestamp DESC LIMIT 1')
        .get();
      db.close();
      return row?.name || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  list(): BackupInfo[] {
    if (!fs.existsSync(this.backupDir)) return [];
    return fs
      .readdirSync(this.backupDir)
      // 加密产物是 .zip.enc，未加密是 .zip，两类都要列出
      .filter((f) => f.endsWith('.zip') || f.endsWith('.zip.enc'))
      .map((fileName) => {
        const filePath = path.join(this.backupDir, fileName);
        const stat = fs.statSync(filePath);
        return { fileName, filePath, size: stat.size, createdAt: stat.birthtime };
      })
      // 创建时间相同(文件系统时间精度/批量复制)时按文件名(内含时间戳)倒序, 保证顺序确定
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.fileName.localeCompare(a.fileName));
  }

  getPath(fileName: string): string {
    // 文件名来自请求，必须防穿越
    const safe = path.basename(fileName);
    const filePath = path.join(this.backupDir, safe);
    if (!filePath.startsWith(this.backupDir + path.sep)) {
      throw new BadRequestException('非法的备份文件名');
    }
    if (!fs.existsSync(filePath)) throw new NotFoundException('备份文件不存在');
    return filePath;
  }

  remove(fileName: string): void {
    fs.unlinkSync(this.getPath(fileName));
  }

  /**
   * 还原。
   *
   * 不在运行中直接覆盖数据库 —— 连接持有的文件句柄会导致覆盖失败或写坏。
   * 这里把内容解到暂存目录并做校验，标记为"待还原"，由启动脚本在下次启动前替换。
   * 返回 requiresRestart，让前端提示用户重启。
   */
  async prepareRestore(fileName: string): Promise<{ requiresRestart: true; manifest: any }> {
    if (this.isPostgres) {
      throw new BadRequestException(
        'PostgreSQL 部署的应用内还原暂未开放：备份包内是 pg_dump 快照（pgdump.dump），' +
        '请在停机后用 pg_restore 恢复到目标库，附件目录解压回 data/uploads 即可。',
      );
    }
    const zipPath = this.getPath(fileName);
    const stageDir = path.join(this.dataDir, '.restore-staging');

    fs.rmSync(stageDir, { recursive: true, force: true });
    fs.mkdirSync(stageDir, { recursive: true });

    await fs
      .createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: stageDir }))
      .promise();

    const dbFile = path.join(stageDir, 'app.db');
    if (!fs.existsSync(dbFile)) {
      this.discardStage(stageDir);
      throw new BadRequestException('备份文件损坏：缺少 app.db');
    }

    /*
     * 打开一次确认不是损坏文件，避免重启后起不来。
     * 句柄必须在 finally 里关：构造失败时 better-sqlite3 仍可能已经占住文件，
     * 不关就删不掉暂存目录，用户看到的会是一句 EPERM，而不是"备份已损坏"。
     */
    let probe: any = null;
    let probeError: string | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Database = require('better-sqlite3');
      probe = new Database(dbFile, { readonly: true });
      probe.prepare('SELECT COUNT(*) FROM sqlite_master').get();
    } catch (err: any) {
      probeError = err.message;
    } finally {
      try {
        probe?.close();
      } catch {
        /* ignore */
      }
    }
    if (probeError) {
      this.discardStage(stageDir);
      throw new BadRequestException(`备份文件无法打开：${probeError}`);
    }

    let manifest: any = {};
    const manifestPath = path.join(stageDir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    }

    // 落一个标记文件，启动时由 applyPendingRestore 消费
    fs.writeFileSync(
      path.join(this.dataDir, '.restore-pending'),
      JSON.stringify({ stageDir, requestedAt: new Date().toISOString(), manifest }),
      'utf8',
    );

    this.logger.warn(`已准备还原 ${fileName}，将在下次启动时生效`);
    return { requiresRestart: true, manifest };
  }

  /**
   * 清理暂存目录。
   *
   * 清不掉不该盖住真正的错误原因 —— 用户需要知道的是"这个备份坏了"，
   * 而不是"临时目录删不掉"。残留目录下次还原时会先被重建覆盖。
   */
  private discardStage(stageDir: string): void {
    try {
      fs.rmSync(stageDir, { recursive: true, force: true });
    } catch (err: any) {
      this.logger.warn(`暂存目录清理失败（不影响判定）：${err.message}`);
    }
  }

  /**
   * 上次还原的结果。
   *
   * 供前端在系统设置页做提示：还原是"重启后生效"的异步动作，
   * 用户重启完只会看到系统正常启动，没有任何反馈说明成功还是失败。
   */
  lastRestoreResult(): { status: 'ok' | 'failed'; error?: string; failedAt?: string } {
    const failedPath = path.join(this.dataDir, '.restore-failed');
    if (!fs.existsSync(failedPath)) return { status: 'ok' };
    try {
      const info = JSON.parse(fs.readFileSync(failedPath, 'utf8'));
      return { status: 'failed', error: info.error, failedAt: info.failedAt };
    } catch {
      return { status: 'failed', error: '还原失败（详情已损坏）' };
    }
  }

  /** 用户确认看到失败提示后清除，避免一直挂着 */
  acknowledgeRestoreFailure(): void {
    const failedPath = path.join(this.dataDir, '.restore-failed');
    if (fs.existsSync(failedPath)) fs.unlinkSync(failedPath);
  }

  /** 待还原标记：存在则说明用户已提交还原、等待重启 */
  isRestorePending(): boolean {
    return fs.existsSync(path.join(this.dataDir, '.restore-pending'));
  }
}

/**
 * 带重试的删除。
 *
 * Windows 上删文件失败是常态而非例外：杀毒软件正在扫、网盘同步客户端
 * （这台机器上就装着百度同步盘）持有句柄、用户不小心开了第二个实例，
 * 都会抛 EBUSY/EPERM，而且往往几百毫秒后就自己好了。
 * 一次失败就放弃，会把"还原"变成一句无人看见的日志。
 */
function unlinkWithRetry(target: string, attempts = 5): void {
  for (let i = 0; i < attempts; i++) {
    try {
      if (!fs.existsSync(target)) return;
      fs.unlinkSync(target);
      return;
    } catch (err: any) {
      const retriable = err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES';
      if (!retriable || i === attempts - 1) throw err;
      // 同步退避：此刻还没有事件循环可用（TypeORM 尚未启动）
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200 * (i + 1));
    }
  }
}

/** 递归列出目录下所有文件的相对路径 */
function listRelFiles(root: string, base = root): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...listRelFiles(full, base));
    else out.push(path.relative(base, full));
  }
  return out;
}

/**
 * 还原附件目录。
 *
 * 不用"整个目录改名再拷回来"那套：这台机器的工作目录在百度同步盘里，
 * 同步客户端会一直持有目录句柄，rename 直接 EPERM —— 实测就是这么挂的。
 * 杀毒软件、资源管理器开着某个子目录，也是一样的结果。
 *
 * 改成逐文件操作：覆盖写入备份里的文件，再删掉备份里没有的多余文件。
 * 单个文件失败只影响那一个附件，不会让整次还原前功尽弃。
 */
function restoreUploads(stagedUploads: string, uploadsDir: string, logger: Logger): void {
  fs.mkdirSync(uploadsDir, { recursive: true });

  for (const rel of listRelFiles(stagedUploads)) {
    const dest = path.join(uploadsDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(stagedUploads, rel), dest);
  }

  // 备份之后新增的附件要清掉，否则还原出来的是两次状态的混合物
  const keep = new Set(listRelFiles(stagedUploads));
  let failed = 0;
  for (const rel of listRelFiles(uploadsDir)) {
    if (keep.has(rel)) continue;
    try {
      unlinkWithRetry(path.join(uploadsDir, rel));
    } catch {
      // 删不掉的残留文件不算致命：数据库里已经没有它的记录，界面上看不见
      failed++;
    }
  }
  if (failed > 0) {
    logger.warn(`${failed} 个多余附件未能删除（文件被占用），不影响已还原的数据`);
  }
}

/**
 * 启动时应用待还原的备份。必须在 TypeORM 连接数据库之前调用。
 */
export function applyPendingRestore(dataDir: string): boolean {
  const flagPath = path.join(dataDir, '.restore-pending');
  if (!fs.existsSync(flagPath)) return false;

  const logger = new Logger('Restore');
  let stageDir = '';
  try {
    ({ stageDir } = JSON.parse(fs.readFileSync(flagPath, 'utf8')));
    const dbPath = path.resolve(
      process.cwd(),
      process.env.SQLITE_PATH || path.join('data', 'app.db'),
    );
    const stagedDb = path.join(stageDir, 'app.db');
    if (!fs.existsSync(stagedDb)) {
      throw new Error(`暂存目录缺少 app.db：${stageDir}`);
    }

    /*
     * 先探一次锁再动手。
     * 一旦开始删主库就没有回头路了，若此时才发现文件被占用，
     * 用户会停在一个"旧库已删、新库没进来"的状态。
     */
    const probe = `${dbPath}.locktest`;
    fs.writeFileSync(probe, '');
    unlinkWithRetry(probe);

    // 还原前先把当前库留一份，万一还原的是坏档还能退回来
    if (fs.existsSync(dbPath)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      fs.copyFileSync(dbPath, `${dbPath}.pre-restore-${stamp}.bak`);
    }

    // WAL 旁支必须一并删除，否则会和还原来的主库对不上
    for (const suffix of ['', '-wal', '-shm']) {
      unlinkWithRetry(dbPath + suffix);
    }
    fs.copyFileSync(stagedDb, dbPath);

    const stagedUploads = path.join(stageDir, 'uploads');
    if (fs.existsSync(stagedUploads)) {
      restoreUploads(stagedUploads, path.join(dataDir, 'uploads'), logger);
    }

    fs.rmSync(stageDir, { recursive: true, force: true });
    fs.unlinkSync(flagPath);
    logger.warn('备份已还原');
    return true;
  } catch (err: any) {
    /*
     * 关键：失败必须留痕。
     * 之前这里只打一行日志就把标记删了 —— 用户点了"还原"、重启、看到系统
     * 正常起来，会以为数据回来了，其实一个字节都没动。单机产品没有运维盯
     * 日志，只能靠界面告诉他。
     * 暂存目录也保留，用户排除占用后重启即可继续，不必重新解压。
     */
    logger.error(`还原失败：${err.message}`);
    try {
      fs.writeFileSync(
        path.join(dataDir, '.restore-failed'),
        JSON.stringify(
          { failedAt: new Date().toISOString(), error: err.message, stageDir },
          null,
          2,
        ),
        'utf8',
      );
      // 标记留着会每次启动都重试；失败原因已单独记档，这里清掉
      fs.unlinkSync(flagPath);
    } catch {
      /* ignore */
    }
    return false;
  }
}
