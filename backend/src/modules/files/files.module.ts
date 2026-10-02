import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FilesController } from './files.controller';
import { Document } from '../documents/entities/document.entity';
import { RequirementAttachment, Requirement } from '../requirements/entities/requirement.entity';
import { ProductAttachment, Product } from '../products/entities/product.entity';
import { PermissionService } from '../../common/services/permission.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Document,
      RequirementAttachment,
      Requirement,
      ProductAttachment,
      Product,
    ]),
  ],
  controllers: [FilesController],
  providers: [PermissionService],
})
export class FilesModule {}
