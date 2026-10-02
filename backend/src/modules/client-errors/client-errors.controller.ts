import { Controller, Post, Get, Delete, Body, Query, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IsString, IsOptional, MaxLength } from 'class-validator';
import * as crypto from 'crypto';
import { ClientError } from './client-error.entity';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/services/permission.service';
import { PaginationQueryDto, paginate } from '../../common/dto/pagination.dto';

class ReportErrorDto {
  @IsString()
  @MaxLength(2000)
  message: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  stack?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  componentStack?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  scope?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  userAgent?: string;

  @IsOptional()
  @IsString()
  occurredAt?: string;
}

@ApiTags('前端错误')
@Controller('client-errors')
export class ClientErrorsController {
  constructor(
    @InjectRepository(ClientError) private readonly repo: Repository<ClientError>,
  ) {}

  /**
   * 接收前端上报。
   *
   * 标记 @Public：登录页或鉴权流程本身崩了时也要能报上来，
   * 否则最需要日志的场景恰好收不到。已登录时仍会记录 userId。
   * 限流由全局 ThrottlerGuard 兜底，防止被刷。
   */
  @Public()
  @Post()
  async report(@Body() dto: ReportErrorDto, @CurrentUser() user?: CurrentUserType) {
    // 同一个 bug 反复上报只累加计数，不撑爆表
    const fingerprint = crypto
      .createHash('sha1')
      .update(`${dto.scope || ''}|${dto.message}`)
      .digest('hex')
      .slice(0, 16);

    const existing = await this.repo.findOne({ where: { fingerprint } });
    if (existing) {
      await this.repo.update(existing.id, {
        occurrenceCount: existing.occurrenceCount + 1,
        lastOccurredAt: new Date(),
        // 保留最近一次的现场
        url: dto.url ?? existing.url,
        stack: dto.stack ?? existing.stack,
      });
      return { received: true, deduped: true };
    }

    await this.repo.save(
      this.repo.create({
        ...dto,
        userId: user?.userId,
        fingerprint,
        lastOccurredAt: new Date(),
      }),
    );
    return { received: true, deduped: false };
  }

  /** 查看错误日志（管理员），按最近出现时间倒序 */
  @Get()
  @Roles('admin')
  async list(@Query() query: PaginationQueryDto) {
    const qb = this.repo.createQueryBuilder('e');
    return paginate(qb, 'e', query, ['createdAt', 'occurrenceCount']);
  }

  @Delete(':id')
  @Roles('admin')
  async remove(@Param('id') id: string) {
    await this.repo.delete(id);
    return { success: true };
  }
}
