import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Supplier,
  SupplierCapability,
  SupplierProduct,
  SupplierQuote,
} from './entities/supplier.entity';
import { SuppliersService } from './suppliers.service';
import { SupplierProductsService } from './supplier-products.service';
import { SuppliersController, SupplierProductsController } from './suppliers.controller';
import { AiService } from '../../common/services/ai.service';
import { TransactionService } from '../../common/services/transaction.service';
import { PermissionService } from '../../common/services/permission.service';
import { PermissionQueryService } from '../../common/services/permission-query.service';
import { KnowledgeSyncService } from '../../common/services/knowledge-sync.service';
import { ApprovalsModule } from '../approvals/approvals.module';
import { MaterialsModule } from '../materials/materials.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Supplier, SupplierCapability, SupplierProduct, SupplierQuote]),
    ApprovalsModule,
    MaterialsModule,
  ],
  controllers: [SuppliersController, SupplierProductsController],
  providers: [PermissionQueryService, TransactionService, 
    SuppliersService,
    SupplierProductsService,
    AiService,
    PermissionService,
    KnowledgeSyncService,
  ],
  exports: [SuppliersService, SupplierProductsService],
})
export class SuppliersModule {}
