import { UnauthorizedException, ForbiddenException, BadRequestException, ConflictException } from '@nestjs/common';
import { AuthService } from './auth.service';

const makeMocks = () => {
  const usersService = {
    findByUsername: jest.fn(),
    validatePassword: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findOne: jest.fn(),
  };
  const rolesService = { findByCode: jest.fn() };
  const jwtService = { sign: jest.fn().mockReturnValue('jwt-token') };
  const configService = { get: jest.fn() };
  const refreshTokenRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    // refresh() 现在走 refreshTokenRepository.manager.transaction(cb)；
    // mock 一个事务：把 cb 的 manager.update 委托给 update（默认 affected=1），
    // manager.getRepository().save 委托给 save，使既有断言仍成立。
    manager: {
      transaction: jest.fn(async (cb: (mgr: any) => Promise<any>) => {
        const manager = {
          update: jest.fn(async (...args: any[]) => {
            await (refreshTokenRepository.update as jest.Mock)(...args);
            return { affected: 1 };
          }),
          getRepository: () => ({ save: refreshTokenRepository.save }),
        };
        return cb(manager);
      }),
    },
  };

  const svc = new AuthService(
    usersService as any,
    rolesService as any,
    jwtService as any,
    configService as any,
    refreshTokenRepository as any,
  );

  return { svc, usersService, rolesService, jwtService, configService, refreshTokenRepository };
};

describe('AuthService', () => {
  // ── validateUser ──
  describe('validateUser', () => {
    it('用户名密码正确返回用户信息（不含密码）', async () => {
      const { svc, usersService } = makeMocks();
      const dbUser = { id: 'u1', username: 'test', password: 'hashed', roles: [] };
      usersService.findByUsername.mockResolvedValue(dbUser);
      usersService.validatePassword.mockResolvedValue(true);

      const result = await svc.validateUser('test', '123456');
      expect(result).toEqual({ id: 'u1', username: 'test', roles: [] });
      expect(result.password).toBeUndefined();
    });

    it('用户不存在返回 null', async () => {
      const { svc, usersService } = makeMocks();
      usersService.findByUsername.mockResolvedValue(null);

      const result = await svc.validateUser('ghost', '123456');
      expect(result).toBeNull();
    });

    it('密码错误返回 null', async () => {
      const { svc, usersService } = makeMocks();
      usersService.findByUsername.mockResolvedValue({ id: 'u1', username: 'test', password: 'hashed' });
      usersService.validatePassword.mockResolvedValue(false);

      const result = await svc.validateUser('test', 'wrong');
      expect(result).toBeNull();
    });
  });

  // ── login ──
  describe('login', () => {
    it('有效凭证返回 token 对', async () => {
      const { svc, usersService, configService, refreshTokenRepository } = makeMocks();
      const dbUser = { id: 'u1', username: 'test', password: 'hashed', roles: [{ code: 'admin' }] };
      usersService.findByUsername.mockResolvedValue(dbUser);
      usersService.validatePassword.mockResolvedValue(true);
      configService.get.mockImplementation((key: string) => {
        if (key === 'app.jwt.secret') return 's3cret';
        if (key === 'app.jwt.expiresIn') return '1h';
        return undefined;
      });

      const result = await svc.login({ username: 'test', password: '123456' });
      expect(result.accessToken).toBe('jwt-token');
      expect(result.refreshToken).toBeDefined();
      expect(refreshTokenRepository.save).toHaveBeenCalled();
    });

    it('无效凭证抛出 UnauthorizedException', async () => {
      const { svc, usersService } = makeMocks();
      usersService.findByUsername.mockResolvedValue(null);

      await expect(svc.login({ username: 'bad', password: 'wrong' })).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ── register ──
  describe('register', () => {
    it('开放注册时创建用户并返回 token', async () => {
      const { svc, usersService, rolesService, configService, refreshTokenRepository } = makeMocks();
      configService.get.mockImplementation((key: string) => {
        if (key === 'app.allowSelfRegister') return true;
        if (key === 'app.jwt.secret') return 's3cret';
        if (key === 'app.jwt.expiresIn') return '1h';
        return undefined;
      });
      usersService.findByUsername.mockResolvedValue(null);
      rolesService.findByCode.mockResolvedValue({ id: 'role-viewer' });
      usersService.create.mockResolvedValue({ id: 'u2', username: 'newuser', roles: [] });

      const result = await svc.register({ username: 'newuser', password: 'pass123' });
      expect(result.accessToken).toBe('jwt-token');
      expect(usersService.create).toHaveBeenCalled();
    });

    it('未开放注册时抛出 ForbiddenException', async () => {
      const { svc, configService } = makeMocks();
      configService.get.mockImplementation((key: string) => {
        if (key === 'app.allowSelfRegister') return false;
        return undefined;
      });

      await expect(svc.register({ username: 'x', password: 'y' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('用户名已存在抛出 ConflictException', async () => {
      const { svc, usersService, configService } = makeMocks();
      configService.get.mockImplementation((key: string) => {
        if (key === 'app.allowSelfRegister') return true;
        return undefined;
      });
      usersService.findByUsername.mockResolvedValue({ id: 'u1', username: 'existing' });

      await expect(svc.register({ username: 'existing', password: 'pass' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ── refresh ──
  describe('refresh', () => {
    it('有效 refresh token 返回新 token 对，且旧令牌被轮换撤销', async () => {
      const { svc, usersService, refreshTokenRepository, configService } = makeMocks();
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1);
      refreshTokenRepository.findOne.mockResolvedValue({
        id: 'rt-id-old',
        token: 'rt-123',
        userId: 'u1',
        expiresAt: futureDate,
        isRevoked: false,
      });
      usersService.findOne.mockResolvedValue({ id: 'u1', username: 'test', roles: [] });
      configService.get.mockImplementation((key: string) => {
        if (key === 'app.jwt.secret') return 's3cret';
        if (key === 'app.jwt.expiresIn') return '1h';
        return undefined;
      });

      const result = await svc.refresh('rt-123');
      expect(result.accessToken).toBe('jwt-token');
      // 轮换：compare-and-set 作废旧令牌（仅在尚未撤销时）
      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        expect.anything(),
        { id: 'rt-id-old', isRevoked: false },
        { isRevoked: true },
      );
      // 签发了新令牌
      expect(refreshTokenRepository.save).toHaveBeenCalled();
    });

    it('已撤销的 token 再次使用触发重用检测：撤销该用户全部令牌', async () => {
      const { svc, refreshTokenRepository } = makeMocks();
      // 重用检测：findOne 不再按 isRevoked 过滤，能查到已撤销令牌
      refreshTokenRepository.findOne.mockResolvedValue({
        id: 'rt-reused',
        token: 'rt-revoked',
        userId: 'u1',
        isRevoked: true,
      });

      await expect(svc.refresh('rt-revoked')).rejects.toThrow(UnauthorizedException);
      // 应当撤销该用户的全部令牌
      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { userId: 'u1' },
        { isRevoked: true },
      );
    });

    it('不存在的 token 抛出 UnauthorizedException', async () => {
      const { svc, refreshTokenRepository } = makeMocks();
      refreshTokenRepository.findOne.mockResolvedValue(null);

      await expect(svc.refresh('rt-unknown')).rejects.toThrow(UnauthorizedException);
    });

    it('过期 token 抛出 UnauthorizedException', async () => {
      const { svc, refreshTokenRepository } = makeMocks();
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      refreshTokenRepository.findOne.mockResolvedValue({
        token: 'rt-old',
        userId: 'u1',
        expiresAt: pastDate,
        isRevoked: false,
      });

      await expect(svc.refresh('rt-old')).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── logout ──
  describe('logout', () => {
    it('撤销指定 refresh token（先查存在再按 id 作废）', async () => {
      const { svc, refreshTokenRepository } = makeMocks();
      refreshTokenRepository.findOne.mockResolvedValue({
        id: 'rt-id-1',
        token: 'rt-123',
        isRevoked: false,
      });
      const result = await svc.logout('rt-123');
      expect(result).toEqual({ success: true });
      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { id: 'rt-id-1' },
        { isRevoked: true },
      );
    });

    it('令牌不存在时返回 success:false 而非静默成功', async () => {
      const { svc, refreshTokenRepository } = makeMocks();
      refreshTokenRepository.findOne.mockResolvedValue(null);
      const result = await svc.logout('rt-missing');
      expect(result).toEqual({ success: false });
      expect(refreshTokenRepository.update).not.toHaveBeenCalled();
    });

    it('令牌已撤销时返回 success:false', async () => {
      const { svc, refreshTokenRepository } = makeMocks();
      refreshTokenRepository.findOne.mockResolvedValue({
        id: 'rt-id-2',
        token: 'rt-123',
        isRevoked: true,
      });
      const result = await svc.logout('rt-123');
      expect(result).toEqual({ success: false });
      expect(refreshTokenRepository.update).not.toHaveBeenCalled();
    });
  });

  // ── singleModeLogin ──
  describe('singleModeLogin', () => {
    it('非单机模式抛出 BadRequestException', async () => {
      const { svc, configService } = makeMocks();
      configService.get.mockImplementation((key: string) => {
        if (key === 'app.appMode') return 'team';
        return undefined;
      });

      await expect(svc.singleModeLogin()).rejects.toThrow(BadRequestException);
    });

    it('单机模式下已有用户直接登录', async () => {
      const { svc, usersService, rolesService, configService } = makeMocks();
      configService.get.mockImplementation((key: string) => {
        if (key === 'app.appMode') return 'single';
        if (key === 'app.defaultAdmin.username') return 'admin';
        if (key === 'app.jwt.secret') return 's3cret';
        if (key === 'app.jwt.expiresIn') return '1h';
        return undefined;
      });
      usersService.findByUsername.mockResolvedValue({
        id: 'admin-id',
        username: 'admin',
        isSystemAdmin: true,
        roles: [{ code: 'admin', id: 'r1' }],
      });
      rolesService.findByCode.mockResolvedValue({ id: 'r1' });

      const result = await svc.singleModeLogin();
      expect(result.accessToken).toBe('jwt-token');
    });

    it('单机模式下无用户时自动创建', async () => {
      const { svc, usersService, rolesService, configService } = makeMocks();
      configService.get.mockImplementation((key: string) => {
        if (key === 'app.appMode') return 'single';
        if (key === 'app.defaultAdmin.username') return 'admin';
        if (key === 'app.defaultAdmin.password') return 'admin123';
        if (key === 'app.defaultAdmin.nickname') return '管理员';
        if (key === 'app.defaultAdmin.email') return 'admin@local';
        if (key === 'app.jwt.secret') return 's3cret';
        if (key === 'app.jwt.expiresIn') return '1h';
        return undefined;
      });
      usersService.findByUsername.mockResolvedValue(null);
      rolesService.findByCode.mockResolvedValue({ id: 'r1' });
      usersService.create.mockResolvedValue({
        id: 'new-admin',
        username: 'admin',
        isSystemAdmin: false,
        roles: [],
      });

      const result = await svc.singleModeLogin();
      expect(usersService.create).toHaveBeenCalled();
      expect(result.accessToken).toBe('jwt-token');
    });

    it('单机模式下用户缺少 admin 角色时自动补上', async () => {
      const { svc, usersService, rolesService, configService } = makeMocks();
      configService.get.mockImplementation((key: string) => {
        if (key === 'app.appMode') return 'single';
        if (key === 'app.defaultAdmin.username') return 'admin';
        if (key === 'app.jwt.secret') return 's3cret';
        if (key === 'app.jwt.expiresIn') return '1h';
        return undefined;
      });
      usersService.findByUsername
        .mockResolvedValueOnce({
          id: 'admin-id',
          username: 'admin',
          isSystemAdmin: false,
          roles: [],
        })
        .mockResolvedValueOnce({
          id: 'admin-id',
          username: 'admin',
          isSystemAdmin: false,
          roles: [{ code: 'admin', id: 'r1' }],
        });
      rolesService.findByCode.mockResolvedValue({ id: 'r1' });

      const result = await svc.singleModeLogin();
      expect(usersService.update).toHaveBeenCalled();
      expect(result.accessToken).toBe('jwt-token');
    });
  });
});
