import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateRequirementDto } from '../../modules/requirements/dto/requirement.dto';
import { CreateProjectDto } from '../../modules/projects/dto/project.dto';

/**
 * 守卫：日期字段对空串的容错 + 创建类 DTO 拒收 status。
 *
 * 两类历史 bug 的固化：
 *   · 日期空串 —— 前端表单没填日期会发 ""，PG date 列/IsDateString 会拦成
 *     400「日期格式不正确」（2026-10-15 项目页实发：不填日期新建项目直接失败）。
 *     修法是 DTO 层 Transform 空串→undefined，本测试守住它不回退。
 *   · create 带 status —— 初始状态由服务端按审批开关决定，前端误带 status
 *     会被 forbidNonWhitelisted 拒成「状态不是可提交的字段」（需求页实发过）。
 *     Update 允许 status、Create 不允许，本测试锁定这个边界。
 */

const pipe = { whitelist: true, forbidNonWhitelisted: true } as const;
const errorsOf = (cls: any, body: any) =>
  validateSync(plainToInstance(cls, body), pipe as any).map((e: any) =>
    `[${e.property}] ` + Object.values(e.constraints || {}).join('; '),
  );

describe('守卫：日期字段空串容错（DTO 层 Transform 不回退）', () => {
  it('需求 - requirementDate 空串按未填通过', () => {
    const errs = errorsOf(CreateRequirementDto, { title: 'X', requirementDate: '' });
    expect(errs.join()).not.toContain('requirementDate');
  });

  it('需求 - requirementDate 合法日期通过', () => {
    const errs = errorsOf(CreateRequirementDto, { title: 'X', requirementDate: '2026-10-01' });
    expect(errs.join()).not.toContain('requirementDate');
  });

  it.each(['startDate', 'endDate'])('项目 - %s 空串按未填通过（不填日期新建项目不能失败）', (f) => {
    const errs = errorsOf(CreateProjectDto, { name: 'X', [f]: '' });
    expect(errs.join()).not.toContain(f);
  });

  it('项目 - 阶段日期空串同规则', () => {
    // stages 嵌套校验未开启 ValidateNested 时只测主字段；开启后此处应扩展
    const errs = errorsOf(CreateProjectDto, { name: 'X', stages: [{ name: '阶段', startDate: '' }] });
    expect(errs.join()).not.toContain('startDate must be a valid');
  });
});

describe('守卫：创建类 DTO 不收 status（初始状态由服务端决定）', () => {
  it('创建需求带 status 被拒（forbidNonWhitelisted 口径）', () => {
    const errs = errorsOf(CreateRequirementDto, { title: 'X', status: 'approved' });
    expect(errs.join()).toContain('status');
  });

  it('创建项目带 status 被拒', () => {
    const errs = errorsOf(CreateProjectDto, { name: 'X', status: 'approved' });
    expect(errs.join()).toContain('status');
  });
});
