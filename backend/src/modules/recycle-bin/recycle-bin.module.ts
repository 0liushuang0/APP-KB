import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecycleBinItem } from './recycle-bin.entity';
import { RecycleBinService } from './recycle-bin.service';
import { RecycleBinController } from './recycle-bin.controller';
import { BusinessTrashService } from './business-trash.service';

@Module({
  imports: [TypeOrmModule.forFeature([RecycleBinItem])],
  controllers: [RecycleBinController],
  providers: [RecycleBinService, BusinessTrashService],
  exports: [RecycleBinService, BusinessTrashService],
})
export class RecycleBinModule {}
