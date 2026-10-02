import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import * as compression from 'compression';
import * as cookieParser from 'cookie-parser';
import * as path from 'path';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { ensureSecrets, assertProductionSecrets } from './config/secrets.bootstrap';
import { adoptLegacyDatabase } from './database/legacy-adopt';
import { applyPendingRestore } from './modules/backup/backup.service';
import { rotateLog, ensureLogDir } from './common/utils/log-rotation.util';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // ── 日志轮转 ─────────────────────────────────────────────────
  const logDir = path.resolve(process.cwd(), 'data', 'logs');
  ensureLogDir(logDir);
  rotateLog(path.join(logDir, 'app.log'), 5, 10);

  // ── 密钥引导：必须在 NestFactory.create 之前 ──────────────────
  // ConfigModule 在应用创建时读取 process.env，这里先把缺失/不安全的密钥补齐。
  const envPath = path.resolve(process.cwd(), '.env');
  const { generated, adminPassword, aiKeySynced } = ensureSecrets(envPath);
  assertProductionSecrets();

  if (aiKeySynced) {
    // 密钥不一致时 AI 的表现是"离线"，跟没装、没启动看起来一模一样，
    // 不明确说出来用户会一路去查网络和 Python 环境。
    logger.warn(
      'AI 服务密钥与后端不一致，已重新写入 ai-service/.env；' +
        '请重启 AI 服务后 AI 功能才会恢复。',
    );
  }

  // ── 待还原的备份：必须早于一切数据库访问 ─────────────────────
  applyPendingRestore(path.resolve(process.cwd(), 'data'));

  // ── 遗留库纳管：必须早于 TypeORM 初始化 ───────────────────────
  // 老库由 synchronize 建表、没有 migrations 表，直接跑迁移会因表已存在而失败。
  if ((process.env.DB_TYPE || 'sqlite') !== 'postgres') {
    const dbPath = path.resolve(
      process.cwd(),
      process.env.SQLITE_PATH || path.join('data', 'app.db'),
    );
    adoptLegacyDatabase(dbPath, path.join(__dirname, 'database', 'migrations'));
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useBodyParser('json', { limit: '8mb' });
  const configService = app.get(ConfigService);
  const appMode = configService.get<'single' | 'team'>('app.appMode');
  const isProd = process.env.NODE_ENV === 'production';

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      // 单机走 http://localhost，强制 HTTPS 会把用户挡在门外
      hsts: isProd && appMode === 'team',
    }),
  );
  app.use(compression());
  app.use(cookieParser());

  app.enableCors({
    origin: configService.get('app.corsOrigin') || 'http://localhost:5274',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors) => {
        const messages = errors.map((e) => Object.values(e.constraints || {}).join(', '));
        return new BadRequestException(messages.join('; '));
      },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());
  app.setGlobalPrefix('api');

  /*
   * 这里曾经是 app.use('/uploads', express.static(...))。
   * 那样会把整个上传目录无鉴权暴露 —— 知道 URL 就能下载任何技术协议、
   * 报价单、客户图纸，实体上的 visibility 控制完全被绕过。
   * 现已改为 FilesController（/api/files/*），每次下载都校验登录态与权限。
   */

  // API 文档只在非生产开放，避免把内部接口结构送给外部
  if (!isProd) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('AI Knowledge Base API')
      .setDescription('AI 业务知识库系统 API 文档')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  }

  const port = configService.get<number>('app.port') || 3101;

  /*
   * 单机模式提供免密登录（single-mode-login），所以绝不能监听 0.0.0.0 ——
   * 否则同一局域网内任何机器都能直接拿到管理员令牌。
   * 团队模式有完整认证，才允许对外监听。
   */
  const host = appMode === 'single' ? '127.0.0.1' : process.env.BIND_HOST || '0.0.0.0';

  await app.listen(port, host);

  // ── 启动提示 ─────────────────────────────────────────────────
  if (Object.keys(generated).length) {
    logger.warn(`已为本机生成安全密钥并写入 .env：${Object.keys(generated).join('、')}`);
  }
  if (adminPassword) {
    logger.warn('='.repeat(58));
    logger.warn('  初始管理员账号：admin');
    logger.warn(`  初始管理员密码：${adminPassword}`);
    logger.warn('  请登录后立即修改，此密码只显示这一次');
    logger.warn('='.repeat(58));
  }

  logger.log(`运行模式：${appMode === 'single' ? '单机个人版' : '团队版'}`);
  logger.log(`服务地址：http://${host}:${port}`);
  if (appMode === 'single') {
    logger.log('单机模式已绑定 127.0.0.1，仅本机可访问');
  }
  if (!isProd) logger.log(`API 文档：http://${host}:${port}/api/docs`);
}

bootstrap().catch((err) => {
  // 密钥校验失败等启动期错误要给出可读提示，而不是一堆堆栈
  new Logger('Bootstrap').error(err.message);
  process.exit(1);
});
