import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as request from 'supertest';
import databaseConfig from '../../config/database.config';
import { Document } from './entities/document.entity';
import { DocumentVersion } from './entities/document-version.entity';
import { ZhDocumentImport } from './entities/zh-document-import.entity';
import { User } from '../users/entities/user.entity';
import { Role } from '../roles/entities/role.entity';
import { DocumentLink } from '../projects/entities/document-link.entity';
import { Requirement, RequirementAttachment } from '../requirements/entities/requirement.entity';
import { Product, ProductAttachment } from '../products/entities/product.entity';
import { ApprovalFlow } from '../approvals/entities/approval-flow.entity';
import { ApprovalsService } from '../approvals/approvals.service';
import { DocumentsService } from './documents.service';
import { ZhDocumentsService } from './zh-documents.service';
import { ZhDocumentsController, ZhKnowledgeHealthController, ZhServiceTokenGuard } from './zh-documents.controller';
import { FilesController } from '../files/files.controller';
import { PermissionService, CurrentUser } from '../../common/services/permission.service';
import { PermissionQueryService } from '../../common/services/permission-query.service';
import { TransactionService } from '../../common/services/transaction.service';
import { TransformInterceptor } from '../../common/interceptors/transform.interceptor';
import { AddZhDocumentImports1790987400000 } from '../../database/migrations/1790987400000-AddZhDocumentImports';

describe('Platform knowledge imports with a real isolated database', () => {
  let app: INestApplication;
  let database: DataSource;
  let documents: DocumentsService;
  let importer: ZhDocumentsService;
  let directory: string;
  let cwd: jest.SpyInstance;
  let owner: CurrentUser;
  const originalCwd = process.cwd();
  const originalEnvironment = { DB_TYPE: process.env.DB_TYPE, SQLITE_PATH: process.env.SQLITE_PATH, ZH_SERVICE_TOKEN: process.env.ZH_SERVICE_TOKEN };
  const ai = { parseFile: jest.fn(), parseFileDetailed: jest.fn(), addChunks: jest.fn() };
  const item = { id: 'md-001', source: 'doc-md-merger', title: '项目技术记录',
    content: '# 项目技术记录\n\n保留原始 Markdown 内容。\n', updated_at: '2026-10-03T00:00:00Z', project_ref: 'project-01' };
  const put = (items = [item], token = 'isolated-service-token') => {
    const call = request(app.getHttpServer()).put('/api/zh/v1/documents');
    if (token) call.set('X-ZH-Service-Token', token);
    return call.send({ items });
  };

  beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(originalCwd, 'data', 'zh-import-test-'));
    cwd = jest.spyOn(process, 'cwd').mockReturnValue(directory);
    process.env.DB_TYPE = 'sqlite';
    process.env.SQLITE_PATH = path.join(directory, 'test.db');
    process.env.ZH_SERVICE_TOKEN = 'isolated-service-token';
    database = new DataSource({ ...(databaseConfig() as any), synchronize: true, migrationsRun: false, migrations: [] });
    await database.initialize();
    const role = await database.getRepository(Role).save({ code: 'admin', name: '管理员', isActive: true });
    const account = await database.getRepository(User).save({ username: 'review_owner', password: 'test-only-hash',
      isActive: true, isSystemAdmin: true, roles: [role] });
    owner = { userId: account.id, username: account.username, roles: ['admin'], isSystemAdmin: true };
    const config = { get: jest.fn((key: string) => key === 'app.appMode' ? 'team' : undefined) } as any;
    const permissions = new PermissionService(config);
    const approvals = new ApprovalsService(database.getRepository(ApprovalFlow), { create: jest.fn().mockResolvedValue({}) } as any, database);
    documents = new DocumentsService(database.getRepository(Document), database.getRepository(DocumentVersion),
      database.getRepository(DocumentLink), config, ai as any, permissions, approvals, {} as any,
      new PermissionQueryService(config), new TransactionService(database), {} as any);
    importer = new ZhDocumentsService(database.getRepository(ZhDocumentImport), database.getRepository(Document),
      database.getRepository(User), documents, permissions);
    const module = await Test.createTestingModule({
      controllers: [ZhDocumentsController, ZhKnowledgeHealthController, FilesController],
      providers: [
        { provide: ZhDocumentsService, useValue: importer }, { provide: DataSource, useValue: database },
        { provide: PermissionService, useValue: permissions }, { provide: ConfigService, useValue: config }, ZhServiceTokenGuard,
        ...[Document, RequirementAttachment, Requirement, ProductAttachment, Product].map((entity) => ({
          provide: getRepositoryToken(entity), useValue: database.getRepository(entity),
        })),
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.use((req: any, _res: any, next: () => void) => {
      if (req.headers['x-test-user'] === 'owner') req.user = owner;
      if (req.headers['x-test-user'] === 'outsider') req.user = { userId: 'outside', username: 'outsider', roles: ['viewer'], isSystemAdmin: false };
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    if (database?.isInitialized) await database.destroy();
    cwd?.mockRestore();
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    if (directory && directory.startsWith(path.resolve(originalCwd, 'data') + path.sep)) fs.rmSync(directory, { recursive: true, force: true });
  });

  it('rejects missing and wrong service tokens, and tests real backend health', async () => {
    expect((await put([item], '')).status).toBe(401);
    expect((await put([item], 'wrong')).status).toBe(401);
    expect((await request(app.getHttpServer()).put('/api/zh/v1/documents')
      .set('Authorization', 'Bearer isolated-service-token').send({ items: [] })).status).toBe(200);
    expect(await database.getRepository(Document).count()).toBe(0);
    const health = await request(app.getHttpServer()).get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body.data).toMatchObject({ status: 'ok', database: 'ready' });
  });

  it('imports real Markdown and approval atomically, is idempotent, and uses normal permission-protected download', async () => {
    const first = await put();
    expect(first.status).toBe(200);
    expect(first.body.results[0].action).toBe('created');
    const id = first.body.results[0].local_id;
    const document = await database.getRepository(Document).findOneByOrFail({ id });
    expect(document).toMatchObject({ status: 'pending', visibility: 'role', uploaderId: owner.userId });
    expect(await database.getRepository(ApprovalFlow).findOneBy({ objectType: 'document', objectId: id })).toMatchObject({ status: 'pending' });
    expect(await documents.findKnowledge(owner)).toEqual(expect.arrayContaining([expect.objectContaining({ id })]));
    const again = await put();
    expect(again.body.results[0]).toMatchObject({ action: 'skipped', local_id: id });
    expect(await database.getRepository(Document).count()).toBe(1);
    const denied = await request(app.getHttpServer()).get(`/api/files/documents/${id}`).set('x-test-user', 'outsider');
    expect(denied.status).toBe(403);
    const file = await request(app.getHttpServer()).get(`/api/files/documents/${id}?download=1`).set('x-test-user', 'owner');
    expect(file.status).toBe(200);
    expect(file.text).toBe(item.content);
    expect((await documents.indexDocument(id, owner)).success).toBe(false);
    expect(ai.parseFileDetailed).not.toHaveBeenCalled();
    expect(ai.addChunks).not.toHaveBeenCalled();
  });

  it('preserves manually edited approved documents and creates a separately reviewable source revision', async () => {
    const original = await database.getRepository(Document).findOneByOrFail({ title: item.title });
    await documents.update(original.id, { title: '人工整理的定稿' }, owner);
    await documents.approve(original.id, owner);
    const oldFile = fs.readFileSync(documents.getFilePath(original.fileKey), 'utf8');
    const next = { ...item, content: '# 上游的新版本\n', updated_at: '2026-10-03T00:01:00Z' };
    const updated = await put([next]);
    expect(updated.body.results[0]).toMatchObject({ action: 'updated' });
    const newId = updated.body.results[0].local_id;
    expect(newId).not.toBe(original.id);
    expect(await database.getRepository(Document).findOneBy({ id: original.id })).toMatchObject({ title: '人工整理的定稿', status: 'approved' });
    expect(fs.readFileSync(documents.getFilePath(original.fileKey), 'utf8')).toBe(oldFile);
    expect(await database.getRepository(Document).findOneBy({ id: newId })).toMatchObject({ status: 'pending' });
    expect((await put([next])).body.results[0]).toMatchObject({ action: 'skipped', local_id: newId });
    expect((await put([item])).body.results[0]).toMatchObject({ action: 'skipped', local_id: newId, detail: 'stale_source_version' });
    expect(ai.parseFileDetailed).not.toHaveBeenCalled();
  });

  it('records per-item errors without interrupting other items and rolls back orphan files', async () => {
    const draft = jest.spyOn(documents, 'createWorkflowDraft').mockRejectedValueOnce(new Error('simulated approval failure'));
    const response = await put([{ ...item, id: 'bad-one' }, { ...item, id: 'good-one' }]);
    expect(response.body.results[0]).toMatchObject({ id: 'bad-one', action: 'error' });
    expect(response.body.results[1]).toMatchObject({ id: 'good-one', action: 'created' });
    draft.mockRestore();
    const before = fs.readdirSync(path.join(directory, 'data', 'uploads', 'knowledge', '工作流导入')).length;
    await expect(documents.createWorkflowDraft({ title: '回滚测试', content: '# test' }, owner, async () => { throw new Error('mapping failed'); })).rejects.toThrow('mapping failed');
    expect(await database.getRepository(Document).countBy({ title: '回滚测试' })).toBe(0);
    expect(fs.readdirSync(path.join(directory, 'data', 'uploads', 'knowledge', '工作流导入'))).toHaveLength(before);
    const invalid = await put([{ ...item, id: 'invalid-one', updated_at: 'not-a-date' }, { ...item, id: 'valid-one' }]);
    expect(invalid.body.results[0]).toMatchObject({ id: 'invalid-one', action: 'error' });
    expect(invalid.body.results[1]).toMatchObject({ id: 'valid-one', action: 'created' });
  });

  it('migrates the import mapping table using the actual SQLite driver', async () => {
    const isolated = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
    await isolated.initialize();
    const query = isolated.createQueryRunner();
    const migration = new AddZhDocumentImports1790987400000();
    await migration.up(query);
    expect(await query.hasTable('zh_document_imports')).toBe(true);
    expect((await query.getTable('zh_document_imports')).indices.filter((index) => index.isUnique)).toHaveLength(2);
    await migration.down(query);
    await query.release();
    await isolated.destroy();
  });
});
