import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiService } from '../../common/services/ai.service';
import { KnowledgeSyncService } from '../../common/services/knowledge-sync.service';
import {
  buildCustomerContent,
  buildRequirementContent,
  buildProposalContent,
  buildQuotationContent,
  buildContractContent,
  buildProjectContent,
  buildProductContent,
  buildSupplierContent,
  buildTicketContent,
  buildSolutionContent,
} from '../../common/services/index-content.builder';
import { Customer } from '../customers/entities/customer.entity';
import { Requirement } from '../requirements/entities/requirement.entity';
import { Proposal } from '../proposals/entities/proposal.entity';
import { Quotation } from '../quotations/entities/quotation.entity';
import { Contract } from '../contracts/entities/contract.entity';
import { Project } from '../projects/entities/project.entity';
import { Product } from '../products/entities/product.entity';
import { Supplier } from '../suppliers/entities/supplier.entity';
import { AfterSalesTicket } from '../after-sales/entities/ticket.entity';
import { Solution } from '../solutions/entities/solution.entity';
import { Document } from '../documents/entities/document.entity';
import { hasRealParsedText } from '../../common/utils/parsed-text.util';

/** 可重建的索引类型；与向量库里的 source_type 一一对应 */
export const REINDEXABLE_TYPES = [
  'customer',
  'requirement',
  'proposal',
  'quotation',
  'contract',
  'project',
  'product',
  'supplier',
  'ticket',
  'solution',
  // 业务资料的正文解析后存在 documents.parsedText 里，可以直接重建
  'document',
  /*
   * 注意：知识资料**不能**放进来。
   * 它的 parsedText 存的不是正文，而是一段索引状态标记
   * （{"indexed":true,"chunks":64,...}），真正的文本只存在于向量库中。
   * 从库里重建等于把状态标记当正文索引，会把原本好用的知识索引冲掉
   * （实测 597 个有效分块被替换成 30 条无意义标记）。
   * 知识资料的重建走 POST /documents/knowledge-reindex —— 那条路会重新读文件解析。
   */
] as const;

export type ReindexType = (typeof REINDEXABLE_TYPES)[number];

/** 是否解析出了真正的正文（排除占位话术与索引状态标记，见 parsed-text.util） */
const hasRealText = hasRealParsedText;

const TYPE_LABELS: Record<string, string> = {
  customer: '客户',
  requirement: '需求',
  proposal: '技术方案',
  quotation: '报价',
  contract: '合同',
  project: '项目',
  product: '产品',
  supplier: '供应商',
  ticket: '售后工单',
  solution: '标准方案',
  document: '业务资料',
  knowledge: '知识资料',
  product_attachment: '产品附件',
};

export interface IndexHealthRow {
  sourceType: string;
  label: string;
  /** 业务表里应该被索引的对象数 */
  expected: number;
  /** 向量库里实际有多少个对象；AI 服务离线时为 null（"读不到"，不是"没有"） */
  indexed: number | null;
  chunks: number | null;
  /** 可重建（document/knowledge 依赖文件解析，不在此列） */
  reindexable: boolean;
}

/**
 * 全量重建向量索引。
 *
 * 为什么必须有这个东西：
 * 索引原本只在「通过服务层新建/修改」时才写入，批量导入和种子数据从来没进过索引。
 * 实测本机 195 个客户只索引了 40 个、249 家供应商只有 96 家、10 份技术方案只有 1 份 ——
 * AI 答不好不是提示词问题，是它手里根本没有那些数据，而全系统没有任何补救入口。
 *
 * 重建策略：按类型先 purge 再全量写入。只 upsert 不 purge 的话，
 * 已删除对象的向量会永远留着（产品类就残留了 11 条幽灵数据）。
 */
@Injectable()
export class ReindexService {
  private readonly logger = new Logger(ReindexService.name);
  /** 同一时刻只允许一个重建任务，避免两次重建互相 purge */
  private running = false;
  private lastResult: Record<string, number> | null = null;
  private lastRunAt: Date | null = null;

  constructor(
    private readonly ai: AiService,
    private readonly sync: KnowledgeSyncService,
    @InjectRepository(Customer) private customers: Repository<Customer>,
    @InjectRepository(Requirement) private requirements: Repository<Requirement>,
    @InjectRepository(Proposal) private proposals: Repository<Proposal>,
    @InjectRepository(Quotation) private quotations: Repository<Quotation>,
    @InjectRepository(Contract) private contracts: Repository<Contract>,
    @InjectRepository(Project) private projects: Repository<Project>,
    @InjectRepository(Product) private products: Repository<Product>,
    @InjectRepository(Supplier) private suppliers: Repository<Supplier>,
    @InjectRepository(AfterSalesTicket) private tickets: Repository<AfterSalesTicket>,
    @InjectRepository(Solution) private solutions: Repository<Solution>,
    @InjectRepository(Document) private documents: Repository<Document>,
  ) {}

  isRunning(): boolean {
    return this.running;
  }

  /** 各类型在业务表里的应索引条数 */
  private async expectedCounts(): Promise<Record<string, number>> {
    const [
      customer,
      requirement,
      proposal,
      quotation,
      contract,
      project,
      product,
      supplier,
      ticket,
      solution,
      allDocs,
    ] = await Promise.all([
      this.customers.count(),
      // 需求存历史版本，只有当前版本进索引（与列表页口径一致）
      this.requirements.count({ where: [{ isCurrent: true }, { isCurrent: null }] as any }),
      this.proposals.count(),
      this.quotations.count(),
      this.contracts.count(),
      this.projects.count(),
      this.products.count(),
      this.suppliers.count(),
      this.tickets.count(),
      this.solutions.count(),
      this.documents.find({ select: ['id', 'category', 'parsedText'] as any }),
    ]);

    const isKnowledge = (d: any) => String(d.category || '').startsWith('knowledge');
    // 业务资料的"应索引数"按能否解析出正文算：扫描件没有文字，索引不了
    const hasText = (d: any) => hasRealText(d.parsedText);
    return {
      customer,
      requirement,
      proposal,
      quotation,
      contract,
      project,
      product,
      supplier,
      ticket,
      solution,
      /*
       * 知识资料按"总份数"算分母，而不是按标记里的 indexed 状态。
       * 标记会因跳过大文件、重跑中断而与真实索引状态脱节，用它当分母会算出
       * 300% 这种没法解释的覆盖率。用总份数则口径直白：30 份里进了几份。
       */
      knowledge: allDocs.filter(isKnowledge).length,
      document: allDocs.filter((d) => !isKnowledge(d) && hasText(d)).length,
    };
  }

  async getHealth(): Promise<{
    rows: IndexHealthRow[];
    totalChunks: number | null;
    running: boolean;
    lastRunAt: string | null;
    aiOnline: boolean;
  }> {
    const expected = await this.expectedCounts();
    let stats: Awaited<ReturnType<AiService['getIndexStats']>> | null = null;
    try {
      stats = await this.ai.getIndexStats();
    } catch (err) {
      this.logger.warn(`索引统计读取失败：${(err as Error)?.message}`);
    }

    /*
     * AI 服务离线时 indexed/chunks 一律给 null，而不是 0。
     * 给 0 会在面板上显示成"已索引 0、覆盖率 0%"——看起来像索引被清空了，
     * 实际只是读不到（我自己就被这套数字骗过一次，以为 2497 条数据没了）。
     */
    const types = new Set([...Object.keys(expected), ...Object.keys(stats?.by_source_type || {})]);
    const rows: IndexHealthRow[] = [...types]
      .map((t) => ({
        sourceType: t,
        label: TYPE_LABELS[t] || t,
        expected: expected[t] ?? 0,
        indexed: stats ? (stats.by_source_type?.[t]?.objects ?? 0) : null,
        chunks: stats ? (stats.by_source_type?.[t]?.chunks ?? 0) : null,
        reindexable: (REINDEXABLE_TYPES as readonly string[]).includes(t),
      }))
      .sort((a, b) => b.expected - a.expected);

    return {
      rows,
      totalChunks: stats?.total_chunks ?? null,
      running: this.running,
      lastRunAt: this.lastRunAt?.toISOString() ?? null,
      aiOnline: stats !== null,
    };
  }

  /**
   * 重建指定类型（不传则全部）。
   * 返回每种类型实际写入的对象数。
   */
  async reindex(types?: string[]): Promise<Record<string, number>> {
    if (this.running) throw new Error('已有重建任务在执行中，请等待完成');
    this.running = true;
    const targets = (types?.length ? types : [...REINDEXABLE_TYPES]).filter((t) =>
      (REINDEXABLE_TYPES as readonly string[]).includes(t),
    );
    const result: Record<string, number> = {};

    try {
      for (const type of targets) {
        try {
          await this.ai.purgeSourceType(type);
          result[type] = await this.rebuildType(type as ReindexType);
          this.logger.log(`索引重建完成：${TYPE_LABELS[type] || type} ${result[type]} 条`);
        } catch (err) {
          this.logger.error(`索引重建失败：${type} - ${(err as Error)?.message}`);
          result[type] = -1;
        }
      }
      this.lastResult = result;
      this.lastRunAt = new Date();
      return result;
    } finally {
      this.running = false;
    }
  }

  getLastResult() {
    return { result: this.lastResult, at: this.lastRunAt?.toISOString() ?? null };
  }

  /** 客户名字典，给需求/报价等对象补上"这是谁家的" */
  private async customerNameMap(): Promise<Map<string, string>> {
    const rows = await this.customers.find({ select: ['id', 'name'] as any });
    return new Map(rows.map((c) => [c.id, c.name]));
  }

  /** 按长度切块，与 KnowledgeSyncService 保持一致的窗口/重叠 */
  private chunkText(text: string, size = 500, overlap = 100): string[] {
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + size, text.length);
      chunks.push(text.slice(start, end).trim());
      start += size - overlap;
      if (end === text.length) break;
    }
    return chunks.filter(Boolean);
  }

  private async rebuildType(type: ReindexType): Promise<number> {
    /*
     * 批量写入，不走 syncObject 的逐条 delete+add。
     *
     * 逐条走的话每个对象要两次 HTTP，而 AI 侧每次 add_chunks 都会重建整个 FAISS
     * 与关键词索引（要把全表读出来重新向量化）—— 500 个对象就是 O(n²)，
     * 实测跑到 35 秒还没过半就把 HTTP 连接拖断了。
     * 这里改成：整类一次性算好分块，按 200 条一批提交，重建次数降到个位数。
     * 前面已经 purge 过整类，所以不需要再逐条删。
     */
    const push = async (
      rows: any[],
      build: (row: any) => string,
      visibilityOf?: (row: any) => any,
    ) => {
      const chunks: any[] = [];
      let n = 0;
      for (const row of rows) {
        const content = build(row);
        if (!content) continue;
        const title =
          row.name || row.title || row.contractNo || row.ticketNo || row.quotationNo || '';
        const perm = visibilityOf ? visibilityOf(row) : {};
        for (const text of this.chunkText(content)) {
          chunks.push({
            source_type: type,
            source_id: row.id,
            document_id: row.id,
            content: `${title}\n${text}`,
            permission_snapshot: {
              visibility: perm.visibility || 'public',
              uploader_id: perm.uploaderId,
              department_id: perm.departmentId,
              group_ids: perm.groupIds || [],
              role_codes: perm.roleCodes || [],
            },
          });
        }
        n++;
      }

      // 100 是 AI 服务 ChunkRequest 的 max_batch_size 上限，超过直接 422
      const BATCH = 100;
      for (let i = 0; i < chunks.length; i += BATCH) {
        await this.ai.addChunks(chunks.slice(i, i + BATCH), true);
      }
      return n;
    };

    // 权限快照：沿用各实体上的可见性字段，重建后不会把私有数据变成公开
    const perm = (row: any) => ({
      visibility: row.visibility || 'public',
      uploaderId: row.ownerId || row.uploaderId,
      departmentId: row.departmentId,
      groupIds: row.groupIds || [],
      roleCodes: row.roleCodes || [],
    });

    switch (type) {
      case 'customer': {
        const rows = await this.customers.find();
        return push(rows, (c) => buildCustomerContent({ customer: c }), perm);
      }
      case 'requirement': {
        const rows = (await this.requirements.find()).filter((r: any) => r.isCurrent !== false);
        const names = await this.customerNameMap();
        return push(rows, (r) => buildRequirementContent(r, names.get(r.customerId)), perm);
      }
      case 'proposal': {
        const rows = await this.proposals.find();
        const names = await this.customerNameMap();
        return push(rows, (p) => buildProposalContent(p, names.get(p.customerId)), perm);
      }
      case 'quotation': {
        const rows = await this.quotations.find();
        const names = await this.customerNameMap();
        return push(rows, (q) => buildQuotationContent(q, names.get(q.customerId)), perm);
      }
      case 'contract': {
        const rows = await this.contracts.find();
        const names = await this.customerNameMap();
        return push(rows, (c) => buildContractContent(c, names.get(c.customerId)), perm);
      }
      case 'project': {
        const rows = await this.projects.find();
        const names = await this.customerNameMap();
        return push(rows, (p) => buildProjectContent(p, names.get(p.customerId)), perm);
      }
      case 'product': {
        const rows = await this.products.find();
        return push(rows, buildProductContent, perm);
      }
      case 'supplier': {
        const rows = await this.suppliers.find();
        return push(rows, (s) => buildSupplierContent(s), perm);
      }
      case 'ticket': {
        const rows = await this.tickets.find();
        const names = await this.customerNameMap();
        return push(rows, (t) => buildTicketContent(t, names.get(t.customerId)), perm);
      }
      case 'solution': {
        const rows = await this.solutions.find();
        return push(rows, buildSolutionContent, perm);
      }
      /*
       * 资料类只重建"已经解析出正文"的那些。
       * 扫描件的 parsedText 是占位提示（如「文件已上传，等待解析」），
       * 把它索引进去只会污染检索结果 —— 问什么都能命中一堆"等待解析"。
       */
      case 'document': {
        const rows = (await this.documents.find()).filter(
          (d) => !String(d.category || '').startsWith('knowledge') && hasRealText(d.parsedText),
        );
        return push(rows, (d) => `${d.title || d.fileName || ''}\n${d.parsedText}`, perm);
      }
      default:
        return 0;
    }
  }
}
