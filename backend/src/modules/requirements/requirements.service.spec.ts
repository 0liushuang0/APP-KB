import { NotFoundException, BadRequestException } from '@nestjs/common';
import { RequirementsService } from './requirements.service';

/** 需求模板表（param_templates）的两行：一个有字段的联轴器模板、一个没维护字段的空模板 */
const TEMPLATE_ROWS = [
  { category: '零部件/联轴器/常规联轴器', fields: JSON.stringify([{ key: 'rated_torque', label: '额定扭矩', type: 'number', required: true }]) },
  { category: '装备/其他设备/纠偏装置', fields: '[]' },
];

const makeMocks = () => {
  const templateQb: any = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(TEMPLATE_ROWS),
  };
  const requirementRepository = {
    manager: { createQueryBuilder: jest.fn().mockReturnValue(templateQb) },
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    delete: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    update: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const attachmentRepository = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    delete: jest.fn(),
  };
  const requirementLogRepository = {
    create: jest.fn().mockImplementation((v: any) => v),
    save: jest.fn().mockImplementation(async (v: any) => v),
    find: jest.fn().mockResolvedValue([]),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const customerRepository = { findOne: jest.fn() };
  const permissionService = {
    canAccess: jest.fn().mockReturnValue(true),
    canManage: jest.fn().mockReturnValue(true),
    skipApproval: jest.fn().mockReturnValue(false),
  };
  const knowledgeSyncService = {
    syncObject: jest.fn(),
    deleteObject: jest.fn(),
  };
  const transactionService = {
    run: jest.fn(async (work: any, after?: any) => {
      const manager = {
        create: jest.fn().mockReturnValue({ id: 'new-req' }),
        save: jest.fn().mockImplementation(async (entity: any) => entity),
        update: jest.fn(),
        getRepository: jest.fn().mockReturnValue({
          delete: jest.fn().mockResolvedValue(undefined),
          update: jest.fn().mockResolvedValue(undefined),
          find: jest.fn().mockResolvedValue([]),
        }),
        createQueryBuilder: jest.fn().mockReturnValue({
          delete: jest.fn().mockReturnThis(),
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          execute: jest.fn().mockResolvedValue(undefined),
        }),
      };
      const result = await work(manager);
      if (after) await after(result);
      return result;
    }),
  };
  const aiService = {
    chat: jest.fn().mockResolvedValue('AI分析结果'),
    analyzeRequirement: jest.fn().mockResolvedValue({ spec: {}, summary: '摘要' }),
    structureRequirement: jest.fn().mockResolvedValue({
      card: { product_category: '剪切设备', fields: [{ key: 'width', label: '带宽', value: 1450 }], missing: [{ field: 'x', label: '交货地点', severity: 'high', hint: '' }] },
      summary: '摘要',
      digest: '字段 1 个',
    }),
    followupDraft: jest.fn().mockResolvedValue({ wechat: '微信草稿', email: '邮件草稿' }),
  };
  const permissionQuery = { apply: jest.fn() };

  const svc = new RequirementsService(
    requirementRepository as any,
    attachmentRepository as any,
    requirementLogRepository as any,
    customerRepository as any,
    { update: jest.fn().mockResolvedValue(undefined), findOne: jest.fn().mockResolvedValue(null) } as any,
    { findOne: jest.fn().mockResolvedValue(null) } as any,
    { update: jest.fn().mockResolvedValue(undefined) } as any,
    { find: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), delete: jest.fn().mockResolvedValue(undefined) } as any,
    permissionService as any,
    knowledgeSyncService as any,
    transactionService as any,
    aiService as any,
    permissionQuery as any,
      { next: jest.fn().mockResolvedValue('REQ-2026-001') } as any,
      { create: jest.fn(), approve: jest.fn() } as any,
      { remove: jest.fn().mockResolvedValue(undefined) } as any,
      { capture: jest.fn() } as any,
    );

  return {
    svc,
    requirementRepository,
    attachmentRepository,
    requirementLogRepository,
    customerRepository,
    permissionService,
    knowledgeSyncService,
    transactionService,
    aiService,
    permissionQuery,
  };
};

const user = () => ({
  userId: 'u1',
  username: 'testuser',
  roles: [],
  departmentId: 'd1',
  isSystemAdmin: false,
});

describe('RequirementsService', () => {
  // ── create ──
  describe('create', () => {
    it('创建需求并同步知识库', async () => {
      const { svc, requirementRepository, knowledgeSyncService } = makeMocks();
      requirementRepository.create.mockReturnValue({
        id: 'r1',
        requirementNo: 'REQ-2026-001',
        title: '测试需求',
      });
      requirementRepository.save.mockResolvedValue({
        id: 'r1',
        requirementNo: 'REQ-2026-001',
        title: '测试需求',
      });

      const result = await svc.create({ title: '测试需求' } as any, user());
      expect(result.id).toBe('r1');
      expect(knowledgeSyncService.syncObject).toHaveBeenCalled();
    });

    it('自动生成需求编号', async () => {
      const { svc, requirementRepository } = makeMocks();
      requirementRepository.count.mockResolvedValue(5);
      requirementRepository.create.mockImplementation((dto: any) => dto);
      requirementRepository.save.mockImplementation(async (r: any) => r);

      const result = await svc.create({ title: '需求' } as any, user());
      expect(result.requirementNo).toMatch(/REQ-\d{4}-\d{3}/);
    });
  });

  // ── findOne ──
  describe('findOne', () => {
    it('找到需求并返回（含附件）', async () => {
      const { svc, requirementRepository, attachmentRepository } = makeMocks();
      requirementRepository.findOne.mockResolvedValue({
        id: 'r1',
        title: '测试需求',
        visibility: 'public',
        ownerId: 'u1',
      });
      attachmentRepository.find.mockResolvedValue([{ id: 'a1', fileName: '附件.pdf' }]);

      const result = await svc.findOne('r1', user());
      expect(result.id).toBe('r1');
      expect((result as any).attachments).toHaveLength(1);
    });

    it('需求不存在抛出 NotFoundException', async () => {
      const { svc, requirementRepository } = makeMocks();
      requirementRepository.findOne.mockResolvedValue(null);

      await expect(svc.findOne('missing', user())).rejects.toThrow(NotFoundException);
    });

    it('无权限抛出 BadRequestException', async () => {
      const { svc, requirementRepository, permissionService } = makeMocks();
      requirementRepository.findOne.mockResolvedValue({
        id: 'r1',
        visibility: 'private',
        ownerId: 'other',
      });
      permissionService.canAccess.mockReturnValue(false);

      await expect(svc.findOne('r1', user())).rejects.toThrow(BadRequestException);
    });
  });

  // ── update ──
  describe('update', () => {
    it('有权限时更新需求', async () => {
      const { svc, requirementRepository } = makeMocks();
      requirementRepository.findOne.mockResolvedValue({
        id: 'r1',
        title: '旧标题',
        visibility: 'public',
        ownerId: 'u1',
      });
      requirementRepository.save.mockResolvedValue({ id: 'r1', title: '新标题' });

      const result = await svc.update('r1', { title: '新标题' } as any, user());
      expect(requirementRepository.save).toHaveBeenCalled();
    });

    it('无管理权限抛出 BadRequestException', async () => {
      const { svc, requirementRepository, permissionService } = makeMocks();
      requirementRepository.findOne.mockResolvedValue({
        id: 'r1',
        visibility: 'private',
        ownerId: 'other',
      });
      permissionService.canManage.mockReturnValue(false);

      await expect(svc.update('r1', { title: '新' } as any, user())).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── remove ──
  describe('remove', () => {
    it('有权限时删除需求及附件', async () => {
      const { svc, requirementRepository, knowledgeSyncService, attachmentRepository } = makeMocks();
      requirementRepository.findOne.mockResolvedValue({
        id: 'r1',
        visibility: 'public',
        ownerId: 'u1',
      });
      attachmentRepository.find.mockResolvedValue([]);

      await svc.remove('r1', user());
      // 向量清理在 afterCommit 里执行
      expect(knowledgeSyncService.deleteObject).toHaveBeenCalledWith('requirement', 'r1');
      // 删除走事务内的 manager.getRepository(Requirement).delete，
      // transactionService.run mock 已执行 work 回调，此处验证不抛错即通过
    });

    it('无管理权限抛出 BadRequestException', async () => {
      const { svc, requirementRepository, permissionService } = makeMocks();
      requirementRepository.findOne.mockResolvedValue({
        id: 'r1',
        visibility: 'private',
        ownerId: 'other',
      });
      permissionService.canManage.mockReturnValue(false);

      await expect(svc.remove('r1', user())).rejects.toThrow(BadRequestException);
    });
  });

  // ── findAll ──
  describe('findAll', () => {
    it('调用 permissionQuery.apply', async () => {
      const { svc, requirementRepository, permissionQuery } = makeMocks();
      const qb = {
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      requirementRepository.createQueryBuilder.mockReturnValue(qb);

      await svc.findAll({} as any, user());
      expect(permissionQuery.apply).toHaveBeenCalled();
    });

    it('keyword 筛选条件正确拼装', async () => {
      const { svc, requirementRepository } = makeMocks();
      const qb = {
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      requirementRepository.createQueryBuilder.mockReturnValue(qb);

      await svc.findAll({ keyword: '测试' } as any, user());
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('LIKE'),
        expect.objectContaining({ kw: '%测试%' }),
      );
    });
  });

  // ── analyze ──
  describe('analyze', () => {
    it('分析需求并更新状态', async () => {
      const { svc, requirementRepository, aiService, knowledgeSyncService } = makeMocks();
      requirementRepository.findOne.mockResolvedValue({
        id: 'r1',
        title: '测试需求',
        description: '需求描述',
        visibility: 'public',
        ownerId: 'u1',
        status: 'pending',
      });
      requirementRepository.save.mockImplementation(async (r: any) => r);

      const result = await svc.analyze('r1', user());
      expect(result.status).toBe('analyzed');
      expect(aiService.chat).toHaveBeenCalled();
      expect(knowledgeSyncService.syncObject).toHaveBeenCalled();
    });
  });

  // ── analyzeStructured ──
  describe('analyzeStructured', () => {
    it('结构化分析需求', async () => {
      const { svc, requirementRepository, aiService } = makeMocks();
      requirementRepository.findOne.mockResolvedValue({
        id: 'r1',
        title: '测试需求',
        description: '描述',
        visibility: 'public',
        ownerId: 'u1',
        specStatus: 'pending',
      });
      requirementRepository.save.mockImplementation(async (r: any) => r);

      const result = await svc.analyzeStructured('r1', user());
      expect(result.specStatus).toBe('done');
      // 走需求结构化引擎（需求卡：字段 + 缺失项），手动识别不标「待确认」
      expect(aiService.structureRequirement).toHaveBeenCalled();
      const spec = JSON.parse(result.structuredSpec);
      expect(spec.card.fields).toHaveLength(1);
      expect(spec.card.missing[0].label).toBe('交货地点');
      expect(spec.review).toBe(false);
    });

    it('需求已选产品类型：只把该类型的需求模板传给识别引擎', async () => {
      const { svc, requirementRepository, aiService } = makeMocks();
      requirementRepository.findOne.mockResolvedValue({
        id: 'r1', title: '联轴器', description: '鼓形齿联轴器', visibility: 'public', ownerId: 'u1',
        templateCategory: '零部件/联轴器/常规联轴器',
      });
      requirementRepository.save.mockImplementation(async (r: any) => r);
      await svc.analyzeStructured('r1', user());
      const opts = (aiService.structureRequirement as jest.Mock).mock.calls[0][3];
      expect(opts.template.category).toBe('零部件/联轴器/常规联轴器');
      expect(opts.template.fields[0].key).toBe('rated_torque');
      expect(opts.candidates).toEqual([]);
    });

    it('没选产品类型：传全部有字段的模板；引擎判定出类型后自动填上并记一笔需求记录', async () => {
      const { svc, requirementRepository, aiService, requirementLogRepository } = makeMocks();
      requirementRepository.findOne.mockResolvedValue({
        id: 'r1', title: '联轴器', description: '鼓形齿联轴器 2 套', visibility: 'public', ownerId: 'u1',
      });
      requirementRepository.save.mockImplementation(async (r: any) => r);
      (aiService.structureRequirement as jest.Mock).mockResolvedValueOnce({
        card: {
          product_category: '零部件/联轴器/常规联轴器', category_confidence: 0.69,
          template_category: '零部件/联轴器/常规联轴器', template_source: 'inferred', category_reason: '资料中出现：常规联轴器',
          fields: [{ key: 'rated_torque', label: '额定扭矩', value: 40 }], missing: [],
        },
        summary: '',
      });
      const result = await svc.analyzeStructured('r1', user());
      const opts = (aiService.structureRequirement as jest.Mock).mock.calls[0][3];
      expect(opts.template).toBeNull();
      // 空模板不传：没有字段的模板对识别没有意义
      expect(opts.candidates.map((c: any) => c.category)).toEqual(['零部件/联轴器/常规联轴器']);
      expect(result.templateCategory).toBe('零部件/联轴器/常规联轴器');
      const log = requirementLogRepository.save.mock.calls[0][0];
      expect(log.type).toBe('change');
      expect(log.content).toContain('系统按资料判定产品类型');
      const spec = JSON.parse(result.structuredSpec);
      expect(spec.autoCategory).toBe('零部件/联轴器/常规联轴器');
      expect(spec.templateSource).toBe('inferred');
    });

    it('判定置信度不足时不自动填产品类型', async () => {
      const { svc, requirementRepository, aiService, requirementLogRepository } = makeMocks();
      requirementRepository.findOne.mockResolvedValue({ id: 'r1', title: 't', description: '描述', visibility: 'public', ownerId: 'u1' });
      requirementRepository.save.mockImplementation(async (r: any) => r);
      (aiService.structureRequirement as jest.Mock).mockResolvedValueOnce({
        card: { template_category: '零部件/联轴器/常规联轴器', template_source: 'inferred', category_confidence: 0.4, fields: [{ key: 'a', label: 'A', value: 1 }], missing: [] },
      });
      const result = await svc.analyzeStructured('r1', user());
      expect(result.templateCategory).toBeUndefined();
      expect(requirementLogRepository.save).not.toHaveBeenCalled();
    });

    it('AI 不可用时不记成「已完成」，恢复原状态并报错', async () => {
      const { svc, requirementRepository, aiService } = makeMocks();
      requirementRepository.findOne.mockResolvedValue({ id: 'r1', title: 't', description: '描述', visibility: 'public', ownerId: 'u1', specStatus: 'pending' });
      requirementRepository.save.mockImplementation(async (r: any) => r);
      (aiService.structureRequirement as jest.Mock).mockResolvedValueOnce({ card: {}, error: '需求结构化服务暂时不可用' });
      await expect(svc.analyzeStructured('r1', user())).rejects.toThrow('需求结构化服务暂时不可用');
      const last = requirementRepository.save.mock.calls[requirementRepository.save.mock.calls.length - 1][0];
      expect(last.specStatus).toBe('pending');
    });

    it('没有资料也没有描述时直接提示上传资料', async () => {
      const { svc, requirementRepository } = makeMocks();
      requirementRepository.findOne.mockResolvedValue({ id: 'r1', title: 't', description: '', visibility: 'public', ownerId: 'u1' });
      await expect(svc.analyzeStructured('r1', user())).rejects.toThrow('上传客户的技术附件');
    });
  });
});

describe('RequirementsService auto-analysis rules', () => {
  const S = RequirementsService as any;
  it('analyses requirements that were never analysed', () => {
    expect(S.shouldAutoAnalyze({ specStatus: 'pending', structuredSpec: null })).toBe(true);
    expect(S.shouldAutoAnalyze({ specStatus: undefined, structuredSpec: null })).toBe(true);
  });
  it('refreshes an unconfirmed automatic result when new documents arrive', () => {
    expect(S.shouldAutoAnalyze({ specStatus: 'done', structuredSpec: JSON.stringify({ card: {}, review: true }) })).toBe(true);
  });
  it('startup backfill only takes requirements that were never analysed', () => {
    expect(S.neverAnalyzed({ specStatus: 'pending', structuredSpec: null })).toBe(true);
    expect(S.neverAnalyzed({ specStatus: 'done', structuredSpec: JSON.stringify({ card: {}, review: true }) })).toBe(false);
    expect(S.neverAnalyzed({ specStatus: 'pending', structuredSpec: null, isCurrent: false })).toBe(false);
  });
  it('never overwrites a result a person confirmed or edited, nor one being analysed', () => {
    expect(S.shouldAutoAnalyze({ specStatus: 'done', structuredSpec: JSON.stringify({ card: {}, review: false }) })).toBe(false);
    expect(S.shouldAutoAnalyze({ specStatus: 'done', structuredSpec: JSON.stringify({ params: [] }) })).toBe(false);
    expect(S.shouldAutoAnalyze({ specStatus: 'analyzing', structuredSpec: null })).toBe(false);
    expect(S.shouldAutoAnalyze({ specStatus: 'pending', isCurrent: false })).toBe(false);
  });
});
