import { Controller, Get, Put, Body } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { AiService } from '../../common/services/ai.service';
import { SystemConfigService } from '../system-config/system-config.service';

@ApiTags('大模型配置')
@Controller('ai-config')
export class AiConfigController {
  constructor(
    private readonly aiService: AiService,
    private readonly systemConfigService: SystemConfigService,
  ) {}

  @Get('health')
  health() {
    return this.aiService.health();
  }

  @Get()
  async getConfig() {
    try {
      return await this.aiService.getLlmConfig();
    } catch {
      const fallback = await this.systemConfigService.getValue('ai_config_cached');
      if (fallback) {
        try {
          return { ...JSON.parse(fallback), _cached: true };
        } catch {}
      }
      return {
        deepseek: { apiKey: '', model: '', baseUrl: 'https://api.deepseek.com/v1' },
        glm: {
          apiKey: '', model: '', baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
          // GLM 工具调用默认值（与 ai-service config.py 对齐，AI 服务离线时也保留字段）
          toolsEnabled: false, toolModel: 'glm-5.2',
          webSearchEnabled: false, webSearchModel: 'glm-4-air',
          webSearchEngine: 'search_std', webSearchCount: 5,
        },
        openai: { apiKey: '', model: '', baseUrl: 'https://api.openai.com/v1' },
        embedding: { provider: 'basic', model: 'BAAI/bge-small-zh-v1.5' },
        rag: { topK: 5, chunkSize: 500, chunkOverlap: 100 },
        _error: 'AI 服务未连接，显示默认值',
      };
    }
  }

  @Put()
  @Roles('admin')
  async updateConfig(@Body() body: any) {
    try {
      return await this.aiService.updateLlmConfig(body);
    } catch {
      await this.systemConfigService.setValue(
        'ai_config_cached',
        JSON.stringify(body),
        'ai',
        'AI 大模型配置（AI 服务离线时缓存）',
      );
      return {
        success: true,
        _offline: true,
        message: 'AI 服务未连接，配置已本地保存。启动 AI 服务后将自动生效。',
      };
    }
  }

  @Get('engine-templates')
  async getEngineTemplates() {
    try {
      return await this.aiService.getEngineTemplates();
    } catch {
      return { templates: [], _error: 'AI 服务未连接' };
    }
  }
}
