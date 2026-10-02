import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';

describe('isolated team-mode startup', () => {
  it('runs migrations and serves the public system endpoint without using the developer database', async () => {
    const originalCwd = process.cwd();
    const names = ['APP_MODE', 'DB_TYPE', 'SQLITE_PATH', 'REDIS_ENABLED', 'AUTO_BACKUP_ENABLED',
      'JWT_SECRET', 'AI_SERVICE_API_KEY', 'FILE_ENCRYPTION_KEY', 'DEFAULT_ADMIN_PASSWORD', 'NODE_ENV'];
    const old = Object.fromEntries(names.map(name => [name, process.env[name]]));
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aikb-smoke-'));
    let app: INestApplication | undefined;
    try {
      process.chdir(temporary);
      Object.assign(process.env, {
        APP_MODE: 'team', DB_TYPE: 'sqlite', SQLITE_PATH: path.join(temporary, 'app.db'),
        REDIS_ENABLED: 'false', AUTO_BACKUP_ENABLED: 'false', NODE_ENV: 'test',
        JWT_SECRET: 'A'.repeat(64), AI_SERVICE_API_KEY: 'B'.repeat(48),
        FILE_ENCRYPTION_KEY: 'C'.repeat(64), DEFAULT_ADMIN_PASSWORD: 'D'.repeat(40),
      });
      const { AppModule } = require('./app.module');
      const fixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = fixture.createNestApplication();
      app.setGlobalPrefix('api');
      await app.init();
      await request(app.getHttpServer()).get('/api/system/info').expect(200);
      expect(fs.existsSync(path.join(temporary, 'app.db'))).toBe(true);
    } finally {
      if (app) await app.close();
      process.chdir(originalCwd);
      for (const name of names) {
        if (old[name] === undefined) delete process.env[name];
        else process.env[name] = old[name];
      }
      if (temporary.startsWith(os.tmpdir() + path.sep) &&
        path.basename(temporary).startsWith('aikb-smoke-')) {
        fs.rmSync(temporary, { recursive: true, force: true });
      }
    }
  }, 60000);
});
