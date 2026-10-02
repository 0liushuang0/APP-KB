import { Controller, Get, Put, Body, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  SharedFieldsService,
  type OriginEntity,
} from '../../common/services/shared-fields.service';
import {
  NumberingService,
  DEFAULT_RULES,
  type NumberedEntity,
  type NumberRule,
} from '../../common/services/numbering.service';

// 所有真正走流水编号的单据都要在这里露出，漏掉就意味着规则页改不动它：
// contract/ticket 此前缺失，页面上改前缀对合同、售后工单完全不生效。
// solution（标准方案）不走流水编号——它靠技术方案匹配定位，不靠编号，故不纳入。
const ENTITIES: NumberedEntity[] = [
  'customer',
  'requirement',
  'proposal',
  'quotation',
  'contract',
  'project',
  'supplier',
  'material',
  'ticket',
];

@ApiTags('编号规则')
@Controller('numbering')
export class NumberingController {
  constructor(
    private readonly numbering: NumberingService,
    private readonly sharedFields: SharedFieldsService,
  ) {}

  /** 当前规则 + 每类的下一个编号预览 */
  @Get()
  async get() {
    const rules = await this.numbering.getRules();
    const preview: Record<string, string> = {};
    for (const e of ENTITIES) {
      preview[e] = await this.numbering.preview(e, rules[e]);
    }
    return { rules, preview, defaults: DEFAULT_RULES };
  }

  /**
   * 改动影响范围。
   *
   * 客户与项目名称只存一份（在需求上），所以在方案里改，同一需求下的
   * 其他方案、报价会一起变。改之前得让用户知道要动几张单。
   */
  @Get('impact/:origin/:id')
  async impact(@Param('origin') origin: OriginEntity, @Param('id') id: string) {
    const requirementId = await this.sharedFields.resolveRequirementId(origin, id);
    if (!requirementId) return { requirementId: null, proposals: 0, quotations: 0 };
    return { requirementId, ...(await this.sharedFields.impactCount(requirementId)) };
  }

  /** 同一业务线上的全部单据编号，供详情页做跳转 */
  @Get('chain/:origin/:id')
  chain(@Param('origin') origin: OriginEntity, @Param('id') id: string) {
    return this.sharedFields.chain(origin, id);
  }

  @Put()
  @Roles('admin')
  async update(@Body() body: Partial<Record<NumberedEntity, NumberRule>>) {
    // 只接受已知单据类型，避免往配置里塞进无法生效的键
    const clean: Partial<Record<NumberedEntity, NumberRule>> = {};
    for (const e of ENTITIES) {
      const r = body[e];
      if (!r) continue;
      clean[e] = {
        prefix: String(r.prefix || '').trim().slice(0, 12) || DEFAULT_RULES[e].prefix,
        yearFormat: ['YYYY', 'YY', 'YYYYMM', 'YYMM', 'none'].includes(r.yearFormat) ? r.yearFormat : 'YYYY',
        digits: Math.min(8, Math.max(1, Number(r.digits) || 3)),
        separator: String(r.separator ?? '-').slice(0, 2),
      };
    }
    await this.numbering.setRules(clean);
    return this.get();
  }
}
