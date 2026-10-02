import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AddManufacturingWorkflow1788700000000 } from '../../database/migrations/1788700000000-AddManufacturingWorkflow';
import { ManufacturingCase } from './entities/manufacturing.entity';
import { ManufacturingService } from './manufacturing.service';

describe('manufacturing workflow', () => {
  it('creates all workflow tables in SQLite', async () => {
    const db = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
    await db.initialize();
    try {
      const runner = db.createQueryRunner();
      await new AddManufacturingWorkflow1788700000000().up(runner);
      for (const table of ['manufacturing_cases', 'customer_equipment', 'technical_compliance',
        'manufacturing_reviews', 'engineering_changes', 'delivery_milestones']) {
        expect(await runner.hasTable(table)).toBe(true);
      }
      await runner.release();
    } finally {
      await db.destroy();
    }
  });

  it('requires a technical checklist before an equipment case can leave review', async () => {
    const row = { id: 'case-1', ownerId: 'owner', businessType: 'equipment', stage: 'review', version: 1 };
    const cases = { findOne: jest.fn().mockResolvedValue(row), save: jest.fn() };
    const compliance = { count: jest.fn().mockResolvedValue(0) };
    const service = new ManufacturingService(cases as any, {} as any, compliance as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      { isSingleMode: () => false, canApprove: () => false } as any);
    await expect(service.advanceCase('case-1', { userId: 'owner' } as any))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(cases.save).not.toHaveBeenCalled();
  });

  it('does not expose another owner\'s case to an approver', async () => {
    const cases = { findOne: jest.fn().mockResolvedValue({ id: 'case-1', ownerId: 'owner' }) };
    const service = new ManufacturingService(cases as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      { isSingleMode: () => false, canApprove: () => true } as any);
    await expect(service.getCase('case-1', { userId: 'reviewer' } as any))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('routes repeat parts through delivery and blocks closing without customer acceptance', async () => {
    const row = { id: 'case-1', ownerId: 'owner', businessType: 'repeat_part',
      stage: 'delivery', status: 'open', projectId: 'project-1', version: 3 };
    const cases = { findOne: jest.fn().mockResolvedValue(row), save: jest.fn() };
    const milestones = { count: jest.fn().mockResolvedValue(0), findOne: jest.fn().mockResolvedValue(null) };
    const service = new ManufacturingService(cases as any, {} as any, {} as any,
      {} as any, {} as any, milestones as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any,
      { isSingleMode: () => false } as any);
    expect(service.getDefinitions().stages.repeat_part).toContain('delivery');
    await expect(service.advanceCase('case-1', { userId: 'owner' } as any))
      .rejects.toThrow('请完成客户验收节点');
    expect(cases.save).not.toHaveBeenCalled();
  });

  it('uses a database version condition when closing a lost opportunity', async () => {
    const row = { id: 'case-1', ownerId: 'owner', businessType: 'equipment',
      stage: 'qualification', status: 'open', version: 2 };
    const cases = { findOne: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockResolvedValue({ affected: 0 }) };
    const service = new ManufacturingService(cases as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any,
      { isSingleMode: () => false } as any);
    await expect(service.loseCase('case-1', { version: 2, reason: '价格原因' },
      { userId: 'owner' } as any)).rejects.toBeInstanceOf(ConflictException);
    expect(cases.update).toHaveBeenCalledWith(
      { id: 'case-1', version: 2, stage: 'qualification', status: 'open' },
      { status: 'lost', lossReason: '价格原因', version: 3 },
    );
  });

  it('lists cases assigned to a participant without exposing unrelated cases', async () => {
    const db = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [ManufacturingCase] });
    await db.initialize();
    try {
      await new AddManufacturingWorkflow1788700000000().up(db.createQueryRunner());
      const repo = db.getRepository(ManufacturingCase);
      await repo.save(repo.create({ customerId: 'customer-1', title: '可见项目', businessType: 'equipment',
        ownerId: 'owner', participantIds: ['member'] }));
      await repo.save(repo.create({ customerId: 'customer-2', title: '其他项目', businessType: 'equipment',
        ownerId: 'other', participantIds: ['someone-else'] }));
      const service = new ManufacturingService(repo, {} as any, {} as any, {} as any,
        {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
        {} as any, {} as any, {} as any, { isSingleMode: () => false } as any);
      const rows = await service.listCases({ userId: 'member' } as any);
      expect(rows.map(row => row.title)).toEqual(['可见项目']);
    } finally {
      await db.destroy();
    }
  });
});
