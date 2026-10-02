import { Controller, Get, Put, Body } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { AiService } from '../../common/services/ai.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { zhRejectManagedChanges } from '../../common/zh-contract';
import { ZH_SETTINGS_STORE, ZH_SETTING_LABELS } from '../zh-settings/zh-settings';

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
    // 「OpenAI 兼容」引擎由智汇工作台统一管理时, 不允许在本系统改动
    const cur = await this.aiService.getLlmConfig().catch(() => ({} as any));
    const flat = (c: any) => ({ 'ai.openai.baseUrl': c?.openai?.baseUrl ?? '', 'ai.openai.apiKey': c?.openai?.apiKey ?? '', 'ai.openai.model': c?.openai?.model ?? '' });
    if (body?.openai) zhRejectManagedChanges(ZH_SETTINGS_STORE, flat(body), flat(cur), ZH_SETTING_LABELS);
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
