import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiCallLog } from './entities/ai-call-log.entity';
import { AiFeedback } from './entities/ai-feedback.entity';
import { PromptTemplate } from './entities/prompt-template.entity';
import { AiBudget } from './entities/ai-budget.entity';
import { AiCallLogController } from './ai-call-log.controller';
import { AiConfigController } from './ai-config.controller';
import { AiFeedbackController } from './ai-feedback.controller';
import { AiBudgetController } from './ai-budget.controller';
import { MatchingController } from './matching.controller';
import { PromptTemplateController } from './prompt-template.controller';
import { AiService } from '../../common/services/ai.service';
import { KnowledgeSyncService } from '../../common/services/knowledge-sync.service';
import { PromptTemplateService } from './prompt-template.service';
import { AiBudgetService } from './ai-budget.service';
import { SystemConfigModule } from '../system-config/system-config.module';
import { ReindexController } from './reindex.controller';
import { ReindexService } from './reindex.service';
import { IndexSelfHealService } from './index-self-heal.service';
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

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AiCallLog,
      AiFeedback,
      PromptTemplate,
      AiBudget,
      // 索引重建要读全部业务表
      Customer,
      Requirement,
      Proposal,
      Quotation,
      Contract,
      Project,
      Product,
      Supplier,
      AfterSalesTicket,
      Solution,
      Document,
    ]),
    SystemConfigModule,
  ],
  controllers: [AiCallLogController, AiConfigController, AiFeedbackController, AiBudgetController, MatchingController, PromptTemplateController, ReindexController],
  providers: [AiService, KnowledgeSyncService, PromptTemplateService, AiBudgetService, ReindexService, IndexSelfHealService],
  exports: [TypeOrmModule, PromptTemplateService, ReindexService],
})
export class AiModule {}
