import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Solution, ConfigOption, PriceTable } from './entities/solution.entity';
import { Product } from '../products/entities/product.entity';
import { SolutionsService } from './solutions.service';
import { SolutionsController } from './solutions.controller';
import { AiService } from '../../common/services/ai.service';
import { TransactionService } from '../../common/services/transaction.service';
import { KnowledgeSyncService } from '../../common/services/knowledge-sync.service';

@Module({
  imports: [TypeOrmModule.forFeature([Solution, ConfigOption, PriceTable, Product])],
  controllers: [SolutionsController],
  providers: [SolutionsService, AiService, TransactionService, KnowledgeSyncService],
  exports: [SolutionsService],
})
export class SolutionsModule {}
