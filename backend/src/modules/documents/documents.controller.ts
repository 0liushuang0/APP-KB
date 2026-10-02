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
  MaxFileSizeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiConsumes, ApiBody, ApiQuery } from '@nestjs/swagger';
import { MAX_UPLOAD_BYTES } from '../../common/constants/upload';
import { DocumentsService } from './documents.service';
import {
  CreateDocumentDto,
  UpdateDocumentDto,
  QueryDocumentDto,
  RenameKnowledgeCategoryDto,
} from './dto/document.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/services/permission.service';
import { ArchiveType } from '../../common/services/file-archive.service';
import {
  DocumentLinksService,
  CreateLinkDto,
  type LinkEntityType,
} from './document-links.service';

@ApiTags('文档中心')
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly documentLinksService: DocumentLinksService,
  ) {}

  @Get()
  findAll(@Query() query: QueryDocumentDto, @CurrentUser() user: CurrentUserType) {
    return this.documentsService.findAll(query, user);
  }

  /** 客户全链路资料，按业务阶段分组 —— 「任意环节回查原始文件」的入口 */
  @Get('chain')
  chain(@Query('customerId') customerId: string, @CurrentUser() user: CurrentUserType) {
    return this.documentLinksService.customerChain(customerId, user);
  }

  /** 反查某个业务对象下的资料 */
  @Get('by-entity')
  byEntity(
    @Query('entityType') entityType: LinkEntityType,
    @Query('entityId') entityId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.documentLinksService.findByEntity(entityType, entityId, user);
  }

  /** 知识资料列表 */
  @Get('knowledge')
  findKnowledge(@CurrentUser() user: CurrentUserType) {
    return this.documentsService.findKnowledge(user);
  }

  /** 按分类统计条数：业务/客户资料页左侧导航计数用（必须声明在 :id 之前） */
  @Get('category-counts')
  categoryCounts(@Query('scope') scope: string | undefined, @CurrentUser() user: CurrentUserType) {
    return this.documentsService.categoryCounts(scope, user);
  }

  /** 知识资料上传（自动AI索引） */
  @Post('knowledge-upload')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        title: { type: 'string' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async uploadKnowledge(
    @UploadedFile(
      new ParseFilePipe({
        // 与前端限制保持一致：知识资料以文档为主
        validators: [new MaxFileSizeValidator({ maxSize: MAX_UPLOAD_BYTES })],
      }),
    )
    file: Express.Multer.File,
    @Body('title') title: string,
    @Body('subcategory') subcategory: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.documentsService.createKnowledge({ title: title || file.originalname, subcategory }, file, user);
  }

  /** 知识分类改名：级联更新已有资料的 category（只改逻辑分类，磁盘文件不动）。必须声明在 :id 路由之前 */
  @Patch('knowledge-category-rename')
  renameKnowledgeCategory(@Body() dto: RenameKnowledgeCategoryDto) {
    return this.documentsService.renameKnowledgeCategory(dto.from, dto.to);
  }

  /**
   * 批量重建知识资料索引（重新读文件解析）。必须声明在 :id 路由之前。
   *
   * 知识资料的正文不落库，所以它不能走 /ai/index/reindex 那条"从数据库重建"的路，
   * 只能重新解析文件。耗时随文件数增长，扫描件会被跳过。
   */
  @Post('knowledge-reindex')
  reindexKnowledge(
    @CurrentUser() user: CurrentUserType,
    @Query('limit') limit?: string,
    @Query('force') force?: string,
    @Query('offset') offset?: string,
  ) {
    return this.documentsService.reindexKnowledge(user, {
      limit: limit ? Math.max(1, Math.min(20, Number(limit) || 5)) : 5,
      force: force === '1',
      offset: Number(offset) || 0,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.documentsService.findOne(id, user);
  }

  /** 某份资料被关联到了哪些链路节点 */
  @Get(':id/links')
  links(@Param('id') id: string) {
    return this.documentLinksService.findByDocument(id);
  }

  @Post(':id/links')
  createLink(
    @Param('id') id: string,
    @Body() dto: CreateLinkDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.documentLinksService.create({ ...dto, documentId: id }, user);
  }

  @Delete('links/:linkId')
  removeLink(@Param('linkId') linkId: string) {
    return this.documentLinksService.remove(linkId);
  }

  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        title: { type: 'string' },
        category: { type: 'string' },
        visibility: { type: 'string' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          // 业务资料含企业宣传视频/画册等大文件（与前端预校验一致）
          new MaxFileSizeValidator({ maxSize: MAX_UPLOAD_BYTES }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Body() dto: CreateDocumentDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.documentsService.create(dto, file, user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDocumentDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.documentsService.update(id, dto, user);
  }

  /*
   * 回收站。
   *
   * 路径都是两段以上（recycle/xxx），不会被单段的 @Get(':id') / @Delete(':id')
   * 抢先匹配掉，所以放在它们后面也安全。
   */
  @Get('recycle/list')
  listRecycled() {
    return this.documentsService.listRecycled();
  }

  @Post('recycle/:recycleId/restore')
  restoreRecycled(
    @Param('recycleId') recycleId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.documentsService.restoreRecycled(recycleId, user);
  }

  /** 彻底删除（不可恢复） */
  @Delete('recycle/:recycleId')
  purgeRecycled(@Param('recycleId') recycleId: string) {
    return this.documentsService.purgeRecycled(recycleId);
  }

  /** 删除 = 移入回收站，默认保留 30 天，可还原 */
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.documentsService.remove(id, user);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.documentsService.approve(id, user);
  }

  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @Body('comment') comment: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.documentsService.reject(id, user, comment);
  }

  /** 手动触发文档AI索引（解析→分块→向量索引） */
  @Post(':id/index')
  async indexDocument(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.documentsService.indexDocument(id, user);
  }

  // ============================================================
  // 文档版本管理 API
  // ============================================================

  @Get(':id/versions')
  getVersions(@Param('id') id: string) {
    return this.documentsService.getVersions(id);
  }

  @Post(':id/versions')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        changeSummary: { type: 'string' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async createVersion(
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: MAX_UPLOAD_BYTES })],
      }),
    )
    file: Express.Multer.File,
    @Body('changeSummary') changeSummary: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.documentsService.createVersion(id, file, changeSummary, user?.userId);
  }

  @Post(':id/versions/:vid/restore')
  restoreVersion(@Param('id') id: string, @Param('vid') vid: string, @CurrentUser() user: CurrentUserType) {
    return this.documentsService.restoreVersion(id, vid, user?.userId);
  }

  // ============================================================
  // 客户文件归档 API
  // ============================================================

  @Post(':id/archive/:customerId')
  @ApiQuery({ name: 'type', enum: ArchiveType, required: false })
  archiveToCustomer(
    @Param('id') id: string,
    @Param('customerId') customerId: string,
    @Query('type') archiveType: ArchiveType = ArchiveType.RAW,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.documentsService.archiveToCustomer(id, customerId, archiveType, user);
  }

  @Get('customer/:customerId/archives')
  @ApiQuery({ name: 'type', enum: ArchiveType, required: false })
  getCustomerArchives(
    @Param('customerId') customerId: string,
    @Query('type') archiveType?: ArchiveType,
  ) {
    return this.documentsService.getCustomerArchives(customerId, archiveType);
  }

  @Delete(':id/archive/:customerId')
  removeFromCustomerArchive(
    @Param('id') id: string,
    @Param('customerId') customerId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.documentsService.removeFromCustomerArchive(id, customerId, user);
  }
}
