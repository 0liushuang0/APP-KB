import { Controller, Get, Query, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { AiCallLog } from './entities/ai-call-log.entity';

@ApiTags('AI调用日志')
@Controller('ai-call-logs')
export class AiCallLogController {
  constructor(
    @InjectRepository(AiCallLog)
    private logRepository: Repository<AiCallLog>,
  ) {}

  @Get()
  async findAll(@Query() query: { keyword?: string; endpoint?: string; success?: string; page?: string; limit?: string }) {
    const page = parseInt(query.page || '1', 10);
    const limit = Math.min(parseInt(query.limit || '20', 10), 100);
    const where: any = {};
    if (query.endpoint) where.endpoint = query.endpoint;
    if (query.success !== undefined) where.success = query.success === 'true';
    if (query.keyword) where.traceId = Like(`%${query.keyword}%`);

    const [items, total] = await this.logRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { items, total, page, limit };
  }

  @Get(':traceId')
  async findOne(@Param('traceId') traceId: string) {
    return this.logRepository.findOne({ where: { traceId } });
  }
}
