import { Body, Controller, Get, Post, BadRequestException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { ReindexService, REINDEXABLE_TYPES } from './reindex.service';

class ReindexDto {
  /** 要重建的类型；留空 = 全部 */
  types?: string[];
}

/**
 * 向量索引的健康度与重建。
 *
 * 只开放给管理员：重建会先清空再全量写入，期间检索结果会短暂不完整。
 */
@ApiTags('AI 索引')
@Controller('ai/index')
export class ReindexController {
  constructor(private readonly reindex: ReindexService) {}

  /** 各类型「库里有多少 / 已索引多少」，用于设置页的索引健康度面板 */
  @Get('health')
  health() {
    return this.reindex.getHealth();
  }

  @Get('last-result')
  @Roles('admin')
  lastResult() {
    return this.reindex.getLastResult();
  }

  /**
   * 触发重建。
   *
   * 同步等待完成：本机数据量在千级，实测全量重建几十秒内结束，
   * 直接等比丢进队列再轮询要简单得多，前端也能立刻拿到每类写入条数。
   */
  @Post('reindex')
  @Roles('admin')
  async run(@Body() dto: ReindexDto) {
    const types = dto?.types;
    if (types?.length) {
      const unknown = types.filter((t) => !(REINDEXABLE_TYPES as readonly string[]).includes(t));
      if (unknown.length) throw new BadRequestException(`不支持重建的类型：${unknown.join('、')}`);
    }
    try {
      const result = await this.reindex.reindex(types);
      return { result };
    } catch (err) {
      throw new BadRequestException((err as Error)?.message || '重建失败');
    }
  }
}
