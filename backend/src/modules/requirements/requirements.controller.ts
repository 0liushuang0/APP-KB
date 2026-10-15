import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UploadedFile,
  UseInterceptors,
  ParseFilePipe,
  Res,
  MaxFileSizeValidator,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { MAX_UPLOAD_BYTES } from '../../common/constants/upload';
import { RequirementPdfService } from './requirement-pdf.service';
import { RequirementsService } from './requirements.service';
import {
  CreateRequirementDto,
  UpdateRequirementDto,
  QueryRequirementDto,
  CreateRequirementVersionDto,
  AddRequirementLogDto,
} from './dto/requirement.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/services/permission.service';

@ApiTags('需求管理')
@Controller('requirements')
export class RequirementsController {
  constructor(private readonly requirementsService: RequirementsService,
    private readonly pdfService: RequirementPdfService,
  ) {}

  @Get()
  findAll(@Query() query: QueryRequirementDto, @CurrentUser() user: CurrentUserType) {
    return this.requirementsService.findAll(query, user);
  }

  /**
   * 方案匹配解释：需求详情页「关联方案」页签里，对某条相似方案点「AI 分析」，
   * 返回 3 条推荐亮点 + 3 条风险关注点。
   */
  @Post(':id/match-explanation')
  explainMatch(
    @Param('id') id: string,
    @Body() body: { targetType: 'proposal' | 'solution'; targetId: string },
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.requirementsService.explainMatch(id, user, body?.targetType, body?.targetId);
  }

  /** 同类产品历史报价（新建需求时给预计金额作参考，只提示不自动填） */
  @Get('amount-reference')
  amountReference(@Query('category') category: string) {
    return this.requirementsService.amountReference(category);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.requirementsService.findOne(id, user);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.requirementsService.approve(id, user);
  }

  @Post()
  create(@Body() dto: CreateRequirementDto, @CurrentUser() user: CurrentUserType) {
    return this.requirementsService.create(dto, user);
  }
  /** 导出预览：返回与 PDF/DOCX 同一份内容的数据，前端渲染成可改值的预览，确认后再导出 */
  @Get(':id/identification-preview')
  identificationPreview(@Param('id') id: string) {
    return this.pdfService.loadPreview(id);
  }

  /** 导出需求识别确认单（PDF），发客户核对用 */
  @Get(':id/identification-pdf')
  async identificationPdf(@Param('id') id: string, @Res() res: Response) {
    const { buffer, fileName } = await this.pdfService.generate(id);
    /*
     * 直接写 response，不用 StreamableFile ——
     * 全局的 TransformInterceptor 会把返回值统一包成 { success, data }，
     * StreamableFile 被它序列化成一坨 JSON，下载下来根本不是 PDF。
     */
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(fileName)}"`,
    );
    res.end(buffer);
  }

  /** 同一份内容的 Word 版，客户要改直接在 Word 上改 */
  @Get(':id/identification-docx')
  async identificationDocx(@Param('id') id: string, @Res() res: Response) {
    const { buffer, fileName } = await this.pdfService.generateDocx(id);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(fileName)}"`,
    );
    res.end(buffer);
  }


  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRequirementDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.requirementsService.update(id, dto, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.requirementsService.remove(id, user);
  }

  /** 删除预检：返回该需求关联的客户/资料/下游，前端据此弹联动告警 */
  @Get(':id/remove-preview')
  removePreview(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.requirementsService.removePreview(id, user);
  }

  @Post(':id/upload')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: MAX_UPLOAD_BYTES })],
      }),
    )
    file: Express.Multer.File,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.requirementsService.uploadAttachment(id, file, user);
  }

  @Delete(':id/attachments/:aid')
  removeAttachment(
    @Param('id') id: string,
    @Param('aid') aid: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.requirementsService.removeAttachment(id, aid, user);
  }

  @Post(':id/analyze')
  analyze(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.requirementsService.analyze(id, user);
  }

  @Post(':id/analyze-structured')
  analyzeStructured(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.requirementsService.analyzeStructured(id, user);
  }

  /** 确认自动识别的参数（去掉「待确认」） */
  @Post(':id/confirm-spec')
  confirmSpec(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.requirementsService.confirmSpec(id, user);
  }

  @Patch(':id/spec')
  updateSpec(
    @Param('id') id: string,
    @Body('spec') spec: any,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.requirementsService.updateSpec(id, spec, user);
  }

  @Post(':id/followup-draft')
  followupDraft(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.requirementsService.followupDraft(id, user);
  }

  @Get(':id/versions')
  versions(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.requirementsService.listVersions(id, user);
  }

  /** 需求变更：创建新版本，旧版本保留为历史（已由「需求记录」取代，接口暂留兼容旧数据） */
  @Post(':id/versions')
  createVersion(
    @Param('id') id: string,
    @Body() dto: CreateRequirementVersionDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.requirementsService.createVersion(id, dto, user);
  }

  /** 需求记录：同一条需求下的沟通/变更/确认记录 */
  @Get(':id/logs')
  logs(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.requirementsService.listLogs(id, user);
  }

  @Post(':id/logs')
  addLog(
    @Param('id') id: string,
    @Body() dto: AddRequirementLogDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.requirementsService.addLog(id, dto, user);
  }
}
