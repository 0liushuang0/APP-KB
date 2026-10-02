import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, FindOptionsWhere } from 'typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { Requirement } from '../requirements/entities/requirement.entity';
import { Proposal } from '../proposals/entities/proposal.entity';
import { Quotation } from '../quotations/entities/quotation.entity';
import { Project } from '../projects/entities/project.entity';
import { Document } from '../documents/entities/document.entity';
import { Supplier } from '../suppliers/entities/supplier.entity';
import { Product } from '../products/entities/product.entity';
import { Solution } from '../solutions/entities/solution.entity';
import {
  PermissionService,
  CurrentUser,
  PermissionSubject,
} from '../../common/services/permission.service';

export type GlobalSearchType =
  | 'customer'
  | 'requirement'
  | 'proposal'
  | 'quotation'
  | 'project'
  | 'document'
  | 'supplier'
  | 'product'
  | 'solution';

export interface GlobalSearchHit {
  type: GlobalSearchType;
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  status?: string;
  path: string;
}

export interface GlobalSearchGroup {
  type: GlobalSearchType;
  label: string;
  total: number;
  hits: GlobalSearchHit[];
}

const TYPE_LABELS: Record<GlobalSearchType, string> = {
  customer: '客户',
  requirement: '需求',
  proposal: '方案',
  quotation: '报价',
  project: '项目',
  document: '资料',
  supplier: '供应商',
  product: '产品',
  solution: '方案模板',
};

/** 前缀过滤：`c:博亚` 只搜客户 */
const TYPE_PREFIXES: Record<string, GlobalSearchType> = {
  c: 'customer',
  r: 'requirement',
  p: 'proposal',
  q: 'quotation',
  j: 'project',
  d: 'document',
  s: 'supplier',
  m: 'product',
  t: 'solution',
};

@Injectable()
export class GlobalSearchService {
  constructor(
    @InjectRepository(Customer) private customers: Repository<Customer>,
    @InjectRepository(Requirement) private requirements: Repository<Requirement>,
    @InjectRepository(Proposal) private proposals: Repository<Proposal>,
    @InjectRepository(Quotation) private quotations: Repository<Quotation>,
    @InjectRepository(Project) private projects: Repository<Project>,
    @InjectRepository(Document) private documents: Repository<Document>,
    @InjectRepository(Supplier) private suppliers: Repository<Supplier>,
    @InjectRepository(Product) private products: Repository<Product>,
    @InjectRepository(Solution) private solutions: Repository<Solution>,
    private permission: PermissionService,
  ) {}

  /**
   * 跨模块联邦搜索。
   *
   * 每个实体独立查询后在应用层做权限过滤 —— 因为 visibility 规则
   * （department/group/role 三种作用域）无法用单条 SQL 表达。
   * 为此每类多取 3 倍再截断，避免过滤后凑不满一屏。
   */
  async search(
    rawQuery: string,
    user: CurrentUser | undefined,
    opts: { types?: GlobalSearchType[]; limit?: number } = {},
  ): Promise<{ query: string; groups: GlobalSearchGroup[]; total: number }> {
    const limit = opts.limit ?? 5;
    let query = (rawQuery || '').trim();
    let types = opts.types;

    // 解析 `c:关键词` 前缀
    const prefixMatch = /^([a-z]):\s*(.*)$/i.exec(query);
    if (prefixMatch && TYPE_PREFIXES[prefixMatch[1].toLowerCase()]) {
      types = [TYPE_PREFIXES[prefixMatch[1].toLowerCase()]];
      query = prefixMatch[2].trim();
    }

    if (query.length < 1) return { query, groups: [], total: 0 };

    const want = (t: GlobalSearchType) => !types || types.includes(t);
    const take = limit * 3;
    const like = ILike(`%${query}%`);

    const [
      customers,
      requirements,
      proposals,
      quotations,
      projects,
      documents,
      suppliers,
      products,
      solutions,
    ] = await Promise.all([
      want('customer')
        ? this.customers.find({ where: [{ name: like }, { code: like }, { industry: like }], take })
        : [],
      want('requirement')
        ? this.requirements.find({
            where: [{ title: like }, { requirementNo: like }, { description: like }],
            take,
          })
        : [],
      want('proposal')
        ? this.proposals.find({ where: [{ title: like }, { proposalNo: like }], take })
        : [],
      want('quotation') ? this.quotations.find({ where: [{ quotationNo: like }], take }) : [],
      want('project')
        ? this.projects.find({ where: [{ name: like }, { projectNo: like }], take })
        : [],
      want('document')
        ? this.documents.find({ where: [{ title: like }, { fileName: like }], take })
        : [],
      want('supplier')
        ? this.suppliers.find({ where: [{ name: like }, { code: like }], take })
        : [],
      want('product')
        ? this.products.find({ where: [{ name: like }, { code: like }, { category: like }], take })
        : [],
      want('solution')
        ? this.solutions.find({ where: [{ name: like }, { category: like }], take })
        : [],
    ]);

    const allowed = <T extends Record<string, any>>(rows: T[]): T[] =>
      rows.filter((row) =>
        this.permission.canAccess(user, {
          visibility: (row.visibility as PermissionSubject['visibility']) || 'public',
          uploaderId: row.ownerId || row.uploaderId,
          departmentId: row.departmentId,
          groupIds: row.groupIds,
          roleCodes: row.roleCodes,
        }),
      );

    const groups: GlobalSearchGroup[] = [];

    const push = (
      type: GlobalSearchType,
      rows: any[],
      map: (row: any) => Omit<GlobalSearchHit, 'type'>,
    ) => {
      const permitted = allowed(rows);
      if (permitted.length === 0) return;
      groups.push({
        type,
        label: TYPE_LABELS[type],
        total: permitted.length,
        hits: permitted.slice(0, limit).map((row) => ({ type, ...map(row) })),
      });
    };

    push('customer', customers, (c) => ({
      id: c.id,
      title: c.name,
      subtitle: [c.industry, c.scale].filter(Boolean).join(' · '),
      meta: c.code,
      status: c.status,
      path: `/customers/${c.id}`,
    }));

    push('requirement', requirements, (r) => ({
      id: r.id,
      title: r.title,
      subtitle: r.category,
      meta: r.requirementNo,
      status: r.status,
      path: `/requirements/${r.id}`,
    }));

    push('proposal', proposals, (p) => ({
      id: p.id,
      title: p.title,
      subtitle: p.proposalType,
      meta: p.proposalNo,
      status: p.status,
      path: `/proposals?highlight=${p.id}`,
    }));

    push('quotation', quotations, (q) => ({
      id: q.id,
      title: q.quotationNo,
      subtitle: q.amount != null ? `¥${Number(q.amount).toLocaleString('zh-CN')}` : undefined,
      status: q.status,
      path: `/quotations?highlight=${q.id}`,
    }));

    push('project', projects, (p) => ({
      id: p.id,
      title: p.name,
      subtitle: p.dealStage,
      meta: p.projectNo,
      status: p.status,
      path: `/projects?highlight=${p.id}`,
    }));

    push('document', documents, (d) => ({
      id: d.id,
      title: d.title,
      subtitle: d.fileName,
      meta: d.category,
      status: d.status,
      path: `/documents?highlight=${d.id}`,
    }));

    push('supplier', suppliers, (s) => ({
      id: s.id,
      title: s.name,
      subtitle: s.contactName,
      meta: s.code,
      status: s.status,
      path: `/suppliers?highlight=${s.id}`,
    }));

    push('product', products, (p) => ({
      id: p.id,
      title: p.name,
      subtitle: p.category,
      meta: p.code,
      status: p.status,
      path: `/products?highlight=${p.id}`,
    }));

    push('solution', solutions, (s) => ({
      id: s.id,
      title: s.name,
      subtitle: s.category,
      status: s.status,
      path: `/solutions?highlight=${s.id}`,
    }));

    return { query, groups, total: groups.reduce((sum, g) => sum + g.total, 0) };
  }
}
