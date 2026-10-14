import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product, ProductBom, ProductAttachment } from './entities/product.entity';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { ProductCompletenessController } from './product-completeness.controller';
import { ProductCompletenessService } from './product-completeness.service';
import { AiService } from '../../common/services/ai.service';
import { TransactionService } from '../../common/services/transaction.service';
import { PermissionService } from '../../common/services/permission.service';
import { PermissionQueryService } from '../../common/services/permission-query.service';
import { KnowledgeSyncService } from '../../common/services/knowledge-sync.service';
import { ApprovalsModule } from '../approvals/approvals.module';

@Module({
  imports: [TypeOrmModule.forFeature([Product, ProductBom, ProductAttachment]), ApprovalsModule],
  controllers: [ProductsController, ProductCompletenessController],
  providers: [PermissionQueryService, TransactionService, ProductsService, ProductCompletenessService, AiService, PermissionService, KnowledgeSyncService],
  exports: [ProductsService],
})
export class ProductsModule {}
