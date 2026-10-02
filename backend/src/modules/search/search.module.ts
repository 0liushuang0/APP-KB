import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { SearchPermissionService } from './search-permission.service';
import { GlobalSearchService } from './global-search.service';
import { PromptGuardService } from './prompt-guard.service';
import { AiService } from '../../common/services/ai.service';
import { PermissionService } from '../../common/services/permission.service';
import { Customer } from '../customers/entities/customer.entity';
import { Requirement } from '../requirements/entities/requirement.entity';
import { Proposal } from '../proposals/entities/proposal.entity';
import { Quotation } from '../quotations/entities/quotation.entity';
import { Project } from '../projects/entities/project.entity';
import { Document } from '../documents/entities/document.entity';
import { Supplier } from '../suppliers/entities/supplier.entity';
import { Product } from '../products/entities/product.entity';
import { Solution } from '../solutions/entities/solution.entity';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      Customer,
      Requirement,
      Proposal,
      Quotation,
      Project,
      Document,
      Supplier,
      Product,
      Solution,
    ]),
  ],
  controllers: [SearchController],
  providers: [
    SearchService,
    SearchPermissionService,
    GlobalSearchService,
    PromptGuardService,
    AiService,
    PermissionService,
  ],
})
export class SearchModule {}
