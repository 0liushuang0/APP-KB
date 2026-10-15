import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { ProjectWorkflowService } from './project-workflow.service';
import { CreateProjectDto, UpdateProjectDto, QueryProjectDto } from './dto/project.dto';
import { CreateProjectTaskDto, UpdateProjectTaskDto } from './dto/task.dto';
import { AddProjectMemberDto, UpdateProjectMemberDto } from './dto/project-member.dto';
import { DealStage } from './entities/project.entity';
import { DocStage, DocCategory } from './entities/document-link.entity';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/services/permission.service';

@ApiTags('项目管理')
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly workflowService: ProjectWorkflowService,
  ) {}

  @Get()
  findAll(@Query() query: QueryProjectDto, @CurrentUser() user: CurrentUserType) {
    return this.projectsService.findAll(query, user);
  }

  /** 合同 → 项目草稿：开工/完工日期、项目类型、按标准模板切好的阶段 */
  @Get('draft-from-contract/:contractId')
  draftFromContract(@Param('contractId') contractId: string) {
    return this.projectsService.draftFromContract(contractId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.projectsService.findOne(id, user);
  }

  @Get(':id/detail')
  getDetail(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.workflowService.getProjectDetail(id, user);
  }

  @Get(':id/timeline')
  getTimeline(@Param('id') id: string) {
    return this.workflowService.getTimeline(id);
  }

  @Get(':id/documents')
  getDocuments(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.workflowService.getProjectDocuments(id, user);
  }

  @Get('documents/customer/:customerId')
  getCustomerDocuments(
    @Param('customerId') customerId: string,
    @CurrentUser() user: CurrentUserType,
    @Query('stage') stage?: DocStage,
  ) {
    return this.workflowService.getCustomerDocuments(customerId, user, stage);
  }

  @Post()
  create(@Body() dto: CreateProjectDto, @CurrentUser() user: CurrentUserType) {
    return this.projectsService.create(dto, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProjectDto, @CurrentUser() user: CurrentUserType) {
    return this.projectsService.update(id, dto, user);
  }

  /**
   * 项目结项报告：汇总项目全链路数据（需求→方案→报价→合同→回款→任务→风险），
   * 生成结构化 JSON 供前端渲染/导出。
   */
  @Get(':id/completion-report')
  getCompletionReport(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.projectsService.generateCompletionReport(id, user);
  }

  @Patch(':id/stage')
  updateStage(
    @Param('id') id: string,
    @Body('stage') stage: DealStage,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.workflowService.updateDealStage(id, stage, user);
  }

  @Post('documents/link')
  linkDocument(
    @Body() dto: {
      documentId: string;
      projectId?: string;
      customerId?: string;
      requirementId?: string;
      stage: DocStage;
      category: DocCategory;
      description?: string;
    },
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.workflowService.linkDocument(dto, user);
  }

  @Delete('documents/:linkId')
  unlinkDocument(@Param('linkId') linkId: string) {
    return this.workflowService.unlinkDocument(linkId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.projectsService.remove(id, user);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.projectsService.approve(id, user);
  }

  // ── 任务管理 ──
  // 任务以所属项目为权限主体：能看项目才能看任务，能管项目才能增删改任务。
  // 之前这组接口不接收当前用户，任何登录用户都能操作任意项目的任务。

  @Get(':id/tasks')
  findTasks(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.projectsService.findTasks(id, user);
  }

  @Post(':id/tasks')
  createTask(
    @Param('id') id: string,
    @Body() dto: CreateProjectTaskDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.projectsService.createTask(id, dto, user);
  }

  @Patch(':id/tasks/:taskId')
  updateTask(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Body() dto: UpdateProjectTaskDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.projectsService.updateTask(id, taskId, dto, user);
  }

  @Delete(':id/tasks/:taskId')
  removeTask(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.projectsService.removeTask(id, taskId, user);
  }

  // ── 项目成员：明确的协作授权（谁能参与、什么角色） ──

  @Get(':id/members')
  listMembers(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.projectsService.listMembers(id, user);
  }

  @Post(':id/members')
  addMember(
    @Param('id') id: string,
    @Body() dto: AddProjectMemberDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.projectsService.addMember(id, dto, user);
  }

  @Patch(':id/members/:userId')
  updateMemberRole(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateProjectMemberDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.projectsService.updateMemberRole(id, userId, dto, user);
  }

  @Delete(':id/members/:userId')
  removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.projectsService.removeMember(id, userId, user);
  }
}
