import {
  Injectable,
  NotFoundException,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemConfig } from './entities/system-config.entity';
import {
  CreateSystemConfigDto,
  UpdateSystemConfigDto,
} from './dto/system-config.dto';

interface DefaultConfig {
  key: string;
  value: string;
  category: string;
  description: string;
}

@Injectable()
export class SystemConfigService implements OnModuleInit {
  private readonly logger = new Logger(SystemConfigService.name);

  private readonly defaultConfigs: DefaultConfig[] = [
    {
      key: 'system_name',
      value: 'BOYA 智能运营中心',
      category: 'system',
      description: '系统名称（显示在导航栏和浏览器标签）',
    },
    {
      key: 'company_name',
      value: '我的公司',
      category: 'company',
      description: '公司名称',
    },
    {
      key: 'company_address',
      value: '',
      category: 'company',
      description: '公司地址',
    },
    {
      key: 'company_phone',
      value: '',
      category: 'company',
      description: '公司电话',
    },
    {
      key: 'tax_rate',
      value: '0.13',
      category: 'finance',
      description: '默认税率',
    },
    {
      key: 'currency',
      value: 'CNY',
      category: 'finance',
      description: '默认货币',
    },
    {
      key: 'currency_symbol',
      value: '¥',
      category: 'finance',
      description: '货币符号',
    },
    {
      key: 'language',
      value: 'zh-CN',
      category: 'system',
      description: '系统语言',
    },
    {
      key: 'project_stage_template',
      value: '设计:15, 采购:20, 制造:25, 装配:10, 出厂验收:5, 发运:5, 安装调试:15, 终验收:5',
      category: 'project',
      description: '项目标准阶段（名称:工期占比，逗号分隔）。从合同立项时按此模板把开工→完工切成阶段',
    },
    {
      key: 'timezone',
      value: 'Asia/Shanghai',
      category: 'system',
      description: '系统时区',
    },
    // ── 第二轮：英文报价单 / 多币种 / 毛利提醒 / 周报 ──
    {
      key: 'company_name_en',
      value: '',
      category: 'company',
      description: '公司英文名称（英文报价单抬头；不填则用中文名称）',
    },
    {
      key: 'company_address_en',
      value: '',
      category: 'company',
      description: '公司英文地址（英文报价单抬头）',
    },
    {
      key: 'exchange_rates',
      value: '{"USD":7.1,"EUR":7.75}',
      category: 'finance',
      description: '参考汇率（1 外币 = x 人民币）：新建美元/欧元报价时的默认汇率，单据上可改；汇总金额按单据锁定的汇率折人民币',
    },
    {
      key: 'quote_margin_alert',
      value: '15',
      category: 'finance',
      description: '报价毛利率低于此值（%）时在报价单上提醒',
    },
    {
      key: 'weekly_report_enabled',
      value: 'true',
      category: 'report',
      description: '每周一 8:30 自动生成周报并推送到每个人的通知（false 关闭）',
    },
  ];

  constructor(
    @InjectRepository(SystemConfig)
    private systemConfigRepository: Repository<SystemConfig>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.initializeDefaults();
  }

  async findAll(): Promise<SystemConfig[]> {
    return this.systemConfigRepository.find({
      order: { category: 'ASC', key: 'ASC' },
    });
  }

  async findByCategory(category: string): Promise<SystemConfig[]> {
    return this.systemConfigRepository.find({
      where: { category },
      order: { key: 'ASC' },
    });
  }

  async getValue(key: string, defaultValue?: string): Promise<string | null> {
    const config = await this.systemConfigRepository.findOne({
      where: { key },
    });
    if (!config) return defaultValue !== undefined ? defaultValue : null;
    return config.value;
  }

  async setValue(
    key: string,
    value: string,
    category?: string,
    description?: string,
  ): Promise<SystemConfig> {
    const existing = await this.systemConfigRepository.findOne({
      where: { key },
    });
    if (existing) {
      existing.value = value;
      if (category !== undefined) existing.category = category;
      if (description !== undefined) existing.description = description;
      return this.systemConfigRepository.save(existing);
    }
    const config = this.systemConfigRepository.create({
      key,
      value,
      category,
      description,
    });
    return this.systemConfigRepository.save(config);
  }

  async update(
    id: string,
    dto: UpdateSystemConfigDto,
  ): Promise<SystemConfig> {
    const config = await this.systemConfigRepository.findOne({
      where: { id },
    });
    if (!config) throw new NotFoundException('系统配置不存在');
    Object.assign(config, dto);
    return this.systemConfigRepository.save(config);
  }

  async remove(id: string): Promise<void> {
    const config = await this.systemConfigRepository.findOne({
      where: { id },
    });
    if (!config) throw new NotFoundException('系统配置不存在');
    await this.systemConfigRepository.delete(config.id);
  }

  private async initializeDefaults(): Promise<void> {
    try {
      // 只补缺少的键：已有安装升级后也能拿到新增的配置项，已有的值一律不动
      const existing = new Set((await this.systemConfigRepository.find({ select: ['key'] as any })).map((c) => c.key));
      const missing = this.defaultConfigs.filter((c) => !existing.has(c.key));
      if (!missing.length) return;
      const entities = missing.map((c) => this.systemConfigRepository.create(c));
      await this.systemConfigRepository.save(entities);
      this.logger.log(`Initialized ${entities.length} default system configs`);
    } catch (err) {
      this.logger.error(
        `Failed to initialize default system configs: ${err?.message}`,
        err?.stack,
      );
    }
  }
}
