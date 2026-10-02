import 'dotenv/config';
import { DataSource } from 'typeorm';
import databaseConfig from '../config/database.config';

/**
 * TypeORM CLI 用的数据源（migration:generate / run / revert）。
 *
 * 与运行时共用 database.config，保证生成的迁移与实际建表逻辑一致。
 * 额外做两件事：
 *   · 加载 .env —— CLI 进程不经过 NestJS ConfigModule
 *   · 关闭 migrationsRun —— 生成迁移时不应又去跑一遍迁移
 */
const config = databaseConfig() as any;

export default new DataSource({
  ...config,
  migrationsRun: false,
  synchronize: false,
});
