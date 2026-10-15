import { NotFoundException, BadRequestException } from '@nestjs/common';
import { CustomersService } from './customers.service';

const makeMocks = () => {
  const customerRepository = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const contactRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    delete: jest.fn(),
  };
  const followUpRepository = { create: jest.fn(), save: jest.fn() };
  const projectRepository = { find: jest.fn().mockResolvedValue([]) };
  const documentLinkRepository = { find: jest.fn().mockResolvedValue([]) };
  const documentRepository = { findByIds: jest.fn().mockResolvedValue([]) };
  const requirementRepository = { find: jest.fn().mockResolvedValue([]) };
  const proposalRepository = { find: jest.fn().mockResolvedValue([]) };
  const quotationRepository = { find: jest.fn().mockResolvedValue([]) };
  const permissionService = {
    canAccess: jest.fn().mockReturnValue(true),
    canManage: jest.fn().mockReturnValue(true),
    canApprove: jest.fn().mockReturnValue(true),
    skipApproval: jest.fn().mockReturnValue(false),
  };
  const knowledgeSyncService = {
    syncObject: jest.fn(),
    deleteObject: jest.fn(),
  };
  const transactionService = {
    run: jest.fn(async (work: any, after?: any) => {
      const savedCustomer = { id: 'c1', name: '测试客户', visibility: 'public', ownerId: 'u1' };
      const fakeRepo = {
        delete: jest.fn().mockResolvedValue(undefined),
        find: jest.fn().mockResolvedValue([]),
      };
      const manager = {
        create: jest.fn().mockReturnValue(savedCustomer),
        save: jest.fn().mockResolvedValue(savedCustomer),
        getRepository: jest.fn().mockReturnValue(fakeRepo),
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
  const approvalsService = {
    create: jest.fn(),
    approve: jest.fn(),
  };
  const permissionQuery = { apply: jest.fn() };

  const svc = new CustomersService(
    customerRepository as any,
    contactRepository as any,
    followUpRepository as any,
    projectRepository as any,
    documentLinkRepository as any,
    documentRepository as any,
    requirementRepository as any,
    proposalRepository as any,
    quotationRepository as any,
    { find: jest.fn().mockResolvedValue([]) } as any,
    { find: jest.fn().mockResolvedValue([]) } as any,
    { find: jest.fn().mockResolvedValue([]) } as any,
    permissionService as any,
    knowledgeSyncService as any,
    transactionService as any,
    approvalsService as any,
    permissionQuery as any,
    { next: jest.fn().mockResolvedValue('CUST-2026-001') } as any,
    {
      findSimilarCustomers: jest.fn().mockResolvedValue({ similar_customers: [], total: 0 }),
      analyzeCrossSell: jest.fn().mockResolvedValue({ recommendations: [], total_opportunities: 0 }),
    } as any,
    { capture: jest.fn() } as any,
  );

  return {
    svc,
    customerRepository,
    contactRepository,
    followUpRepository,
    permissionService,
    knowledgeSyncService,
    transactionService,
    approvalsService,
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

describe('CustomersService', () => {
  /*
   * ── 联系人增删改 ──
   *
   * 回归背景：前端"编辑客户"保存时曾把所有联系人重新 addContact 一遍，
   * 而 contact_persons 表没有唯一约束，于是每存一次就翻一倍。
   * 修法是补 updateContact / removeContact，让前端能按 id 改和删。
   */
  describe('联系人', () => {
    const contact = { id: 'ct1', customerId: 'c1', name: '张三', phone: '138' };
    const customer = { id: 'c1', name: '测试客户', visibility: 'public', ownerId: 'u1' };

    it('updateContact 按 id 改，不新建记录', async () => {
      const { svc, contactRepository, customerRepository } = makeMocks();
      contactRepository.findOne.mockResolvedValue({ ...contact });
      customerRepository.findOne.mockResolvedValue(customer);
      contactRepository.save.mockImplementation(async (c: any) => c);

      const saved: any = await svc.updateContact('ct1', { phone: '139' } as any, user());

      expect(contactRepository.create).not.toHaveBeenCalled();
      expect(saved.id).toBe('ct1');
      expect(saved.phone).toBe('139');
      expect(saved.name).toBe('张三'); // 未传的字段保持原样
    });

    it('updateContact 对不存在的联系人报 404', async () => {
      const { svc, contactRepository } = makeMocks();
      contactRepository.findOne.mockResolvedValue(null);

      await expect(svc.updateContact('nope', {} as any, user())).rejects.toThrow(NotFoundException);
    });

    it('updateContact 无权访问所属客户时拒绝', async () => {
      const { svc, contactRepository, customerRepository, permissionService } = makeMocks();
      contactRepository.findOne.mockResolvedValue({ ...contact });
      customerRepository.findOne.mockResolvedValue(customer);
      permissionService.canAccess.mockReturnValue(false);

      await expect(svc.updateContact('ct1', { phone: '139' } as any, user())).rejects.toThrow(
        BadRequestException,
      );
      expect(contactRepository.save).not.toHaveBeenCalled();
    });

    it('removeContact 删除已有联系人', async () => {
      const { svc, contactRepository, customerRepository } = makeMocks();
      contactRepository.findOne.mockResolvedValue({ ...contact });
      customerRepository.findOne.mockResolvedValue(customer);

      await svc.removeContact('ct1', user());

      expect(contactRepository.delete).toHaveBeenCalledWith('ct1');
    });

    it('removeContact 无权访问所属客户时不删', async () => {
      const { svc, contactRepository, customerRepository, permissionService } = makeMocks();
      contactRepository.findOne.mockResolvedValue({ ...contact });
      customerRepository.findOne.mockResolvedValue(customer);
      permissionService.canAccess.mockReturnValue(false);

      await expect(svc.removeContact('ct1', user())).rejects.toThrow(BadRequestException);
      expect(contactRepository.delete).not.toHaveBeenCalled();
    });

    it('addContact 客户不存在时报 404', async () => {
      const { svc, customerRepository } = makeMocks();
      customerRepository.findOne.mockResolvedValue(null);

      await expect(
        svc.addContact({ customerId: 'nope', name: '李四' } as any, user()),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── create ──
  describe('create', () => {
    it('创建客户并同步知识库', async () => {
      const { svc, knowledgeSyncService } = makeMocks();

      const result = await svc.create({ name: '测试客户' } as any, user());
      expect(result.id).toBe('c1');
    });

    it('非跳过审批时创建审批记录', async () => {
      const { svc, approvalsService } = makeMocks();

      await svc.create({ name: '测试' } as any, user());
      // approvalsService.create is called inside the transaction body
    });

    it('跳过审批时审批状态为 approved', async () => {
      const { svc, permissionService } = makeMocks();
      permissionService.skipApproval.mockReturnValue(true);

      const result = await svc.create({ name: '测试' } as any, user());
      expect(result.id).toBe('c1');
    });
  });

  // ── findOne ──
  describe('findOne', () => {
    it('找到客户并返回', async () => {
      const { svc, customerRepository } = makeMocks();
      customerRepository.findOne.mockResolvedValue({
        id: 'c1',
        name: '测试客户',
        visibility: 'public',
        ownerId: 'u1',
      });

      const result = await svc.findOne('c1', user());
      expect(result.id).toBe('c1');
    });

    it('客户不存在抛出 NotFoundException', async () => {
      const { svc, customerRepository } = makeMocks();
      customerRepository.findOne.mockResolvedValue(null);

      await expect(svc.findOne('missing', user())).rejects.toThrow(NotFoundException);
    });

    it('无权限访问抛出 BadRequestException', async () => {
      const { svc, customerRepository, permissionService } = makeMocks();
      customerRepository.findOne.mockResolvedValue({
        id: 'c1',
        visibility: 'private',
        ownerId: 'other',
      });
      permissionService.canAccess.mockReturnValue(false);

      await expect(svc.findOne('c1', user())).rejects.toThrow(BadRequestException);
    });
  });

  // ── update ──
  describe('日期列的空串', () => {
    it('更新时 firstCooperationDate 为空串按未填(null)保存, 不让 PostgreSQL 报 date 语法错误', async () => {
      const { svc, customerRepository } = makeMocks();
      const existing: any = { id: 'c1', name: '旧名', visibility: 'public', ownerId: 'u1', firstCooperationDate: '2020-01-01' };
      customerRepository.findOne.mockResolvedValue(existing);
      customerRepository.save.mockImplementation(async (c: any) => c);

      await svc.update('c1', { firstCooperationDate: '' } as any, user());
      expect(existing.firstCooperationDate).toBeNull();
    });
  });

  describe('update', () => {
    it('有权限时更新客户', async () => {
      const { svc, customerRepository } = makeMocks();
      const existing = { id: 'c1', name: '旧名', visibility: 'public', ownerId: 'u1' };
      customerRepository.findOne.mockResolvedValue(existing);
      customerRepository.save.mockResolvedValue({ ...existing, name: '新名' });

      const result = await svc.update('c1', { name: '新名' } as any, user());
      expect(customerRepository.save).toHaveBeenCalled();
    });

    it('无管理权限抛出 BadRequestException', async () => {
      const { svc, customerRepository, permissionService } = makeMocks();
      customerRepository.findOne.mockResolvedValue({
        id: 'c1',
        visibility: 'private',
        ownerId: 'other',
      });
      permissionService.canManage.mockReturnValue(false);

      await expect(svc.update('c1', { name: '新' } as any, user())).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── remove ──
  describe('remove', () => {
    it('有权限时删除客户', async () => {
      const { svc, customerRepository, knowledgeSyncService } = makeMocks();
      customerRepository.findOne.mockResolvedValue({
        id: 'c1',
        visibility: 'public',
        ownerId: 'u1',
      });

      await svc.remove('c1', user());
      // 向量清理在 afterCommit 里执行
      expect(knowledgeSyncService.deleteObject).toHaveBeenCalledWith('customer', 'c1');
      // 主行删除走事务内 manager.getRepository，mock 已执行 work 回调，不抛错即通过
    });

    it('无管理权限抛出 BadRequestException', async () => {
      const { svc, customerRepository, permissionService } = makeMocks();
      customerRepository.findOne.mockResolvedValue({
        id: 'c1',
        visibility: 'private',
        ownerId: 'other',
      });
      permissionService.canManage.mockReturnValue(false);

      await expect(svc.remove('c1', user())).rejects.toThrow(BadRequestException);
    });
  });

  // ── addContact ──
  describe('addContact', () => {
    it('添加联系人', async () => {
      const { svc, customerRepository, contactRepository } = makeMocks();
      customerRepository.findOne.mockResolvedValue({ id: 'c1', visibility: 'public' });
      contactRepository.create.mockReturnValue({ id: 'ct1', name: '张三' });
      contactRepository.save.mockResolvedValue({ id: 'ct1', name: '张三' });

      const result = await svc.addContact({ customerId: 'c1', name: '张三' } as any, user());
      expect(result.name).toBe('张三');
    });

    it('客户不存在时抛出 NotFoundException', async () => {
      const { svc, customerRepository } = makeMocks();
      customerRepository.findOne.mockResolvedValue(null);

      await expect(
        svc.addContact({ customerId: 'missing', name: '张三' } as any, user()),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── addFollowUp ──
  describe('addFollowUp', () => {
    it('添加跟进记录', async () => {
      const { svc, customerRepository, followUpRepository } = makeMocks();
      customerRepository.findOne.mockResolvedValue({ id: 'c1', visibility: 'public' });
      followUpRepository.create.mockReturnValue({ id: 'f1', content: '电话沟通' });
      followUpRepository.save.mockResolvedValue({ id: 'f1', content: '电话沟通' });

      const result = await svc.addFollowUp(
        { customerId: 'c1', content: '电话沟通' } as any,
        user(),
      );
      expect(result.content).toBe('电话沟通');
    });

    it('无权限时抛出 BadRequestException', async () => {
      const { svc, customerRepository, permissionService } = makeMocks();
      customerRepository.findOne.mockResolvedValue({ id: 'c1', visibility: 'private', ownerId: 'other' });
      permissionService.canAccess.mockReturnValue(false);

      await expect(
        svc.addFollowUp({ customerId: 'c1', content: 'x' } as any, user()),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
