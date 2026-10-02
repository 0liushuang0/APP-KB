import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { BackupService } from './backup.service';

/**
 * 补充测试：create ZIP 结构、list 列表、delete 删除。
 * 原 backup.service.spec.ts 已覆盖防穿越和还原逻辑，这里补齐剩余方法。
 */
describe('BackupService — 补充测试', () => {
  let tmpRoot: string;
  let dataDir: string;
  let originalCwd: string;
  let originalSqlitePath: string | undefined;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aikb-backup-extra-'));
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

  const makeService = () => new BackupService({ query: jest.fn() } as any);

  // ── list ──
  describe('list', () => {
    it('无备份时返回空数组', () => {
      expect(makeService().list()).toEqual([]);
    });

    it('返回所有 zip 文件并按时间倒序', () => {
      const dir = path.join(dataDir, 'backups');
      fs.writeFileSync(path.join(dir, 'backup-2026-01-01T00-00-00.zip'), 'a');
      fs.writeFileSync(path.join(dir, 'backup-2026-06-15T12-00-00.zip'), 'b');
      fs.writeFileSync(path.join(dir, 'not-a-backup.txt'), 'c'); // 非 zip 应被过滤

      const list = makeService().list();
      expect(list).toHaveLength(2);
      expect(list[0].fileName).toMatch(/2026-06/); // 最新的排前面
      expect(list.every((b) => b.filePath.endsWith('.zip'))).toBe(true);
    });

    it('每个条目包含 size 和 createdAt', () => {
      const dir = path.join(dataDir, 'backups');
      fs.writeFileSync(path.join(dir, 'backup-2026-01-01T00-00-00.zip'), 'hello');

      const list = makeService().list();
      expect(list[0].size).toBe(5); // 'hello' = 5 bytes
      expect(list[0].createdAt).toBeDefined();
    });

    it('backups 目录不存在时返回空数组', () => {
      fs.rmSync(path.join(dataDir, 'backups'), { recursive: true, force: true });
      expect(makeService().list()).toEqual([]);
    });
  });

  // ── remove ──
  describe('remove', () => {
    it('删除存在的备份文件', () => {
      const dir = path.join(dataDir, 'backups');
      const f = path.join(dir, 'backup-2026-01-01T00-00-00.zip');
      fs.writeFileSync(f, 'data');

      makeService().remove('backup-2026-01-01T00-00-00.zip');
      expect(fs.existsSync(f)).toBe(false);
    });

    it('删除不存在的文件抛出 NotFoundException', () => {
      expect(() => makeService().remove('nonexistent.zip')).toThrow(NotFoundException);
    });

    it('路径穿越被拦截，外部文件不被删除', () => {
      const victim = path.join(tmpRoot, 'important.txt');
      fs.writeFileSync(victim, 'do not delete');

      try {
        makeService().remove('../../important.txt');
      } catch {
        // 预期抛错
      }
      expect(fs.existsSync(victim)).toBe(true);
    });
  });

  // ── getPath ──
  describe('getPath', () => {
    it('返回完整路径', () => {
      const dir = path.join(dataDir, 'backups');
      const f = path.join(dir, 'test.zip');
      fs.writeFileSync(f, 'x');

      expect(makeService().getPath('test.zip')).toBe(f);
    });

    it('basename 规范化：传入子路径仍只取文件名', () => {
      const dir = path.join(dataDir, 'backups');
      const f = path.join(dir, 'safe.zip');
      fs.writeFileSync(f, 'x');

      // path.basename 会剥离目录部分
      const result = makeService().getPath('subdir/safe.zip');
      expect(result).toBe(f);
    });
  });

  // ── isRestorePending ──
  describe('isRestorePending', () => {
    it('无标记时返回 false', () => {
      expect(makeService().isRestorePending()).toBe(false);
    });

    it('有标记时返回 true', () => {
      fs.writeFileSync(path.join(dataDir, '.restore-pending'), '{}');
      expect(makeService().isRestorePending()).toBe(true);
    });
  });

  // ── acknowledgeRestoreFailure ──
  describe('acknowledgeRestoreFailure', () => {
    it('清除失败标记文件', () => {
      const failedPath = path.join(dataDir, '.restore-failed');
      fs.writeFileSync(failedPath, '{"error":"test"}');

      makeService().acknowledgeRestoreFailure();
      expect(fs.existsSync(failedPath)).toBe(false);
    });

    it('无失败标记时不抛错', () => {
      expect(() => makeService().acknowledgeRestoreFailure()).not.toThrow();
    });
  });
});
