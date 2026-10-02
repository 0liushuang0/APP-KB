import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { ParamTemplate } from './entities/param-template.entity';
import {
  CreateParamTemplateDto,
  UpdateParamTemplateDto,
} from './dto/param-template.dto';

@Injectable()
export class ParamTemplatesService {
  constructor(
    @InjectRepository(ParamTemplate)
    private paramTemplateRepository: Repository<ParamTemplate>,
  ) {}

  async findAll(): Promise<ParamTemplate[]> {
    return this.paramTemplateRepository.find({ order: { category: 'ASC' } });
  }

  async findOne(id: string): Promise<ParamTemplate> {
    const template = await this.paramTemplateRepository.findOne({
      where: { id },
    });
    if (!template) throw new NotFoundException('参数模板不存在');
    return template;
  }

  async findByCategory(category: string): Promise<ParamTemplate> {
    const template = await this.paramTemplateRepository.findOne({
      where: { category },
    });
    if (!template)
      throw new NotFoundException(`分类 "${category}" 的参数模板不存在`);
    return template;
  }

  async getCategories(): Promise<string[]> {
    const result = await this.paramTemplateRepository
      .createQueryBuilder('pt')
      .select('DISTINCT pt.category', 'category')
      .orderBy('pt.category', 'ASC')
      .getRawMany();
    return result.map((r) => r.category);
  }

  async create(dto: CreateParamTemplateDto): Promise<ParamTemplate> {
    this.validateFields(dto.fields);
    const existing = await this.paramTemplateRepository.findOne({
      where: { category: dto.category },
    });
    if (existing) {
      throw new BadRequestException(`分类 "${dto.category}" 已存在`);
    }
    // fields 列非空，省略时落一个空数组而不是 NULL，读取端就不用到处判空
    const template = this.paramTemplateRepository.create({
      ...dto,
      fields: dto.fields?.trim() ? dto.fields : '[]',
    });
    return this.paramTemplateRepository.save(template);
  }

  async update(
    id: string,
    dto: UpdateParamTemplateDto,
  ): Promise<ParamTemplate> {
    const template = await this.findOne(id);
    if (dto.fields) this.validateFields(dto.fields);
    const oldCategory = template.category;
    const newCategory = dto.category?.trim();
    if (newCategory && newCategory !== oldCategory) {
      const existing = await this.paramTemplateRepository.findOne({
        where: { category: newCategory },
      });
      if (existing) {
        throw new BadRequestException(`分类 "${newCategory}" 已存在`);
      }
      dto = { ...dto, category: newCategory };
    }
    Object.assign(template, dto);
    template.version = (template.version || 1) + 1;
    const saved = await this.paramTemplateRepository.save(template);
    if (newCategory && newCategory !== oldCategory) {
      await this.cascadeCategoryRename(oldCategory, newCategory);
    }
    return saved;
  }

  /**
   * 分类改名级联。
   *
   * 分类是斜杠路径字符串：把 零部件/球笼联轴器 改名后，它的三级子项
   * （零部件/球笼联轴器/常规联轴器）以及引用旧分类的需求/产品如果不一并跟过去，
   * 子项会挂在旧路径下变成没有模板的灰色空壳，引用方则再也匹配不上模板。
   */
  private async cascadeCategoryRename(
    oldCategory: string,
    newCategory: string,
  ): Promise<void> {
    const prefix = `${oldCategory}/`;
    const manager = this.paramTemplateRepository.manager;

    // 后代模板：前缀替换
    const descendants = await this.paramTemplateRepository.find({
      where: { category: Like(`${prefix}%`) },
    });
    for (const d of descendants) {
      d.category = newCategory + d.category.slice(oldCategory.length);
    }
    if (descendants.length) {
      await this.paramTemplateRepository.save(descendants);
    }

    // 需求引用：templateCategory 精确匹配 + 后代前缀。
    // 列名加引号 + $n 占位符：PG 折叠未引号 camelCase 列名、且不认 ? 占位符；
    // substr(x, n) 两边都有，前缀拼接 || 亦是
    await manager.query(
      'UPDATE requirements SET "templateCategory" = $1 WHERE "templateCategory" = $2',
      [newCategory, oldCategory],
    );
    await manager.query(
      'UPDATE requirements SET "templateCategory" = $1 || substr("templateCategory", $2) WHERE "templateCategory" LIKE $3',
      [newCategory, oldCategory.length + 1, `${prefix}%`],
    );

    // 产品分类同步，避免产品挂到失效分类
    await manager.query(
      'UPDATE products SET "category" = $1 WHERE "category" = $2',
      [newCategory, oldCategory],
    );
    await manager.query(
      'UPDATE products SET "category" = $1 || substr("category", $2) WHERE "category" LIKE $3',
      [newCategory, oldCategory.length + 1, `${prefix}%`],
    );
  }

  /**
   * 引用数：有多少条需求正按这个模板做结构化。
   *
   * 需求表存的是 templateCategory（分类字符串）而不是模板 id，
   * 所以删掉模板不会触发外键报错 —— 那些需求会安静地失去参数定义，
   * 详情页从此渲染不出参数表，而没有任何地方提示发生过什么。
   */
  async usageCount(category: string): Promise<number> {
    const { count } = await this.paramTemplateRepository.manager
      .createQueryBuilder()
      .select('COUNT(*)', 'count')
      .from('requirements', 'r')
      .where('r.templateCategory = :category', { category })
      .getRawOne<{ count: number }>();
    return Number(count) || 0;
  }

  /**
   * 删除模板。
   *
   * 默认拒绝删除仍被引用的模板，把决定权交回用户：
   * 单机产品里模板是长期资产，误删没有回收站也没有管理员能找回。
   * 确认过后带 force 再来一次即可。
   */
  async remove(id: string, force = false): Promise<{ deleted: true; affected: number }> {
    const template = await this.findOne(id);
    const affected = await this.usageCount(template.category);

    if (affected > 0 && !force) {
      throw new BadRequestException(
        `还有 ${affected} 条需求在使用「${template.category}」模板，` +
          `删除后这些需求的参数定义会失效。确认要删除请再次确认。`,
      );
    }

    await this.paramTemplateRepository.delete(template.id);
    return { deleted: true, affected };
  }

  /**
   * 字段定义校验。
   *
   * 留空是**合法**的：先建模板、字段随后在表格里一条条加，是最自然的流程。
   * 原先留空会走到 JSON.parse('') 抛错，回一句「必须是合法的 JSON 数组字符串」，
   * 用户以为自己格式写错了，其实是根本没让他留空。
   */
  private validateFields(fields: string): void {
    if (fields === undefined || fields === null || String(fields).trim() === '') return;
    try {
      const parsed = JSON.parse(fields);
      if (!Array.isArray(parsed)) {
        throw new Error('not an array');
      }
    } catch (err: any) {
      // 说清楚错在哪，否则用户只能对着一大段 JSON 逐字找
      const hint = /not an array/.test(err?.message)
        ? '最外层必须是数组，用 [ ] 包起来'
        : `解析失败：${err?.message || '格式有误'}（常见原因：用了中文引号，或末尾多一个逗号）`;
      throw new BadRequestException(`字段定义格式不正确 —— ${hint}`);
    }
  }
}
