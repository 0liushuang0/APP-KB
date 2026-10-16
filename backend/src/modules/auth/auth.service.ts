import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { UsersService } from '../users/users.service';
import { RolesService } from '../roles/roles.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { generateTotpSecret, verifyTotp, otpauthUrl } from './totp.util';
import { randomBytes } from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private rolesService: RolesService,
    private jwtService: JwtService,
    private configService: ConfigService,
    @InjectRepository(RefreshToken)
    private refreshTokenRepository: Repository<RefreshToken>,
  ) {}

  async validateUser(username: string, password: string): Promise<any> {
    const user = await this.usersService.findByUsername(username);
    if (user && (await this.usersService.validatePassword(user, password))) {
      const { password: _, ...result } = user as any;
      return result;
    }
    return null;
  }

  async login(dto: LoginDto) {
    const user = await this.validateUser(dto.username, dto.password);
    if (!user) {
      throw new UnauthorizedException('用户名或密码错误');
    }
    /*
     * 双因素（TOTP）：启用后密码正确也必须提供 6 位动态码。
     * 缺码返回 TOTP_REQUIRED 语义标记，前端据此展开验证码输入框。
     */
    if (user.totpEnabled) {
      if (!dto.totpCode) {
        throw new UnauthorizedException('TOTP_REQUIRED');
      }
      if (!user.totpSecret || !verifyTotp(user.totpSecret, dto.totpCode)) {
        throw new UnauthorizedException('动态验证码错误或已过期');
      }
    }
    // 顺手清理过期/已撤销的刷新令牌，避免 refresh_tokens 表无限增长。
    void this.cleanupExpiredTokens();
    return this.generateTokens(user);
  }

  // ── TOTP 双因素管理 ──

  /**
   * 第一步：生成密钥（未启用）。返回 Base32 密钥与 otpauth 链接，
   * 用户在认证器 App 添加后，用 enable 验证首个动态码完成绑定。
   */
  async setupTotp(userId: string, account: string): Promise<{ secret: string; otpauthUrl: string }> {
    const secret = generateTotpSecret();
    await this.usersService.update(userId, { totpSecret: secret, totpEnabled: false } as any);
    const issuer = process.env.TOTP_ISSUER || '智能运营中心';
    return { secret, otpauthUrl: otpauthUrl(secret, account, issuer) };
  }

  /** 第二步：验证首个动态码，正式启用 */
  async enableTotp(userId: string, code: string): Promise<void> {
    const user = await this.usersService.findOne(userId);
    if (!user?.totpSecret) {
      throw new BadRequestException('请先生成绑定密钥');
    }
    if (!verifyTotp(user.totpSecret, code)) {
      throw new BadRequestException('动态验证码错误，请确认认证器时间与密钥');
    }
    await this.usersService.update(userId, { totpEnabled: true } as any);
  }

  /** 关闭双因素：密码 + 有效动态码双确认，防会话被盗后直接摘除防护 */
  async disableTotp(userId: string, password: string, code: string): Promise<void> {
    const current = await this.usersService.findOne(userId);
    const user = current ? await this.usersService.findByUsername(current.username) : null;
    if (!user || !(await this.usersService.validatePassword(user, password))) {
      throw new UnauthorizedException('密码错误');
    }
    if (!user.totpEnabled || !user.totpSecret || !verifyTotp(user.totpSecret, code)) {
      throw new BadRequestException('动态验证码错误');
    }
    await this.usersService.update(userId, { totpEnabled: false, totpSecret: null } as any);
  }

  /**
   * 清理过期与已撤销的刷新令牌。设计为「尽力而为」的异步副作用：
   * 用 void 调用、不 await、不阻塞登录主流程，失败也只记日志。
   */
  async cleanupExpiredTokens(): Promise<number> {
    try {
      const result = await this.refreshTokenRepository
        .createQueryBuilder()
        .delete()
        .where('expiresAt < :now OR isRevoked = :revoked', {
          now: new Date(),
          revoked: true,
        })
        .execute();
      return result.affected || 0;
    } catch {
      return 0;
    }
  }

  async register(dto: RegisterDto) {
    /*
     * 自助注册默认关闭。
     * 原先这是个 @Public 端点且无开关 —— 任何知道地址的人都能注册进来浏览知识库，
     * 对内部系统等于把门敞开。单机个人版更是完全没有注册的意义。
     */
    if (!this.configService.get<boolean>('app.allowSelfRegister')) {
      throw new ForbiddenException('系统未开放自助注册，请联系管理员创建账号');
    }

    const existing = await this.usersService.findByUsername(dto.username);
    if (existing) {
      throw new ConflictException('用户名已存在');
    }

    const viewerRole = await this.rolesService.findByCode('viewer');
    const user = await this.usersService.create({
      ...dto,
      roleIds: viewerRole ? [viewerRole.id] : [],
    });

    const { password: _, ...result } = user as any;
    return this.generateTokens(result);
  }

  async refresh(refreshToken: string) {
    const tokenEntity = await this.refreshTokenRepository.findOne({
      where: { token: refreshToken },
      relations: ['user'],
    });

    // 令牌重用检测：一个已被撤销的令牌再次出现，说明它可能已被泄露
    // （攻击者复制了旧令牌），安全做法是撤销该用户的全部刷新令牌，强制重新登录。
    if (tokenEntity?.isRevoked) {
      await this.refreshTokenRepository.update(
        { userId: tokenEntity.userId },
        { isRevoked: true },
      );
      throw new UnauthorizedException('刷新令牌已失效，请重新登录');
    }

    if (!tokenEntity || tokenEntity.expiresAt < new Date()) {
      throw new UnauthorizedException('刷新令牌无效或已过期');
    }

    // 轮换：旧令牌立即作废、签发新令牌，两步放进同一事务，避免"作废已提交、
    // 签发失败 → 用户被强制登出"。并发保护用 compare-and-set：只在尚未撤销时撤销，
    // affected=0 说明该令牌已被另一个并发请求轮换过 —— 同一个 refresh token 只能
    // 换一次，重复使用直接拒绝（攻击者复制的旧令牌也走这条路被挡掉）。
    return this.refreshTokenRepository.manager.transaction(async (manager) => {
      const revoked = await manager.update(
        RefreshToken,
        { id: tokenEntity.id, isRevoked: false },
        { isRevoked: true },
      );
      if (!revoked.affected) {
        throw new UnauthorizedException('刷新令牌已被使用，请重新登录');
      }
      const user = await this.usersService.findOne(tokenEntity.userId);
      const { password: _, ...result } = user as any;
      return this.generateTokens(result, manager);
    });
  }

  async logout(refreshToken: string): Promise<{ success: boolean }> {
    // 只在令牌确实存在且未撤销时返回 success:true，让前端能据此判断是否真正登出
    const tokenEntity = await this.refreshTokenRepository.findOne({
      where: { token: refreshToken },
    });
    if (!tokenEntity || tokenEntity.isRevoked) {
      return { success: false };
    }
    await this.refreshTokenRepository.update(
      { id: tokenEntity.id },
      { isRevoked: true },
    );
    return { success: true };
  }

  /**
   * 智汇工作台统一登录: 身份已由签名校验; 按用户名映射同名账号, 没有则创建
   * (门户管理员 → admin, 其余 → viewer, 随机口令)。账号停用返回 null。
   */
  async ssoLogin(username: string, displayName: string, isAdmin: boolean) {
    let user: any = await this.usersService.findByUsername(username);
    if (!user) {
      const role = await this.rolesService.findByCode(isAdmin ? 'admin' : 'viewer');
      await this.usersService.create({
        username, password: `${randomBytes(18).toString('base64')}Aa1!`,
        nickname: displayName || username, roleIds: role ? [role.id] : [],
      } as any);
      user = await this.usersService.findByUsername(username);
    }
    if (!user || user.isActive === false) return null;
    return this.generateTokens(user);
  }

  private async generateTokens(user: any, manager?: EntityManager) {
    const payload = {
      sub: user.id,
      username: user.username,
      roles: user.roles?.map((r: any) => r.code) || [],
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get('app.jwt.secret'),
      expiresIn: this.configService.get('app.jwt.expiresIn'),
    });

    const refreshToken = uuidv4();
    const refreshExpiresIn = this.configService.get<string>(
      'app.jwt.refreshExpiresIn',
    );
    const expiresAt = this.parseExpiryToDate(refreshExpiresIn);

    // 传入 manager 时（refresh 轮换路径）在调用方事务内写，保证"作废旧令牌 + 签发新令牌"原子；
    // 不传时（login）用默认 repository。
    const repo = manager
      ? manager.getRepository(RefreshToken)
      : this.refreshTokenRepository;
    await repo.save({
      token: refreshToken,
      userId: user.id,
      expiresAt,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.configService.get('app.jwt.expiresIn'),
      user: {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        email: user.email,
        avatar: user.avatar,
        roles: user.roles,
        department: user.department,
        groups: user.groups,
      },
    };
  }

  /**
   * 把 '7d' / '2h' / '30m' / '3600'(秒) 这样的过期描述解析成绝对时间。
   * 之前硬编码 30 天，与 app.config.ts 的 refreshExpiresIn='7d' 死配置矛盾。
   */
  private parseExpiryToDate(expr: string | undefined): Date {
    const date = new Date();
    if (!expr) {
      date.setDate(date.getDate() + 7);
      return date;
    }
    const match = /^(\d+)([smhd])?$/.exec(expr.trim());
    if (!match) {
      date.setDate(date.getDate() + 7);
      return date;
    }
    const value = parseInt(match[1], 10);
    switch (match[2]) {
      case 's':
        date.setSeconds(date.getSeconds() + value);
        break;
      case 'm':
        date.setMinutes(date.getMinutes() + value);
        break;
      case 'h':
        date.setHours(date.getHours() + value);
        break;
      case 'd':
      default:
        date.setDate(date.getDate() + value);
        break;
    }
    return date;
  }

  async singleModeLogin() {
    const appMode = this.configService.get<'single' | 'team'>('app.appMode');
    if (appMode !== 'single') {
      throw new BadRequestException('当前不是单用户模式');
    }

    let user = await this.usersService.findByUsername(
      this.configService.get('app.defaultAdmin.username'),
    );

    const adminRole = await this.rolesService.findByCode('admin');

    if (!user) {
      user = await this.usersService.create({
        username: this.configService.get('app.defaultAdmin.username'),
        password: this.configService.get('app.defaultAdmin.password'),
        nickname: this.configService.get('app.defaultAdmin.nickname'),
        email: this.configService.get('app.defaultAdmin.email'),
        roleIds: adminRole ? [adminRole.id] : [],
      });
    } else if (adminRole && !user.roles?.some((r) => r.code === 'admin')) {
      await this.usersService.update(user.id, {
        roleIds: [adminRole.id, ...(user.roles || []).map((r) => r.id)],
      });
      user = await this.usersService.findByUsername(
        this.configService.get('app.defaultAdmin.username'),
      );
    }

    if (!user.isSystemAdmin) {
      await this.usersService.update(user.id, { isSystemAdmin: true });
      user.isSystemAdmin = true;
    }

    const { password: _, ...result } = user as any;
    return this.generateTokens(result);
  }
}
