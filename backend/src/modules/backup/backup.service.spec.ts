import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BackupService, applyPendingRestore } from './backup.service';

/**
 * 备份还原是数据安全的最后一道防线，出问题的代价是全量数据丢失，
 * 所以这里覆盖三类真实会发生的情况：
 *   1. 文件名穿越（备份文件名来自请求参数）
 *   2. 坏档 / 半个备份（拷贝中断、手工放错文件）
 *   3. 还原失败必须留痕（单机产品没人看日志）
 */
describe('BackupService', () => {
  let tmpRoot: string;
  let dataDir: string;
  let originalCwd: string;
  let originalSqlitePath: string | undefined;

  const makeDb = (target: string, customers: number) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3');
    const db = new Database(target);
    db.exec('CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT)');
    const insert = db.prepare('INSERT INTO customers (name) VALUES (?)');
    for (let i = 0; i < customers; i++) insert.run(`客户${i}`);
    db.close();
  };

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aikb-backup-test-'));
    dataDir = path.join(tmpRoot, 'data');
    fs.mkdirSync(path.join(dataDir, 'backups'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });

    originalCwd = process.cwd();
    originalSqlitePath = process.env.SQLITE_PATH;
    process.chdir(tmpRoot);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalSqlitePath === undefined) delete process.env.SQLITE_PATH;
    else process.env.SQLITE_PATH = originalSqlitePath;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  /** dataSource 只在 create() 里用来跑 VACUUM INTO，这里给个假的即可 */
  const makeService = () => new BackupService({ query: jest.fn() } as any);

  describe('getPath —— 备份文件名防穿越', () => {
    const traversals = [
      '../../../../Windows/System32/config/SAM',
      '..\\..\\..\\Windows\\win.ini',
      '/etc/passwd',
      '....//....//app.db',
    ];

    it.each(traversals)('拒绝或规范化穿越路径：%s', (evil) => {
      const service = makeService();
      let resolved: string | null = null;
      try {
        resolved = service.getPath(evil);
      } catch (err) {
        // 抛错也是可接受的结果，只要没逃出备份目录
        expect(err).toBeInstanceOf(Error);
      }
      if (resolved) {
        expect(resolved.startsWith(path.join(dataDir, 'backups'))).toBe(true);
      }
    });

    it('文件不存在时报 404 而不是返回一个无效路径', () => {
      expect(() => makeService().getPath('never-made.zip')).toThrow(NotFoundException);
    });

    it('正常文件名可以取到', () => {
      const f = path.join(dataDir, 'backups', 'backup-2026-01-01T00-00-00.zip');
      fs.writeFileSync(f, 'x');
      expect(makeService().getPath('backup-2026-01-01T00-00-00.zip')).toBe(f);
    });

    it('remove 走同一套校验，不能被穿越删掉外部文件', () => {
      const victim = path.join(tmpRoot, 'important.txt');
      fs.writeFileSync(victim, 'do not delete');
      try {
        makeService().remove('../important.txt');
      } catch {
        /* 预期抛错 */
      }
      expect(fs.existsSync(victim)).toBe(true);
    });
  });

  describe('prepareRestore —— 坏档拦截', () => {
    it('压缩包里没有 app.db 时拒绝，并且不留下待还原标记', async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const archiver = require('archiver');
      const zipPath = path.join(dataDir, 'backups', 'broken.zip');
      await new Promise<void>((resolve, reject) => {
        const out = fs.createWriteStream(zipPath);
        const a = archiver('zip');
        out.on('close', () => resolve());
        a.on('error', reject);
        a.pipe(out);
        a.append('{}', { name: 'manifest.json' });
        a.finalize();
      });

      await expect(makeService().prepareRestore('broken.zip')).rejects.toThrow(
        BadRequestException,
      );
      expect(fs.existsSync(path.join(dataDir, '.restore-pending'))).toBe(false);
    });

    it('app.db 不是合法 SQLite 文件时拒绝', async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const archiver = require('archiver');
      const zipPath = path.join(dataDir, 'backups', 'corrupt.zip');
      await new Promise<void>((resolve, reject) => {
        const out = fs.createWriteStream(zipPath);
        const a = archiver('zip');
        out.on('close', () => resolve());
        a.on('error', reject);
        a.pipe(out);
        a.append('这不是数据库', { name: 'app.db' });
        a.finalize();
      });

      await expect(makeService().prepareRestore('corrupt.zip')).rejects.toThrow(
        BadRequestException,
      );
      expect(fs.existsSync(path.join(dataDir, '.restore-pending'))).toBe(false);
    });
  });

  describe('applyPendingRestore —— 启动时替换', () => {
    it('没有标记时不做任何事', () => {
      expect(applyPendingRestore(dataDir)).toBe(false);
    });

    it('还原数据库并保留回退档', () => {
      const dbPath = path.join(dataDir, 'app.db');
      process.env.SQLITE_PATH = dbPath;
      makeDb(dbPath, 5); // 当前库：5 条

      const stageDir = path.join(dataDir, '.restore-staging');
      fs.mkdirSync(stageDir, { recursive: true });
      makeDb(path.join(stageDir, 'app.db'), 42); // 备份里：42 条

      fs.writeFileSync(
        path.join(dataDir, '.restore-pending'),
        JSON.stringify({ stageDir }),
        'utf8',
      );

      expect(applyPendingRestore(dataDir)).toBe(true);

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });
      expect(db.prepare('SELECT COUNT(*) c FROM customers').get().c).toBe(42);
      db.close();

      // 回退档还在，误还原可以人工救回
      expect(fs.readdirSync(dataDir).some((f) => f.includes('pre-restore'))).toBe(true);
      // 标记与暂存清理掉，避免下次启动重复还原
      expect(fs.existsSync(path.join(dataDir, '.restore-pending'))).toBe(false);
      expect(fs.existsSync(stageDir)).toBe(false);
    });

    it('WAL 旁支文件一并清除，否则会和还原来的主库对不上', () => {
      const dbPath = path.join(dataDir, 'app.db');
      process.env.SQLITE_PATH = dbPath;
      makeDb(dbPath, 1);
      fs.writeFileSync(`${dbPath}-wal`, 'stale wal');
      fs.writeFileSync(`${dbPath}-shm`, 'stale shm');

      const stageDir = path.join(dataDir, '.restore-staging');
      fs.mkdirSync(stageDir, { recursive: true });
      makeDb(path.join(stageDir, 'app.db'), 3);
      fs.writeFileSync(
        path.join(dataDir, '.restore-pending'),
        JSON.stringify({ stageDir }),
        'utf8',
      );

      applyPendingRestore(dataDir);

      expect(fs.existsSync(`${dbPath}-wal`)).toBe(false);
      expect(fs.existsSync(`${dbPath}-shm`)).toBe(false);
    });

    it('附件按文件还原：备份里的补回来，备份之后新增的清掉', () => {
      const dbPath = path.join(dataDir, 'app.db');
      process.env.SQLITE_PATH = dbPath;
      makeDb(dbPath, 1);

      const uploadsDir = path.join(dataDir, 'uploads');
      fs.mkdirSync(path.join(uploadsDir, 'documents'), { recursive: true });
      fs.writeFileSync(path.join(uploadsDir, 'documents', '备份后新增.txt'), 'new');

      const stageDir = path.join(dataDir, '.restore-staging');
      const stagedUploads = path.join(stageDir, 'uploads', 'knowledge', '维护手册');
      fs.mkdirSync(stagedUploads, { recursive: true });
      makeDb(path.join(stageDir, 'app.db'), 1);
      fs.writeFileSync(path.join(stagedUploads, '圆盘剪说明书.docx'), 'doc');

      fs.writeFileSync(
        path.join(dataDir, '.restore-pending'),
        JSON.stringify({ stageDir }),
        'utf8',
      );

      expect(applyPendingRestore(dataDir)).toBe(true);
      expect(
        fs.existsSync(path.join(uploadsDir, 'knowledge', '维护手册', '圆盘剪说明书.docx')),
      ).toBe(true);
      expect(fs.existsSync(path.join(uploadsDir, 'documents', '备份后新增.txt'))).toBe(false);
    });

    it('失败时写下 .restore-failed，不能让用户以为还原成功了', () => {
      process.env.SQLITE_PATH = path.join(dataDir, 'app.db');
      const stageDir = path.join(dataDir, '.restore-staging');
      fs.mkdirSync(stageDir, { recursive: true }); // 故意不放 app.db

      fs.writeFileSync(
        path.join(dataDir, '.restore-pending'),
        JSON.stringify({ stageDir }),
        'utf8',
      );

      expect(applyPendingRestore(dataDir)).toBe(false);

      const failed = path.join(dataDir, '.restore-failed');
      expect(fs.existsSync(failed)).toBe(true);
      expect(JSON.parse(fs.readFileSync(failed, 'utf8')).error).toContain('app.db');
      // 待还原标记必须清掉，否则每次启动都重试同一个坏档
      expect(fs.existsSync(path.join(dataDir, '.restore-pending'))).toBe(false);
    });
  });

  describe('还原结果上报', () => {
    it('无失败标记时为 ok', () => {
      expect(makeService().lastRestoreResult()).toEqual({ status: 'ok' });
    });

    it('读出失败原因，确认后可清除', () => {
      fs.writeFileSync(
        path.join(dataDir, '.restore-failed'),
        JSON.stringify({ failedAt: '2026-01-01T00:00:00Z', error: '文件被占用' }),
        'utf8',
      );
      const service = makeService();
      expect(service.lastRestoreResult()).toMatchObject({
        status: 'failed',
        error: '文件被占用',
      });
      service.acknowledgeRestoreFailure();
      expect(service.lastRestoreResult().status).toBe('ok');
    });
  });
});
