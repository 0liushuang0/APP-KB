import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, Res,
  UseInterceptors, UploadedFile, ParseFilePipe, MaxFileSizeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { MAX_UPLOAD_BYTES } from '../../common/constants/upload';
import { IsString } from 'class-validator';
import { Response } from 'express';
import { ProposalsService } from './proposals.service';
import { CreateProposalDto, UpdateProposalDto, GenerateProposalDto, QueryProposalDto } from './dto/proposal.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/services/permission.service';

class RecommendDto {
  @IsString()
  requirementId: string;
}

@ApiTags('方案管理')
@Controller('proposals')
export class ProposalsController {
  constructor(private readonly proposalsService: ProposalsService) {}

  @Get()
  findAll(@Query() query: QueryProposalDto, @CurrentUser() user: CurrentUserType) {
    return this.proposalsService.findAll(query, user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.proposalsService.findOne(id, user);
  }

  @Post()
  create(@Body() dto: CreateProposalDto, @CurrentUser() user: CurrentUserType) {
    return this.proposalsService.create(dto, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProposalDto, @CurrentUser() user: CurrentUserType) {
    return this.proposalsService.update(id, dto, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.proposalsService.remove(id, user);
  }

  /**
   * 上传 Word，抽取正文与要点。
   *
   * 解析全程在本机（AI 服务用 python-docx / pypdf），文件不出内网。
   */
  @Post(':id/extract')
  @UseInterceptors(FileInterceptor('file'))
  extract(
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: MAX_UPLOAD_BYTES })],
      }),
    )
    file: Express.Multer.File,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.proposalsService.extractFromDocument(id, file, user);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.proposalsService.approve(id, user);
  }

  @Post('generate')
  generate(@Body() dto: GenerateProposalDto, @CurrentUser() user: CurrentUserType) {
    return this.proposalsService.generate(dto, user);
  }

  @Post('recommend')
  recommend(@Body() dto: RecommendDto, @CurrentUser() user: CurrentUserType) {
    return this.proposalsService.recommend(dto.requirementId, user);
  }

  @Get(':id/export')
  async exportDocx(@Param('id') id: string, @CurrentUser() user: CurrentUserType, @Res() res: Response) {
    const buffer = await this.proposalsService.exportDocx(id, user);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename=proposal-${id}.docx`);
    res.send(buffer);
  }
}
