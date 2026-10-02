import { Controller, Post, Get, Body, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsString, IsOptional, IsArray } from 'class-validator';
import { Response } from 'express';
import { SearchService } from './search.service';
import { GlobalSearchService, GlobalSearchType } from './global-search.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/services/permission.service';

class SearchDto {
  @IsString()
  query: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sourceTypes?: string[];

  @IsOptional()
  @IsArray()
  history?: { role: 'user' | 'assistant'; content: string }[];

  /** 页面内 AI 助手送来的"用户此刻看到的内容"，用于把回答限定在本页 */
  @IsOptional()
  @IsString()
  pageContext?: string;
}

@ApiTags('全局搜索')
@Controller('search')
export class SearchController {
  constructor(
    private readonly searchService: SearchService,
    private readonly globalSearchService: GlobalSearchService,
  ) {}

  @Get('global')
  global(
    @Query('q') q: string,
    @Query('types') types: string,
    @Query('limit') limit: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.globalSearchService.search(q, user, {
      types: types ? types.split(',').filter(Boolean) as GlobalSearchType[] : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post('rag')
  search(
    @Body() dto: SearchDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.searchService.search(dto.query, dto.sourceTypes || [], user);
  }

  @Post('assistant')
  assistant(
    @Body() dto: SearchDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.searchService.chat(
      dto.query,
      dto.sourceTypes || [],
      user,
      dto.history || [],
      dto.pageContext,
    );
  }

  /**
   * 流式问答端点（SSE）。
   *
   * 响应格式：
   *   data: {"type":"sources","sources":[...]}
   *   data: {"type":"token","content":"你"}
   *   data: {"type":"token","content":"好"}
   *   data: {"type":"done"}
   */
  @Post('stream')
  async stream(
    @Body() dto: SearchDto,
    @CurrentUser() user: CurrentUserType,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    try {
      await this.searchService.chatStream(
        dto.query,
        dto.sourceTypes || [],
        user,
        dto.history || [],
        (event: any) => {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        },
        // 页面助手也走这条流式端点，pageContext 必须透传下去
        dto.pageContext,
      );
    } catch (err: any) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message || '请求失败' })}\n\n`);
    } finally {
      res.end();
    }
  }
}
