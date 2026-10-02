/**
 * 智汇平台统一设置接口 (contract zh/1 · 0.4.0)
 *   GET /api/zh/v1/settings/schema   声明本系统设置项(密钥打码)
 *   PUT /api/zh/v1/settings          接收平台统一值/接管清单, 或工作台代改的本系统专属项
 *   GET /api/system-configs-managed  被平台接管的键(本系统前端据此只读显示, 需登录)
 */
import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { AiService } from '../../common/services/ai.service';
import { ZhServiceTokenGuard, ZhSettingsBody, zhApplyPlatformSettings } from '../../common/zh-contract';
import { SystemConfigService } from '../system-config/system-config.service';
import { ZH_SETTINGS_MAP, ZH_SETTINGS_STORE, ZH_SETTING_DEFS, ZH_SETTING_LABELS, buildSchema } from './zh-settings';

const AI_KEYS: Record<string, string> = { 'ai.openai.baseUrl': 'baseUrl', 'ai.openai.apiKey': 'apiKey', 'ai.openai.model': 'model' };

@Controller()
export class ZhSettingsController {
  constructor(private readonly configs: SystemConfigService, private readonly ai: AiService) {}

  private async readRaw(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const key of Object.keys(ZH_SETTING_DEFS)) {
      if (key in AI_KEYS) continue;
      out[key] = (await this.configs.getValue(key)) ?? '';
    }
    try {
      const llm = await this.ai.getLlmConfig();
      for (const [k, field] of Object.entries(AI_KEYS)) out[k] = String(llm?.openai?.[field] ?? '');
    } catch {
      /* AI 服务离线: AI 项显示为空 */
    }
    return out;
  }

  private async write(updates: Record<string, string>): Promise<void> {
    const openai: Record<string, string> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (key in AI_KEYS) {
        openai[AI_KEYS[key]] = value;
      } else if (key in ZH_SETTING_DEFS) {
        // 沿用本系统已有分类: 公司信息归 company, 其余归 system
        await this.configs.setValue(key, value, ZH_SETTING_DEFS[key][1] === 'enterprise' ? 'company' : 'system');
      }
    }
    if (Object.keys(openai).length) {
      const current = await this.ai.getLlmConfig().catch(() => ({}));
      await this.ai.updateLlmConfig({ ...current, openai: { ...(current?.openai ?? {}), ...openai } });
    }
  }

  @Public()
  @SkipThrottle()
  @UseGuards(ZhServiceTokenGuard)
  @Get('zh/v1/settings/schema')
  async schema() {
    return { contract: 'zh/1', app: 'ai-kb', settings_path: '/settings/config', items: buildSchema(await this.readRaw()) };
  }

  @Public()
  @SkipThrottle()
  @UseGuards(ZhServiceTokenGuard)
  @Put('zh/v1/settings')
  async put(@Body() body: ZhSettingsBody) {
    return zhApplyPlatformSettings(body, ZH_SETTINGS_MAP, ZH_SETTINGS_STORE, (u: Record<string, string>) => this.write(u));
  }

  @Get('system-configs-managed')
  managed() {
    const managed = [...ZH_SETTINGS_STORE.active()];
    return { managed, labels: managed.map((k) => ZH_SETTING_LABELS[k] ?? k), portal: !!process.env.ZH_SERVICE_TOKEN };
  }
}
