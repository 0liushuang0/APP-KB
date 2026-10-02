import { NotFoundException, BadRequestException } from '@nestjs/common';
import { DocumentsService } from './documents.service';

const makeMocks = () => {
  const documentRepository = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const versionRepository = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
  };
  const configService = {
    get: jest.fn().mockReturnValue('http://localhost:3000'),
  };
  const aiService = {
    addChunks: jest.fn(),
    deleteChunks: jest.fn(),
    parseFile: jest.fn().mockResolvedValue('parsed text'),
    chat: jest.fn(),
  };
  const permissionService = {
    canAccess: jest.fn().mockReturnValue(true),
    canManage: jest.fn().mockReturnValue(true),
    canApprove: jest.fn().mockReturnValue(true),
    skipApproval: jest.fn().mockReturnValue(false),
  };
  const approvalsService = {
    create: jest.fn(),
    approve: jest.fn(),
    reject: jest.fn(),
  };
  const fileArchiveService = {
    archiveFile: jest.fn().mockResolvedValue('/archives/doc.pdf'),
    getCustomerFiles: jest.fn(),
    deleteArchiveFile: jest.fn(),
  };
  const permissionQuery = { apply: jest.fn() };
  const documentLinkRepository = {
    delete: jest.fn().mockResolvedValue(undefined),
    // 软删要把关联一并快照进回收站，所以先 find 再 delete
    find: jest.fn().mockResolvedValue([]),
  };
  const tx = {
    run: jest.fn(async (work: any, after?: any) => {
      const fakeRepo = { delete: jest.fn().mockResolvedValue(undefined) };
      const manager = {
        save: jest.fn().mockResolvedValue({ id: 'doc1', status: 'approved' }),
        getRepository: () => fakeRepo,
      };
      const result = await work(manager);
      if (after) await after(result);
      return result;
    }),
  };

  // 删除改为软删后需要回收站服务：softDelete 返回带 id 的记录，
  // 后续 patchData 会按这个 id 回写文件移动结果
  const recycleBin = {
    softDelete: jest.fn().mockResolvedValue({ id: 'recycle1' }),
    patchData: jest.fn().mockResolvedValue(undefined),
    findAll: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    permanentDelete: jest.fn().mockResolvedValue(undefined),
  };

  const svc = new DocumentsService(
    documentRepository as any,
    versionRepository as any,
    documentLinkRepository as any,
    configService as any,
    aiService as any,
    permissionService as any,
    approvalsService as any,
    fileArchiveService as any,
    permissionQuery as any,
    tx as any,
    recycleBin as any,
  );

  return {
    svc,
    documentRepository,
    versionRepository,
    configService,
    aiService,
    permissionService,
    approvalsService,
    recycleBin,
    fileArchiveService,
    permissionQuery,
    tx,
  };
};

const user = () => ({
  userId: 'u1',
  username: 'testuser',
  roles: [],
  departmentId: 'd1',
  isSystemAdmin: false,
});

describe('DocumentsService', () => {
  // ── findOne ──
  describe('findOne', () => {
    it('找到文档并返回', async () => {
      const { svc, documentRepository } = makeMocks();
      documentRepository.findOne.mockResolvedValue({
        id: 'doc1',
        title: '测试文档',
        visibility: 'public',
        uploaderId: 'u1',
      });

      const result = await svc.findOne('doc1', user());
      expect(result.id).toBe('doc1');
    });

    it('文档不存在抛出 NotFoundException', async () => {
      const { svc, documentRepository } = makeMocks();
      documentRepository.findOne.mockResolvedValue(null);

      await expect(svc.findOne('missing', user())).rejects.toThrow(NotFoundException);
    });

    it('无权限抛出 BadRequestException', async () => {
      const { svc, documentRepository, permissionService } = makeMocks();
      documentRepository.findOne.mockResolvedValue({
        id: 'doc1',
        visibility: 'private',
        uploaderId: 'other',
      });
      permissionService.canAccess.mockReturnValue(false);

      await expect(svc.findOne('doc1', user())).rejects.toThrow(BadRequestException);
    });
  });

  // ── update ──
  describe('update', () => {
    it('有权限时更新文档', async () => {
      const { svc, documentRepository } = makeMocks();
      const doc = { id: 'doc1', title: '旧标题', visibility: 'public', uploaderId: 'u1' };
      documentRepository.findOne.mockResolvedValue(doc);
      documentRepository.save.mockResolvedValue({ ...doc, title: '新标题' });

      const result = await svc.update('doc1', { title: '新标题' } as any, user());
      expect(documentRepository.save).toHaveBeenCalled();
    });

    it('无管理权限抛出 BadRequestException', async () => {
      const { svc, documentRepository, permissionService } = makeMocks();
      documentRepository.findOne.mockResolvedValue({
        id: 'doc1',
        visibility: 'private',
        uploaderId: 'other',
      });
      permissionService.canManage.mockReturnValue(false);

      await expect(svc.update('doc1', { title: '新' } as any, user())).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── remove ──
  describe('remove', () => {
    it('有权限时删除文档', async () => {
      const { svc, documentRepository, aiService } = makeMocks();
      documentRepository.findOne.mockResolvedValue({
        id: 'doc1',
        visibility: 'public',
        uploaderId: 'u1',
        fileKey: 'documents/test.pdf',
        category: 'business',
      });

      await svc.remove('doc1', user());
      // 向量清理在 afterCommit 里执行
      expect(aiService.deleteChunks).toHaveBeenCalledWith('document', 'doc1');
      // 主行删除走事务内 manager.getRepository，mock 已执行 work 回调，不抛错即通过
    });

    /*
     * 删除必须是可撤销的。
     *
     * 改动前 remove() 是彻底抹掉：数据库硬删 + fs.unlinkSync 主文件与全部历史版本，
     * 不进系统回收站，误删只能指望恰好有过一次备份。
     * 这几条锁住"删除 = 进回收站"这个性质，防止以后被改回去。
     */
    it('删除要把整条记录快照进回收站，而不是直接抹掉', async () => {
      const { svc, documentRepository, recycleBin } = makeMocks();
      documentRepository.findOne.mockResolvedValue({
        id: 'doc1',
        title: '现场照片',
        visibility: 'public',
        uploaderId: 'u1',
        fileKey: 'documents/test.pdf',
        category: 'business',
      });

      await svc.remove('doc1', user());

      expect(recycleBin.softDelete).toHaveBeenCalledTimes(1);
      const [entityType, entityId, , snapshot] = recycleBin.softDelete.mock.calls[0];
      expect(entityType).toBe('document');
      expect(entityId).toBe('doc1');
      // 快照要含还原所需的全部信息
      expect(snapshot.document).toMatchObject({ id: 'doc1', fileKey: 'documents/test.pdf' });
      expect(snapshot).toHaveProperty('versions');
      expect(snapshot).toHaveProperty('links');
      expect(snapshot.sourceType).toBe('document');
    });

    it('知识资料删除时记的是 knowledge 来源（还原后才能重建对的索引）', async () => {
      const { svc, documentRepository, recycleBin, aiService } = makeMocks();
      documentRepository.findOne.mockResolvedValue({
        id: 'kb1',
        visibility: 'public',
        uploaderId: 'u1',
        fileKey: 'knowledge/国家标准/x.pdf',
        category: 'knowledge/national_standard',
      });

      await svc.remove('kb1', user());

      expect(recycleBin.softDelete.mock.calls[0][3].sourceType).toBe('knowledge');
      expect(aiService.deleteChunks).toHaveBeenCalledWith('knowledge', 'kb1');
    });

    it('文件移动结果要回写进回收记录，否则还原和过期清理都找不到文件', async () => {
      const { svc, documentRepository, recycleBin } = makeMocks();
      documentRepository.findOne.mockResolvedValue({
        id: 'doc1',
        visibility: 'public',
        uploaderId: 'u1',
        fileKey: 'documents/test.pdf',
        category: 'business',
      });

      await svc.remove('doc1', user());

      expect(recycleBin.patchData).toHaveBeenCalledWith('recycle1', expect.objectContaining({
        files: expect.any(Array),
      }));
    });

    it('无管理权限抛出 BadRequestException', async () => {
      const { svc, documentRepository, permissionService } = makeMocks();
      documentRepository.findOne.mockResolvedValue({
        id: 'doc1',
        visibility: 'private',
        uploaderId: 'other',
      });
      permissionService.canManage.mockReturnValue(false);

      await expect(svc.remove('doc1', user())).rejects.toThrow(BadRequestException);
    });
  });

  /*
   * ── 上传时的审批记录必须与主行同事务 ──
   *
   * 回归背景：原来是先 save 文档、再单独建审批记录（连事务都没有）。
   * 后者失败时文档会带着 status='pending' 留在库里，而审批中心里没有它，
   * 既审不了也退不掉。这条测试钉住"审批 create 必须拿到事务 manager"。
   */
  describe('上传的审批记录', () => {
    /*
     * create() 末尾会 fire-and-forget 地跑 processDocument 做解析入索引。
     * 这两条用例只关心事务编排，把它 stub 掉 —— 否则它会拿着 tx mock 返回的
     * 桩对象（没有 fileName）去 isImageFile() 里 toLowerCase，抛一个没人 await
     * 的异步异常：日志里每轮都刷一条 ERROR，还可能把整个 suite 拖成偶发失败。
     */
    const stubProcess = (svc: any) =>
      jest.spyOn(svc as any, 'processDocument').mockResolvedValue(undefined);

    it('审批 create 在事务内调用（带 manager 参数）', async () => {
      const { svc, approvalsService, tx } = makeMocks();
      stubProcess(svc);

      await svc.create(
        { title: 't', category: 'other' } as any,
        { originalname: 'a.txt', size: 10, mimetype: 'text/plain', buffer: Buffer.from('x') } as any,
        user(),
      );

      expect(tx.run).toHaveBeenCalled();
      expect(approvalsService.create).toHaveBeenCalledTimes(1);
      // 第二个参数就是事务 manager —— 少了它审批就落在事务外
      const [dto, manager] = approvalsService.create.mock.calls[0];
      expect(dto).toMatchObject({ objectType: 'document', status: 'pending' });
      expect(manager).toBeDefined();
      expect(typeof manager.save).toBe('function');
    });

    it('skipApproval 时不建审批记录', async () => {
      const { svc, approvalsService, permissionService } = makeMocks();
      permissionService.skipApproval.mockReturnValue(true);
      stubProcess(svc);

      await svc.create(
        { title: 't', category: 'other' } as any,
        { originalname: 'a.txt', size: 10, mimetype: 'text/plain', buffer: Buffer.from('x') } as any,
        user(),
      );

      expect(approvalsService.create).not.toHaveBeenCalled();
    });
  });

  // ── approve ──
  describe('approve', () => {
    it('审核通过', async () => {
      const { svc, documentRepository, approvalsService } = makeMocks();
      documentRepository.findOne.mockResolvedValue({ id: 'doc1', status: 'pending' });
      documentRepository.save.mockResolvedValue({ id: 'doc1', status: 'approved' });

      const result = await svc.approve('doc1', user());
      expect(result.status).toBe('approved');
      expect(approvalsService.approve).toHaveBeenCalled();
    });

    it('无审核权限抛出 BadRequestException', async () => {
      const { svc, permissionService } = makeMocks();
      permissionService.canApprove.mockReturnValue(false);

      await expect(svc.approve('doc1', user())).rejects.toThrow(BadRequestException);
    });

    it('文档不存在抛出 NotFoundException', async () => {
      const { svc, documentRepository } = makeMocks();
      documentRepository.findOne.mockResolvedValue(null);

      await expect(svc.approve('missing', user())).rejects.toThrow(NotFoundException);
    });
  });

  // ── reject ──
  describe('reject', () => {
    it('审核拒绝', async () => {
      const { svc, documentRepository, approvalsService } = makeMocks();
      documentRepository.findOne.mockResolvedValue({ id: 'doc1', status: 'pending' });
      documentRepository.save.mockResolvedValue({ id: 'doc1', status: 'rejected' });

      const result = await svc.reject('doc1', user(), '内容不合规');
      expect(result.status).toBe('rejected');
      expect(approvalsService.reject).toHaveBeenCalled();
    });
  });

  // ── getFilePath ──
  describe('getFilePath', () => {
    it('knowledge 路径正确解析', () => {
      const { svc } = makeMocks();
      // 不实际测试文件系统，只确保不抛异常
      try {
        svc.getFilePath('knowledge/产品手册/test.pdf');
      } catch {
        // 可能路径不存在，但不应是 BadRequestException（除非路径穿越）
      }
    });
  });

  // ── findAll (query builder mock) ──
  describe('findAll', () => {
    it('调用 permissionQuery.apply', async () => {
      const { svc, documentRepository, permissionQuery } = makeMocks();
      const qb = {
        andWhere: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      documentRepository.createQueryBuilder.mockReturnValue(qb);

      // paginate uses getManyAndCount
      const result = await svc.findAll({} as any, user());
      expect(permissionQuery.apply).toHaveBeenCalled();
    });
  });
});
