import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiService } from '../../common/services/ai.service';
import { ZhServiceTokenGuard } from '../../common/zh-contract';
import { AiCallLog } from '../ai/entities/ai-call-log.entity';
import { SystemConfigModule } from '../system-config/system-config.module';
import { ZhSettingsController } from './zh-settings.controller';

/** 智汇平台统一设置(工作台「系统设置」调用), 见 zh-settings.controller.ts */
@Module({
  imports: [TypeOrmModule.forFeature([AiCallLog]), SystemConfigModule],
  controllers: [ZhSettingsController],
  providers: [AiService, ZhServiceTokenGuard],
})
export class ZhSettingsModule {}
