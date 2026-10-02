import { IsString, IsOptional, MinLength, IsEmail, IsArray, Matches } from 'class-validator';

export class LoginDto {
  @IsString()
  username: string;

  @IsString()
  @MinLength(6, { message: '密码长度不能少于6位' })
  password: string;

  /** 双因素动态码（用户启用 TOTP 后必填） */
  @IsOptional()
  @Matches(/^\d{6}$/, { message: '动态验证码应为 6 位数字' })
  totpCode?: string;
}

export class EnableTotpDto {
  @Matches(/^\d{6}$/, { message: '动态验证码应为 6 位数字' })
  code: string;
}

export class DisableTotpDto {
  @IsString()
  password: string;

  @Matches(/^\d{6}$/, { message: '动态验证码应为 6 位数字' })
  code: string;
}

export class RegisterDto {
  @IsString()
  username: string;

  @IsString()
  @MinLength(8, { message: '密码长度不能少于8位' })
  password: string;

  @IsOptional()
  @IsString()
  nickname?: string;

  @IsOptional()
  @IsEmail({}, { message: '邮箱格式不正确' })
  email?: string;
}

export class RefreshTokenDto {
  @IsString()
  refreshToken: string;
}
