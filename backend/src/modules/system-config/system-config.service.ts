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
      value: 'BOYA 智能知识中心',
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
      key: 'timezone',
      value: 'Asia/Shanghai',
      category: 'system',
      description: '系统时区',
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
      const count = await this.systemConfigRepository.count();
      if (count > 0) return;
      const entities = this.defaultConfigs.map((c) =>
        this.systemConfigRepository.create(c),
      );
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
