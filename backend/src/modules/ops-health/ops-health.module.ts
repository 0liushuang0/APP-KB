import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApprovalFlow } from '../approvals/entities/approval-flow.entity';
import { AiCallLog } from '../ai/entities/ai-call-log.entity';
import { ProductsModule } from '../products/products.module';
import { BackupModule } from '../backup/backup.module';
import { OpsHealthController } from './ops-health.controller';
import { OpsHealthService } from './ops-health.service';

/** 系统与数据健康总览(只读汇总); ReindexService 来自全局的 AI 模块 */
@Module({
  imports: [TypeOrmModule.forFeature([ApprovalFlow, AiCallLog]), ProductsModule, BackupModule],
  controllers: [OpsHealthController],
  providers: [OpsHealthService],
})
export class OpsHealthModule {}
