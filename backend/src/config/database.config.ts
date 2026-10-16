import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { registerAs } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';
import { User } from '../modules/users/entities/user.entity';
import { Department } from '../modules/departments/entities/department.entity';
import { UserGroup } from '../modules/user-groups/entities/user-group.entity';
import { Role } from '../modules/roles/entities/role.entity';
import { RefreshToken } from '../modules/auth/entities/refresh-token.entity';
import { Document } from '../modules/documents/entities/document.entity';
import { DocumentVersion } from '../modules/documents/entities/document-version.entity';
import { ZhDocumentImport } from '../modules/documents/entities/zh-document-import.entity';
import { ApprovalFlow } from '../modules/approvals/entities/approval-flow.entity';
import { Customer, ContactPerson, FollowUpRecord } from '../modules/customers/entities/customer.entity';
import { Proposal, ProposalVersion } from '../modules/proposals/entities/proposal.entity';
import { Quotation, QuotationItem } from '../modules/quotations/entities/quotation.entity';
import { QuotationVersion } from '../modules/quotations/entities/quotation-version.entity';
import { Product, ProductBom, ProductAttachment } from '../modules/products/entities/product.entity';
import {
  Supplier,
  SupplierCapability,
  SupplierProduct,
  SupplierQuote,
} from '../modules/suppliers/entities/supplier.entity';
import { Project, ProjectStage, ProjectRisk, ProjectTask } from '../modules/projects/entities/project.entity';
import { ProjectTimeline } from '../modules/projects/entities/project-timeline.entity';
import { DocumentLink } from '../modules/projects/entities/document-link.entity';
import { ProjectMember } from '../modules/projects/entities/project-member.entity';
import { AuditLog } from '../modules/audit-logs/entities/audit-log.entity';
import { SystemConfig } from '../modules/system-config/entities/system-config.entity';
import { ParamTemplate } from '../modules/param-templates/entities/param-template.entity';
import { Solution, ConfigOption, PriceTable } from '../modules/solutions/entities/solution.entity';
import { Material } from '../modules/materials/entities/material.entity';
import { Requirement, RequirementAttachment, RequirementLog } from '../modules/requirements/entities/requirement.entity';
import { AiCallLog } from '../modules/ai/entities/ai-call-log.entity';
import { AiFeedback } from '../modules/ai/entities/ai-feedback.entity';
import { AiBudget } from '../modules/ai/entities/ai-budget.entity';
import { PromptTemplate } from '../modules/ai/entities/prompt-template.entity';
import { CalcTemplate, CalcRecord } from '../modules/calc-tools/entities/calc.entity';
import { CalcSheet } from '../modules/calc-tools/entities/calc-sheet.entity';
import { ClientError } from '../modules/client-errors/client-error.entity';
import { Tag } from '../modules/tags/entities/tag.entity';
import { TagRelation } from '../modules/tags/entities/tag-relation.entity';
import { RecycleBinItem } from '../modules/recycle-bin/recycle-bin.entity';
import { Contract } from '../modules/contracts/entities/contract.entity';
import { ContractPayment } from '../modules/contracts/entities/contract-payment.entity';
import { Notification } from '../modules/notifications/entities/notification.entity';
import { AfterSalesTicket } from '../modules/after-sales/entities/ticket.entity';
import { WorkTask } from '../modules/work-tasks/entities/work-task.entity';

const entities = [
  User,
  Department,
  UserGroup,
  Role,
  RefreshToken,
  Document,
  DocumentVersion,
  ZhDocumentImport,
  ApprovalFlow,
  Customer,
  ContactPerson,
  FollowUpRecord,
  Proposal,
  ProposalVersion,
  Quotation,
  QuotationItem,
  QuotationVersion,
  Product,
  ProductBom,
  ProductAttachment,
  Supplier,
  SupplierCapability,
  SupplierProduct,
  SupplierQuote,
  Project,
  ProjectStage,
  ProjectRisk,
  ProjectTask,
  ProjectTimeline,
  DocumentLink,
  ProjectMember,
  AuditLog,
  SystemConfig,
  ParamTemplate,
  Solution,
  ConfigOption,
  PriceTable,
  Requirement,
  RequirementAttachment,
  RequirementLog,
  AiCallLog,
  AiFeedback,
  AiBudget,
  PromptTemplate,
  CalcTemplate,
  CalcRecord,
  CalcSheet,
  ClientError,
  Tag,
  TagRelation,
  RecycleBinItem,
  Contract,
  ContractPayment,
  Notification,
  AfterSalesTicket,
  Material,
  WorkTask,
];

export default registerAs(
  'database',
  (): TypeOrmModuleOptions => {
    const dbType = process.env.DB_TYPE || 'sqlite';

    // PostgreSQL 配置
    if (dbType === 'postgres') {
      const databaseUrl = process.env.DATABASE_URL;
      if (databaseUrl) {
        return {
          type: 'postgres',
          url: databaseUrl,
          entities,
          // 一律走迁移，禁止 synchronize 自动改表。原先只在 production 关闭，
          // 导致 staging/测试环境（NODE_ENV 非 production）一旦实体改动就被
          // TypeORM 静默改表，与迁移脱钩，可能丢列丢数据。
          synchronize: false,
          migrationsRun: true,
          logging: process.env.NODE_ENV === 'development',
          migrations: [path.join(__dirname, '/../database/migrations/*{.ts,.js}')],
          ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
        };
      }

      return {
        type: 'postgres',
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        username: process.env.DB_USERNAME || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        database: process.env.DB_NAME || 'aikb',
        entities,
        synchronize: false,
        migrationsRun: true,
        logging: process.env.NODE_ENV === 'development',
        migrations: [path.join(__dirname, '/../database/migrations/*{.ts,.js}')],
        // TLS：默认严格校验；内网自签证书场景显式设 DB_SSL_INSECURE=true
        ssl: process.env.DB_SSL === 'true'
          ? { rejectUnauthorized: process.env.DB_SSL_INSECURE !== 'true' }
          : false,
        // 连接池：默认 10 对小团队够用，50+ 并发用户可按 DB_POOL_MAX 调大
        extra: {
          max: parseInt(process.env.DB_POOL_MAX || '20', 10),
          min: parseInt(process.env.DB_POOL_MIN || '2', 10),
          idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_MS || '30000', 10),
        },
      };
    }

    /*
     * SQLite（单机个人版默认）
     *
     * 驱动从 sqljs 换成 better-sqlite3：
     *   · sqljs 把整个库读进内存、靠 autoSave 定期落盘 —— 进程崩溃就丢数据，
     *     而且没有真正的事务边界
     *   · better-sqlite3 是原生文件型驱动，支持 WAL 与真正的 ACID 事务，
     *     单机场景下比 PostgreSQL 更合适：无需额外服务进程，安装包能直接内嵌
     */
    const dataDir = path.resolve(process.cwd(), 'data');
    const dbPath = process.env.SQLITE_PATH || path.join(dataDir, 'app.db');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    return {
      type: 'better-sqlite3',
      database: dbPath,
      entities,
      // 全环境关闭自动建表，一律走迁移 —— 否则生产环境（synchronize=false）
      // 会启动成一个没有任何表的空库
      synchronize: false,
      migrationsRun: true,
      migrations: [path.join(__dirname, '/../database/migrations/*{.ts,.js}')],
      logging: process.env.DB_LOGGING === 'true' ? 'all' : ['error', 'warn'],
      /**
       * WAL 让读写不互相阻塞；foreign_keys 打开外键约束（SQLite 默认是关的）；
       * busy_timeout 避免偶发的 SQLITE_BUSY 直接失败。
       */
      prepareDatabase: (db: any) => {
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        db.pragma('busy_timeout = 5000');
        // NORMAL 在 WAL 下兼顾安全与写入速度
        db.pragma('synchronous = NORMAL');
      },
    } as unknown as TypeOrmModuleOptions;
  },
);
