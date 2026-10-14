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
    // 后端构建时间 = dist 里 main.js 的修改时间：前端拿它与自己的构建时间比对，
    // 提示"代码已更新请刷新"——之前多次出现"修复已编译但浏览器还是旧的"反复报错
    let buildTime: string | null = null;
    try {
      const fs = await import('fs');
      const path = await import('path');
      // __dirname 是 dist/src/modules/documents/，入口在 dist/src/main.js
      buildTime = fs.statSync(path.resolve(__dirname, '..', '..', 'main.js')).mtime.toISOString();
    } catch {
      /* 取不到就报 null，不阻塞健康检查 */
    }
    return { status: 'ok', database: 'ready', buildTime };
  }
}
