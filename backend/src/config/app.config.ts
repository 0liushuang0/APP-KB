import { registerAs } from '@nestjs/config';

/**
 * 应用配置。
 *
 * 敏感项（JWT_SECRET / AI_SERVICE_API_KEY / DEFAULT_ADMIN_PASSWORD）**不再提供兜底默认值** ——
 * 它们由 secrets.bootstrap.ts 在启动最早期生成并写入 .env。
 * 之前的 `|| 'change-this-secret-in-production'` 会让所有未改配置的安装实例
 * 共用同一个公开已知的签名密钥，等于没有认证。
 */
export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3101', 10),
  appMode: (process.env.APP_MODE || 'single') as 'single' | 'team',

  defaultAdmin: {
    username: process.env.DEFAULT_ADMIN_USERNAME || 'admin',
    // 由 ensureSecrets 保证有值
    password: process.env.DEFAULT_ADMIN_PASSWORD,
    nickname: process.env.DEFAULT_ADMIN_NICKNAME || '系统管理员',
    email: process.env.DEFAULT_ADMIN_EMAIL || 'admin@aikb.local',
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    // 访问令牌短有效期：令牌存在 localStorage，一次 XSS 不应等于长期接管账号；
    // 过期后由前端拦截器用 refreshToken 静默续期，用户无感。
    expiresIn: process.env.JWT_EXPIRES_IN || '2h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  aiServiceUrl: process.env.AI_SERVICE_URL || 'http://127.0.0.1:8100',
  aiServiceApiKey: process.env.AI_SERVICE_API_KEY,

  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5274',

  /**
   * 是否开放自助注册。
   * 单机个人版无意义；团队版也应由管理员建号，默认关闭。
   */
  allowSelfRegister: process.env.ALLOW_SELF_REGISTER === 'true',
}));
