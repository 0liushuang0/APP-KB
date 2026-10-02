import { BadRequestException } from '@nestjs/common';
import { CalcToolsService } from './calc-tools.service';
import type { CalcSchema } from './entities/calc.entity';

/**
 * schema 校验与试算。
 *
 * 这两条路都不碰仓储，所以直接拿 null 当 repository 构造服务即可 ——
 * 起一套真库跑 30 秒，而这里要覆盖的全是纯逻辑分支。
 */
function svc(): CalcToolsService {
  return new CalcToolsService(null as any, null as any, null as any);
}

const ok: CalcSchema = {
  inputs: [
    { key: 'width', label: '带钢宽度', type: 'number', unit: 'mm', min: 100, max: 2500, required: true },
    { key: 'thickness', label: '带钢厚度', type: 'number', unit: 'mm', min: 0.5, max: 25, required: true },
  ],
  formulas: [
    { key: 'area', label: '断面积', expr: 'width * thickness', unit: 'mm2' },
    { key: 'force', label: '所需力', expr: 'area * 0.35', unit: 'kN', digits: 1 },
  ],
  outputs: ['force'],
};

const errorsOf = (schema: any) =>
  svc()
    .validateSchema(schema)
    .filter((p) => p.level === 'error');

describe('CalcToolsService.validateSchema', () => {
  it('合法 schema 无错误', () => {
    expect(errorsOf(ok)).toHaveLength(0);
  });

  it('缺输入项或缺公式都要报错', () => {
    expect(errorsOf({ inputs: [], formulas: [] }).map((p) => p.message)).toEqual(
      expect.arrayContaining(['至少需要一个输入项', '至少需要一条公式']),
    );
  });

  it('变量名非法时定位到具体那一行', () => {
    const bad = { ...ok, inputs: [{ ...ok.inputs[0], key: '2width' }, ok.inputs[1]] };
    const errs = errorsOf(bad);
    expect(errs.some((e) => e.at === 'inputs[0]' && /只能用字母/.test(e.message))).toBe(true);
  });

  it('输入项与公式重名要拦下', () => {
    const bad: CalcSchema = {
      ...ok,
      formulas: [{ key: 'width', label: '重名', expr: 'width * 2' }],
      outputs: [],
    };
    expect(errorsOf(bad).some((e) => /重复/.test(e.message))).toBe(true);
  });

  it('公式引用了不存在的变量时报错', () => {
    const bad: CalcSchema = {
      ...ok,
      formulas: [{ key: 'x', label: '未知量', expr: 'width * speed' }],
      outputs: [],
    };
    expect(errorsOf(bad).some((e) => e.at === 'formulas[0]')).toBe(true);
  });

  it('公式只能引用前面的公式，不能引用后面的', () => {
    const bad: CalcSchema = {
      ...ok,
      // force 在前却引用了后面才定义的 area
      formulas: [
        { key: 'force', label: '所需力', expr: 'area * 0.35' },
        { key: 'area', label: '断面积', expr: 'width * thickness' },
      ],
      outputs: ['force'],
    };
    expect(errorsOf(bad).some((e) => e.at === 'formulas[0]')).toBe(true);
    // 反过来（正确顺序）不该报错
    expect(errorsOf(ok)).toHaveLength(0);
  });

  it('下限大于上限要报错', () => {
    const bad = { ...ok, inputs: [{ ...ok.inputs[0], min: 900, max: 100 }, ok.inputs[1]] };
    expect(errorsOf(bad).some((e) => /下限大于上限/.test(e.message))).toBe(true);
  });

  it('输出项指向不存在的公式要报错', () => {
    expect(errorsOf({ ...ok, outputs: ['nope'] }).some((e) => e.at === 'outputs')).toBe(true);
  });

  it('没勾输出项只给提醒，不算错误', () => {
    const problems = svc().validateSchema({ ...ok, outputs: [] });
    expect(problems.filter((p) => p.level === 'error')).toHaveLength(0);
    expect(problems.some((p) => p.level === 'warn' && p.at === 'outputs')).toBe(true);
  });

  it('缺显示名称要报错', () => {
    const bad = { ...ok, inputs: [{ ...ok.inputs[0], label: '' }, ok.inputs[1]] };
    expect(errorsOf(bad).some((e) => /缺少显示名称/.test(e.message))).toBe(true);
  });
});

describe('upsertTemplate 的草稿路径', () => {
  /** 只有 upsert 会碰仓储，给一对最小替身即可 */
  function svcWithRepo() {
    const saved: any[] = [];
    const templates = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((x: any) => x),
      save: jest.fn(async (x: any) => {
        saved.push(x);
        return x;
      }),
    };
    return { service: new CalcToolsService(templates as any, null as any, null as any), saved, templates };
  }

  it('草稿允许没有输入项和公式', async () => {
    const { service, saved } = svcWithRepo();
    await service.upsertTemplate({
      code: 'leveler_force',
      name: '矫直力计算',
      schema: { inputs: [], formulas: [] },
      status: 'draft',
    } as any);
    expect(saved[0].status).toBe('draft');
    expect(JSON.parse(saved[0].schema)).toEqual({ inputs: [], formulas: [] });
  });

  it('草稿连 schema 都不传也能存', async () => {
    const { service, saved } = svcWithRepo();
    await service.upsertTemplate({ code: 'wip', name: '待定', status: 'draft' } as any);
    expect(JSON.parse(saved[0].schema)).toEqual({ inputs: [], formulas: [] });
  });

  it('正式启用时仍然要求公式完整', async () => {
    const { service } = svcWithRepo();
    await expect(
      service.upsertTemplate({ code: 'x', name: 'X', schema: { inputs: [], formulas: [] } } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('不传 status 时默认启用', async () => {
    const { service, saved } = svcWithRepo();
    await service.upsertTemplate({ code: 'ok_tool', name: '正常', schema: ok } as any);
    expect(saved[0].status).toBe('active');
  });

  it('草稿配全后保存，状态自动转为启用', async () => {
    const { service, saved, templates } = svcWithRepo();
    templates.findOne.mockResolvedValue({
      code: 'leveler_force',
      status: 'draft',
      version: 1,
      schema: '{"inputs":[],"formulas":[]}',
    });
    await service.upsertTemplate({ code: 'leveler_force', name: '矫直力计算', schema: ok } as any);
    expect(saved[0].status).toBe('active');
    // 草稿阶段的改动不算版本变更
    expect(saved[0].version).toBe(1);
  });

  it('已启用的模板改公式才升版本', async () => {
    const { service, saved, templates } = svcWithRepo();
    templates.findOne.mockResolvedValue({
      code: 'ok_tool',
      status: 'active',
      version: 3,
      schema: '{"inputs":[],"formulas":[]}',
    });
    await service.upsertTemplate({ code: 'ok_tool', name: '正常', schema: ok } as any);
    expect(saved[0].version).toBe(4);
  });

  it('编码非法或缺名称都拦下，草稿也不例外', async () => {
    const { service } = svcWithRepo();
    await expect(
      service.upsertTemplate({ code: '2bad', name: 'X', status: 'draft' } as any),
    ).rejects.toThrow(/模板编码/);
    await expect(
      service.upsertTemplate({ code: 'good', name: '  ', status: 'draft' } as any),
    ).rejects.toThrow(/工具名称/);
  });
});

describe('CalcToolsService.tryCalculate', () => {
  it('按 schema 算出结果并标出输出项', () => {
    const r = svc().tryCalculate(ok, { width: 1000, thickness: 2 });
    expect(r.results.find((x) => x.key === 'area')!.value).toBe(2000);
    expect(r.results.find((x) => x.key === 'force')!.value).toBe(700);
    expect(r.results.find((x) => x.key === 'force')!.isOutput).toBe(true);
    // area 没在 outputs 里，是中间量
    expect(r.results.find((x) => x.key === 'area')!.isOutput).toBe(false);
  });

  it('schema 本身有错时先拦下，不去跑公式', () => {
    expect(() => svc().tryCalculate({ ...ok, outputs: ['nope'] }, {})).toThrow(BadRequestException);
  });

  it('超出量程的输入拦在求值之前', () => {
    expect(() => svc().tryCalculate(ok, { width: 9999, thickness: 2 })).toThrow(/不应大于/);
  });

  it('缺必填项时报出具体是哪一项', () => {
    expect(() => svc().tryCalculate(ok, { width: 1000 })).toThrow(/带钢厚度/);
  });

  it('告警区间生效', () => {
    const schema: CalcSchema = {
      inputs: [{ key: 'a', label: 'A', type: 'number', required: true }],
      formulas: [{ key: 'b', label: 'B', expr: 'a * 2', warnAbove: 10 }],
      outputs: ['b'],
    };
    expect(svc().tryCalculate(schema, { a: 10 }).results[0].warn).toBe('above');
    expect(svc().tryCalculate(schema, { a: 1 }).results[0].warn).toBeUndefined();
  });

  it('digits 控制保留位数', () => {
    const schema: CalcSchema = {
      inputs: [{ key: 'a', label: 'A', type: 'number', required: true }],
      formulas: [{ key: 'b', label: 'B', expr: 'a / 3', digits: 3 }],
      outputs: ['b'],
    };
    expect(svc().tryCalculate(schema, { a: 1 }).results[0].value).toBe(0.333);
  });
});
