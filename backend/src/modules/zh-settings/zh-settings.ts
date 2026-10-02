/**
 * 智汇平台统一设置适配 (contract zh/1 · 0.4.0) — 知识库
 *
 * 本系统设置: system_configs 键值表(系统名称/公司信息/财务/区域) + AI 服务的大模型配置。
 * 平台统一键 → 本系统键; 被接管的键在接入平台时只读, 修改请到智汇工作台「系统设置」。
 * AI 统一配置写入 AI 服务的「OpenAI 兼容」引擎块(ai.openai.*), 其余引擎/RAG 参数仍在本系统维护。
 */
import { resolve } from 'path';
import { ZhManagedStore, ZhSettingItem, zhMaskSecret, zhSettingItem } from '../../common/zh-contract';

export const ZH_SETTINGS_MAP: Record<string, string> = {
  'zh.app.name': 'system_name',
  'zh.enterprise.name': 'company_name',
  'zh.enterprise.address': 'company_address',
  'zh.enterprise.phone': 'company_phone',
  'zh.ai.base_url': 'ai.openai.baseUrl',
  'zh.ai.api_key': 'ai.openai.apiKey',
  'zh.ai.model': 'ai.openai.model',
};

/** 键 → [标签, 分类, 类型] */
export const ZH_SETTING_DEFS: Record<string, [string, ZhSettingItem['category'], ZhSettingItem['type']]> = {
  system_name: ['系统名称', 'brand', 'string'],
  system_subtitle: ['副标题', 'brand', 'string'],
  admin_title: ['后台标题', 'brand', 'string'],
  company_name: ['公司名称', 'enterprise', 'string'],
  company_address: ['公司地址', 'enterprise', 'string'],
  company_phone: ['联系电话', 'enterprise', 'string'],
  currency: ['本位币', 'params', 'string'],
  currency_symbol: ['币种符号', 'params', 'string'],
  tax_rate: ['默认税率(%)', 'params', 'number'],
  language: ['界面语言', 'params', 'string'],
  timezone: ['时区', 'params', 'string'],
  'ai.openai.baseUrl': ['AI 接口地址（OpenAI 兼容）', 'ai', 'string'],
  'ai.openai.apiKey': ['AI API Key（OpenAI 兼容）', 'ai', 'secret'],
  'ai.openai.model': ['AI 模型（OpenAI 兼容）', 'ai', 'string'],
};

export const ZH_SETTING_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(ZH_SETTING_DEFS).map(([k, [label]]) => [k, label]));

/** 接管清单文件: backend/data/ (启动工作目录为 backend) */
export const ZH_SETTINGS_STORE = new ZhManagedStore(resolve(process.cwd(), 'data', 'zh-managed-settings.json'));

export function buildSchema(raw: Record<string, string>): ZhSettingItem[] {
  const managed = ZH_SETTINGS_STORE.active();
  const zhOf = Object.fromEntries(Object.entries(ZH_SETTINGS_MAP).map(([z, k]) => [k, z]));
  return Object.entries(ZH_SETTING_DEFS).map(([key, [label, category, type]]) =>
    zhSettingItem(key, label, category, type === 'secret' ? zhMaskSecret(raw[key]) : raw[key] ?? '',
      { type, zh_key: zhOf[key] ?? null, managed: managed.has(key) }));
}
