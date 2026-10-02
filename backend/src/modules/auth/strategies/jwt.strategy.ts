import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';
import { Request } from 'express';

/**
 * 从 httpOnly Cookie 或 Authorization Header 提取 JWT。
 *
 * 优先级：Cookie > Authorization Header
 * 生产环境走 Cookie（XSS 无法读取），开发环境仍支持 Header 方式。
 */
function extractJwtFromRequest(req: Request): string | null {
  // 优先从 Cookie 读取
  if (req.cookies?.accessToken) {
    return req.cookies.accessToken;
  }
  // 回退到 Authorization Header
  return ExtractJwt.fromAuthHeaderAsBearerToken()(req);
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private usersService: UsersService,
  ) {
    super({
      jwtFromRequest: extractJwtFromRequest,
      ignoreExpiration: false,
      secretOrKey: configService.get('app.jwt.secret'),
    });
  }

  async validate(payload: any) {
    const user = await this.usersService.findOne(payload.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('用户不存在或已禁用');
    }
    return {
      userId: user.id,
      username: user.username,
      roles: user.roles.map((r) => r.code),
      departmentId: user.departmentId,
      groupIds: user.groups.map((g) => g.id),
      isSystemAdmin: user.isSystemAdmin,
    };
  }
}
