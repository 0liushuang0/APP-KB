import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Solution, ConfigOption, PriceTable } from './entities/solution.entity';
import { Product } from '../products/entities/product.entity';
import { TransactionService } from '../../common/services/transaction.service';
import {
  CreateSolutionDto,
  UpdateSolutionDto,
  CreateConfigOptionDto,
  CreatePriceTableDto,
  CalculatePriceDto,
  QuerySolutionDto,
} from './dto/solution.dto';
import { CurrentUser } from '../../common/services/permission.service';
import { AiService } from '../../common/services/ai.service';
import { KnowledgeSyncService } from '../../common/services/knowledge-sync.service';

@Injectable()
export class SolutionsService {
  private readonly logger = new Logger(SolutionsService.name);

  constructor(
    @InjectRepository(Solution)
    private solutionRepository: Repository<Solution>,
    @InjectRepository(ConfigOption)
    private configOptionRepository: Repository<ConfigOption>,
    @InjectRepository(PriceTable)
    private priceTableRepository: Repository<PriceTable>,
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
    private aiService: AiService,
    private transactionService: TransactionService,
    private knowledgeSyncService: KnowledgeSyncService,
  ) {}

  /**
   * 同步方案模板到向量库。
   * 之前 SolutionsService 完全没接 KnowledgeSyncService，
   * 而 proposals.generate / quotations.suggest 都在 searchRag 里带 'solution' 类型——
   * 方案模板从不入库，导致方案匹配永远少一条召回来源。
   */
  private async sync(solution: Solution): Promise<void> {
    // 关键参数 / 适用场景 / 参数摘要一并入库，让需求匹配能召回到这些结构化信息
    const content = `${solution.name} ${solution.directory || ''} ${solution.category || ''} ${solution.solutionType || ''} ${solution.description || ''} ${solution.scenario || ''} ${solution.paramSummary || ''} ${solution.keyParams || ''} ${solution.tags?.join(' ') || ''} ${solution.defaultConfig || ''}`;
    await this.knowledgeSyncService.syncObject({
      id: solution.id,
      objectType: 'solution',
      title: solution.name,
      content,
      visibility: 'public' as any,
      uploaderId: solution.ownerId,
    });
  }

  private stripCost<T extends object>(data: T, user?: CurrentUser): T {
    if (!user || this.canViewCost(user)) return data;
    if (Array.isArray(data)) return data.map((d) => this.stripCost(d, user)) as unknown as T;
    const stripped = { ...data };
    if ('priceTables' in stripped && Array.isArray((stripped as any).priceTables)) {
      (stripped as any).priceTables = (stripped as any).priceTables.map((pt: any) => ({ ...pt, cost: null }));
    }
    if ('estimatedCost' in stripped) (stripped as any).estimatedCost = null;
    if ('estimatedMargin' in stripped) (stripped as any).estimatedMargin = null;
    return stripped;
  }

  private canViewCost(user: CurrentUser): boolean {
    return user.isSystemAdmin || user.roles?.some((r: string) => ['admin', 'manager', 'purchase'].includes(r));
  }

  async findAll(query: QuerySolutionDto, user?: CurrentUser): Promise<Solution[]> {
    const where: any = {};
    if (query.category) where.category = query.category;
    if (query.productId) where.productId = query.productId;
    if (query.keyword) where.name = Like(`%${query.keyword}%`);
    const solutions = await this.solutionRepository.find({
      where,
      order: { createdAt: 'DESC' },
    });
    for (const solution of solutions) {
      (solution as any).configOptions = await this.configOptionRepository.find({
        where: { solutionId: solution.id },
        order: { sortOrder: 'ASC' },
      });
      const priceTables = await this.priceTableRepository.find({
        where: { solutionId: solution.id },
      });
      (solution as any).priceTables = user ? this.stripCost(priceTables, user) : priceTables;
    }
    return solutions;
  }

  async findOne(id: string, user?: CurrentUser): Promise<Solution> {
    const solution = await this.solutionRepository.findOne({ where: { id } });
    if (!solution) throw new NotFoundException('方案不存在');
    (solution as any).configOptions = await this.configOptionRepository.find({
      where: { solutionId: id },
      order: { sortOrder: 'ASC' },
    });
    (solution as any).priceTables = user
      ? this.stripCost(await this.priceTableRepository.find({ where: { solutionId: id } }), user)
      : await this.priceTableRepository.find({ where: { solutionId: id } });
    return solution;
  }

  async create(dto: CreateSolutionDto, user?: CurrentUser): Promise<Solution> {
    // 标准方案不再生成流水编号：它靠技术方案匹配定位，不靠编号检索；
    // 历史数据的 solutionNo 保留不动，新建的为空
    const solution = this.solutionRepository.create({
      ...dto,
      solutionType: dto.solutionType || 'standard',
      // 新建默认「已发布」，与旧的 approved（即可用）行为保持一致；草稿/停用由编辑切换
      status: dto.status || 'published',
      ownerId: user?.userId,
    });
    const saved = await this.solutionRepository.save(solution);
    await this.sync(saved);
    return saved;
  }

  /**
   * 复制方案：模板库最常用的操作 —— 以一个成熟方案为蓝本快速起草新方案。
   * 连带复制配置项与价格表；编号不继承也不新生成（标准方案不走流水号），状态置为草稿，避免误当成已发布。
   */
  async copy(id: string, user?: CurrentUser): Promise<Solution> {
    const source = await this.solutionRepository.findOne({ where: { id } });
    if (!source) throw new NotFoundException('方案不存在');

    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = source as any;
    const saved = await this.transactionService.run(
      async (manager) => {
        const next = manager.create(Solution, {
          ...rest,
          solutionNo: null,
          name: `${source.name}（副本）`,
          status: 'draft',
          version: 1,
          ownerId: user?.userId || source.ownerId,
        });
        const row = await manager.save(next);

        const options = await this.configOptionRepository.find({ where: { solutionId: id } });
        for (const o of options) {
          const { id: _oid, createdAt: _oc, updatedAt: _ou, ...orest } = o as any;
          await manager.save(manager.create(ConfigOption, { ...orest, solutionId: row.id }));
        }
        const prices = await this.priceTableRepository.find({ where: { solutionId: id } });
        for (const p of prices) {
          const { id: _pid, createdAt: _pc, updatedAt: _pu, ...prest } = p as any;
          await manager.save(manager.create(PriceTable, { ...prest, solutionId: row.id }));
        }
        return row;
      },
      async (row) => {
        await this.sync(row);
      },
    );
    return saved;
  }

  /**
   * 批量移动/重命名目录节点：把 directory 以 from（或 from/…）开头的方案，
   * 前缀整体替换成 to。目录只是显示路径、无其它实体引用，批量改无级联风险。
   */
  async moveDirectory(from: string, to: string): Promise<{ moved: number }> {
    const f = (from || '').trim().replace(/\/+$/, '');
    const t = (to || '').trim().replace(/\/+$/, '');
    if (!f) throw new BadRequestException('缺少原目录');
    if (f === t) return { moved: 0 };

    const all = await this.solutionRepository.find();
    const affected = all.filter(
      (s) => s.directory === f || (s.directory || '').startsWith(`${f}/`),
    );
    if (affected.length === 0) return { moved: 0 };

    const rows = await this.transactionService.run(
      async (manager) => {
        for (const s of affected) {
          const suffix = s.directory === f ? '' : (s.directory || '').slice(f.length + 1);
          s.directory = [t, suffix].filter(Boolean).join('/') || null;
          await manager.save(Solution, s);
        }
        return affected;
      },
      async (saved) => {
        await Promise.all(saved.map((s) => this.sync(s)));
      },
    );
    return { moved: rows.length };
  }

  async update(id: string, dto: UpdateSolutionDto): Promise<Solution> {
    const solution = await this.findOne(id);
    Object.assign(solution, dto);
    const saved = await this.solutionRepository.save(solution);
    await this.sync(saved);
    return saved;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.transactionService.run(
      async (manager) => {
        await manager.delete(ConfigOption, { solutionId: id });
        await manager.delete(PriceTable, { solutionId: id });
        await manager.delete(Solution, id);
      },
      async () => {
        await this.knowledgeSyncService.deleteObject('solution', id);
      },
    );
  }

  async calculatePrice(dto: CalculatePriceDto, user?: CurrentUser) {
    const solution = await this.solutionRepository.findOne({
      where: { id: dto.solutionId },
    });
    if (!solution) throw new NotFoundException('方案不存在');

    let basePrice = 0;
    if (solution.productId) {
      const product = await this.productRepository.findOne({
        where: { id: solution.productId },
      });
      if (product) {
        basePrice = Number(product.price) || 0;
      }
    }

    const configString = dto.config || solution.defaultConfig || '{}';
    let config: Record<string, string> = {};
    try {
      config = JSON.parse(configString);
    } catch {
      throw new BadRequestException('配置项 JSON 解析失败');
    }

    let configDelta = 0;
    let estimatedCost = 0;
    const breakdown: any[] = [];
    const leadTimes: number[] = [];

    for (const [optionKey, optionValue] of Object.entries(config)) {
      const priceEntry = await this.priceTableRepository.findOne({
        where: {
          solutionId: dto.solutionId,
          optionKey,
          optionValue: String(optionValue),
        },
      });
      if (!priceEntry) {
        breakdown.push({
          optionKey,
          optionValue,
          priceDelta: 0,
          cost: 0,
          matched: false,
        });
        continue;
      }
      const delta = Number(priceEntry.priceDelta) || 0;
      const cost = Number(priceEntry.cost) || 0;
      configDelta += delta;
      estimatedCost += cost;
      breakdown.push({
        optionKey,
        optionValue,
        priceDelta: delta,
        cost,
        leadTime: priceEntry.leadTime,
        matched: true,
      });
      if (priceEntry.leadTime) {
        const days = this.parseLeadTimeDays(priceEntry.leadTime);
        if (days !== null) leadTimes.push(days);
      }
    }

    const discount = dto.discount ?? 100;
    const totalPrice = (basePrice + configDelta) * (discount / 100);
    const estimatedMargin =
      totalPrice > 0 ? ((totalPrice - estimatedCost) / totalPrice) * 100 : 0;

    let leadTime = '30天';
    if (leadTimes.length > 0) {
      leadTime = `${Math.max(...leadTimes)}天`;
    }

    const result = {
      basePrice,
      configDelta,
      totalPrice,
      estimatedCost,
      estimatedMargin,
      leadTime,
      breakdown,
    };
    if (user && !this.canViewCost(user)) {
      result.estimatedCost = null as any;
      result.estimatedMargin = null as any;
      result.breakdown = result.breakdown.map((b) => ({ ...b, cost: null as any }));
    }
    return result;
  }

  async upsertConfigOption(dto: CreateConfigOptionDto): Promise<ConfigOption> {
    if (dto.solutionId) {
      const solution = await this.solutionRepository.findOne({
        where: { id: dto.solutionId },
      });
      if (!solution) throw new NotFoundException('方案不存在');
    }
    const existing = await this.configOptionRepository.findOne({
      where: { solutionId: dto.solutionId, key: dto.key },
    });
    if (existing) {
      Object.assign(existing, dto);
      return this.configOptionRepository.save(existing);
    }
    const option = this.configOptionRepository.create(dto);
    return this.configOptionRepository.save(option);
  }

  async removeConfigOption(id: string): Promise<void> {
    const option = await this.configOptionRepository.findOne({ where: { id } });
    if (!option) throw new NotFoundException('配置项不存在');
    await this.configOptionRepository.delete(id);
  }

  async upsertPriceTable(dto: CreatePriceTableDto): Promise<PriceTable> {
    if (dto.solutionId) {
      const solution = await this.solutionRepository.findOne({
        where: { id: dto.solutionId },
      });
      if (!solution) throw new NotFoundException('方案不存在');
    }
    const existing = await this.priceTableRepository.findOne({
      where: {
        solutionId: dto.solutionId || null,
        optionKey: dto.optionKey,
        optionValue: dto.optionValue,
      },
    });
    if (existing) {
      Object.assign(existing, dto);
      return this.priceTableRepository.save(existing);
    }
    const entry = this.priceTableRepository.create(dto);
    return this.priceTableRepository.save(entry);
  }

  async removePriceTable(id: string): Promise<void> {
    const entry = await this.priceTableRepository.findOne({ where: { id } });
    if (!entry) throw new NotFoundException('价表条目不存在');
    await this.priceTableRepository.delete(id);
  }

  async validateConfig(solutionId: string, config: Record<string, string>): Promise<{
    valid: boolean;
    errors: { type: string; message: string; key?: string }[];
  }> {
    const options = await this.configOptionRepository.find({
      where: { solutionId },
    });
    const optionMap = new Map(options.map((o) => [o.key, o]));
    const errors: { type: string; message: string; key?: string }[] = [];

    for (const [key, value] of Object.entries(config)) {
      const opt = optionMap.get(key);
      if (!opt) continue;

      if (opt.choices) {
        let allowedChoices: string[] = [];
        try {
          const parsed = JSON.parse(opt.choices);
          allowedChoices = Array.isArray(parsed)
            ? parsed.map(String)
            : typeof parsed === 'object' && parsed.choices
              ? parsed.choices.map(String)
              : String(opt.choices).split(',').map((s) => s.trim());
        } catch {
          allowedChoices = String(opt.choices).split(',').map((s) => s.trim());
        }
        if (allowedChoices.length > 0 && !allowedChoices.includes(String(value))) {
          errors.push({
            type: 'invalid_choice',
            key,
            message: `${opt.label}（${key}）的值「${value}」不在可选项中：${allowedChoices.join('、')}`,
          });
        }
      }

      if (opt.constraintRules) {
        let rules: { requires?: { key: string; value: string }[]; excludes?: { key: string; value: string }[] };
        try {
          rules = JSON.parse(opt.constraintRules);
        } catch {
          continue;
        }

        if (rules.requires) {
          for (const req of rules.requires) {
            const actualValue = config[req.key];
            if (actualValue !== req.value) {
              const reqOpt = optionMap.get(req.key);
              errors.push({
                type: 'dependency',
                key,
                message: `选择「${opt.label}=${value}」时，必须同时选择「${reqOpt?.label || req.key}=${req.value}」`,
              });
            }
          }
        }

        if (rules.excludes) {
          for (const exc of rules.excludes) {
            const actualValue = config[exc.key];
            if (actualValue === exc.value) {
              const excOpt = optionMap.get(exc.key);
              errors.push({
                type: 'mutex',
                key,
                message: `「${opt.label}=${value}」与「${excOpt?.label || exc.key}=${exc.value}」互斥，不能同时选择`,
              });
            }
          }
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  private parseLeadTimeDays(leadTime: string): number | null {
    if (!leadTime) return null;
    const match = leadTime.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }
}
