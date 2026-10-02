import {
  Controller,
  Post,
  Body,
  Get,
  Res,
  Req,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { Response, Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto, RefreshTokenDto, EnableTotpDto, DisableTotpDto } from './dto/auth.dto';
import { ForbiddenException as ZhForbidden, Req as ZhReq, UnauthorizedException as ZhUnauthorized } from '@nestjs/common';
import { randomBytes as zhRandomBytes } from 'crypto';
import { zhVerifyIdentity } from '../../common/zh-contract';

/**
 * 认证控制器。
 *
 * 所有认证端点都通过 httpOnly Cookie 返回令牌：
 * - accessToken: 短期令牌（2h），用于业务请求
 * - refreshToken: 长期令牌（30d），用于刷新
 *
 * httpOnly Cookie 的安全优势：
 * - JavaScript 无法读取（XSS 攻击无法窃取令牌）
 * - 浏览器自动携带（无需手动管理 Authorization 头）
 * - SameSite=lax 兼顾安全与顶层导航可用性，防范跨站提交型 CSRF
 */
@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto);
    this.setTokenCookies(res, result.accessToken, result.refreshToken);
    return result;
  }

  @Public()
  @Throttle({ short: { limit: 3, ttl: 60000 } })
  @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.register(dto);
    this.setTokenCookies(res, result.accessToken, result.refreshToken);
    return result;
  }

  // ── 双因素认证（TOTP）：绑定需登录；登录时的动态码走 LoginDto.totpCode ──

  /** 第一步：生成密钥（返回 Base32 与 otpauth 链接，认证器 App 手动添加） */
  @Post('totp/setup')
  setupTotp(@CurrentUser() user: any) {
    return this.authService.setupTotp(user.userId, user.username || 'user');
  }

  /** 第二步：验证首个动态码，正式启用 */
  @Post('totp/enable')
  enableTotp(@CurrentUser() user: any, @Body() dto: EnableTotpDto) {
    return this.authService.enableTotp(user.userId, dto.code);
  }

  /** 关闭双因素（密码 + 动态码双确认） */
  @Post('totp/disable')
  disableTotp(@CurrentUser() user: any, @Body() dto: DisableTotpDto) {
    return this.authService.disableTotp(user.userId, dto.password, dto.code);
  }

  @Public()
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // 优先从 Cookie 读取 refreshToken，回退到 body
    const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;
    // P0 安全修复：refreshToken 缺失时必须拒绝，否则 findOne({token:undefined})
    // 在 TypeORM 中会忽略条件返回表首行 → 任意会话劫持
    if (!refreshToken || typeof refreshToken !== 'string') {
      throw new UnauthorizedException('刷新令牌缺失');
    }
    const result = await this.authService.refresh(refreshToken);
    this.setTokenCookies(res, result.accessToken, result.refreshToken);
    return result;
  }

  @Public()
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  @Post('single-mode-login')
  async singleModeLogin(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // 双重保险：除 main.ts 把监听地址钉到 127.0.0.1 外，这里再校验请求来源
    // 必须是回环地址。一旦前置反向代理或绑定逻辑被改动，这一层仍能挡住外网
    // 直接调用免密登录端点拿管理员令牌。
    this.assertLoopback(req);
    const result = await this.authService.singleModeLogin();
    this.setTokenCookies(res, result.accessToken, result.refreshToken);
    return result;
  }

  @Public()
  @Get('mode')
  getMode() {
    return { mode: process.env.APP_MODE || 'single' };
  }

  @Public()
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.refreshToken;
    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }
    this.clearTokenCookies(res);
    return { success: true };
  }

  private setTokenCookies(res: Response, accessToken: string, refreshToken: string) {
    const isProduction = process.env.NODE_ENV === 'production';

    /*
     * Secure Cookie 只能经 HTTPS 传输。生产部署若仍是内网 HTTP（未配 TLS），
     * 浏览器会拒收 Secure Cookie，表现为"登录成功但立刻回到登录页"。
     * 默认生产开启；纯 HTTP 内网部署在 .env 显式设 COOKIE_SECURE=false 关闭，
     * 正式商用建议前置 HTTPS（nginx + 内网证书）后保持默认。
     */
    const secureCookie =
      process.env.COOKIE_SECURE != null
        ? process.env.COOKIE_SECURE === 'true'
        : isProduction;

    // cookie 过期与令牌真实过期保持一致：之前 access 写死 2h、refresh 写死 30d，
    // 但 JWT_EXPIRES_IN 实际可能是 7d（.env 覆盖），cookie 早就没了令牌却还可用，
    // 或反之。现在一律从配置推导，单一真值来源。
    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: 'lax',
      maxAge: this.expiryToMs(this.configService.get<string>('app.jwt.expiresIn'), 2 * 60 * 60 * 1000),
      path: '/',
    });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: 'lax',
      maxAge: this.expiryToMs(this.configService.get<string>('app.jwt.refreshExpiresIn'), 7 * 24 * 60 * 60 * 1000),
      path: '/',
    });
  }

  /**
   * 把 '2h' / '7d' / '30m' / '3600'(秒) 转成毫秒，解析失败回退到 fallbackMs。
   */
  private expiryToMs(expr: string | undefined, fallbackMs: number): number {
    if (!expr) return fallbackMs;
    const match = /^(\d+)([smhd])?$/.exec(expr.trim());
    if (!match) return fallbackMs;
    const value = parseInt(match[1], 10);
    const unit = match[2] || 's';
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };
    return value * (multipliers[unit] || 1000);
  }

  private clearTokenCookies(res: Response) {
    res.clearCookie('accessToken', { path: '/' });
    res.clearCookie('refreshToken', { path: '/' });
  }

  /**
   * 校验请求是否来自回环地址。单机模式的免密登录端点必须只能本机调用，
   * 防止反向代理或绑定配置变更后外网直接拿到管理员令牌。
   */
  private assertLoopback(req: Request) {
    const ip = req.ip || '';
    const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'];
    if (!loopback.includes(ip)) {
      throw new ForbiddenException('单机模式登录仅允许本机调用');
    }
  }

  /**
   * 智汇工作台统一登录(D-018): 门户转发层在请求头附带签名身份 X-ZH-Identity(目标须为本系统 ZH_APP_ID)。
   * 校验通过后按用户名映射本系统账号: 已有同名账号沿用其角色; 没有则自动创建
   * (门户管理员 → 本系统管理员, 其余 → 只读角色, 口令为随机值, 只能经统一登录进入)。
   * 未接入平台(无 ZH_IDENTITY_KEY)或身份无效时 401, 前端回到原登录表单。
   */
  @Public()
  @Post('zh-sso')
  async zhSso(@ZhReq() req: any, @Res({ passthrough: true }) res: Response) {
    const claims = zhVerifyIdentity(req.headers['x-zh-identity'], process.env.ZH_APP_ID);
    if (!claims) throw new ZhUnauthorized('未通过智汇工作台统一登录');
    const result = await this.authService.ssoLogin(claims.sub, claims.name, claims.role === 'admin');
    if (!result) throw new ZhForbidden('该账号在本系统已停用');
    this.setTokenCookies(res, result.accessToken, result.refreshToken);
    return result;
  }
}
