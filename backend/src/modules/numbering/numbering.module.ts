import { Global, Module } from '@nestjs/common';
import { NumberingService } from '../../common/services/numbering.service';
import { SharedFieldsService } from '../../common/services/shared-fields.service';
import { KnowledgeSyncService } from '../../common/services/knowledge-sync.service';
import { AiService } from '../../common/services/ai.service';
import { NumberingController } from './numbering.controller';

/**
 * 编号生成是需求、方案、报价、项目四个模块都要用的能力，
 * 声明为 Global 省得每个业务模块各 import 一遍。
 */
@Global()
@Module({
  controllers: [NumberingController],
  providers: [NumberingService, SharedFieldsService, KnowledgeSyncService, AiService],
  exports: [NumberingService, SharedFieldsService],
})
export class NumberingModule {}
