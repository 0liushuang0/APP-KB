import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WorkTasksService } from './work-tasks.service';
import { CreateWorkTaskDto, UpdateWorkTaskDto, QueryWorkTaskDto } from './dto/work-task.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/services/permission.service';

@ApiTags('工作任务')
@Controller('work-tasks')
export class WorkTasksController {
  constructor(private readonly workTasksService: WorkTasksService) {}

  @Get()
  findAll(@Query() query: QueryWorkTaskDto, @CurrentUser() user: CurrentUserType) {
    return this.workTasksService.findAll(query, user);
  }

  @Get('my-open-count')
  myOpenCount(@CurrentUser() user: CurrentUserType) {
    return this.workTasksService.myOpenCount(user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.workTasksService.findOne(id, user);
  }

  @Post()
  create(@Body() dto: CreateWorkTaskDto, @CurrentUser() user: CurrentUserType) {
    return this.workTasksService.create(dto, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateWorkTaskDto, @CurrentUser() user: CurrentUserType) {
    return this.workTasksService.update(id, dto, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.workTasksService.remove(id, user);
  }
}
