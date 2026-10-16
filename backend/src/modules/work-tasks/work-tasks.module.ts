import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkTask } from './entities/work-task.entity';
import { WorkTasksService } from './work-tasks.service';
import { WorkTasksController } from './work-tasks.controller';
import { PermissionQueryService } from '../../common/services/permission-query.service';
import { PermissionService } from '../../common/services/permission.service';
import { NumberingService } from '../../common/services/numbering.service';

@Module({
  imports: [TypeOrmModule.forFeature([WorkTask])],
  controllers: [WorkTasksController],
  providers: [WorkTasksService, PermissionQueryService, PermissionService, NumberingService],
  exports: [WorkTasksService],
})
export class WorkTasksModule {}
