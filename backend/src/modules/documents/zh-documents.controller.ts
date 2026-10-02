import {
  Body, CanActivate, Controller, ExecutionContext, Get, Injectable, Put,
  Res, ServiceUnavailableException, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { Response } from 'express';
import { DataSource } from 'typeorm';
import { Public } from '../../common/decorators/public.decorator';
import { ZhDocumentsService } from './zh-documents.service';
import { ZhDocumentBatchDto } from './zh-document.dto';

@Injectable()
export class ZhServiceTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.ZH_SERVICE_TOKEN || '';
    if (!expected) throw new ServiceUnavailableException('知识库未配置平台服务令牌');
    const request = context.switchToHttp().getRequest();
    const supplied = String(request.headers['x-zh-service-token'] ??
      String(request.headers.authorization || '').replace(/^Bearer /, ''));
    const actual = Buffer.from(supplied);
    const configured = Buffer.from(expected);
    if (actual.length !== configured.length || !timingSafeEqual(actual, configured)) {
      throw new UnauthorizedException('平台服务令牌无效');
    }
    return true;
  }
}

@Public()
@Controller('zh/v1')
export class ZhDocumentsController {
  constructor(private readonly documents: ZhDocumentsService) {}

  @Put('documents')
  @UseGuards(ZhServiceTokenGuard)
  async importDocuments(@Body() input: ZhDocumentBatchDto, @Res() response: Response) {
    // The platform contract uses an unwrapped {results}, unlike interactive APIs.
    response.json(await this.documents.importItems(input.items));
  }
}

@Controller('health')
export class ZhKnowledgeHealthController {
  constructor(private readonly database: DataSource) {}

  @Public()
  @Get()
  async health() {
    if (!this.database.isInitialized) throw new ServiceUnavailableException('知识库数据库未就绪');
    await this.database.query('SELECT 1');
    return { status: 'ok', database: 'ready' };
  }
}
