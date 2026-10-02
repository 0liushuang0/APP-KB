import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PromptTemplate } from './entities/prompt-template.entity';

@Injectable()
export class PromptTemplateService {
  constructor(
    @InjectRepository(PromptTemplate)
    private templateRepository: Repository<PromptTemplate>,
  ) {}

  async create(
    name: string,
    content: string,
    category?: string,
    variables?: string[],
    userId?: string,
  ): Promise<PromptTemplate> {
    const existing = await this.templateRepository.findOne({ where: { name } });
    if (existing) throw new BadRequestException('模板名称已存在');
    const template = this.templateRepository.create({
      name,
      content,
      category,
      variables: variables || [],
      userId,
    });
    return this.templateRepository.save(template);
  }

  async findAll(category?: string): Promise<PromptTemplate[]> {
    const where = category ? { category } : {};
    return this.templateRepository.find({ where, order: { usageCount: 'DESC' } });
  }

  async findOne(id: string): Promise<PromptTemplate> {
    const template = await this.templateRepository.findOne({ where: { id } });
    if (!template) throw new NotFoundException('提示词模板不存在');
    return template;
  }

  async update(id: string, data: Partial<Pick<PromptTemplate, 'name' | 'content' | 'category' | 'variables' | 'isDefault'>>): Promise<PromptTemplate> {
    const template = await this.findOne(id);
    Object.assign(template, data);
    return this.templateRepository.save(template);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.templateRepository.delete(id);
  }

  async incrementUsage(id: string): Promise<void> {
    await this.templateRepository.increment({ id }, 'usageCount', 1);
  }

  async applyVariables(id: string, variableValues: Record<string, string>): Promise<{ content: string }> {
    const template = await this.findOne(id);
    let result = template.content;
    for (const [key, value] of Object.entries(variableValues)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    await this.incrementUsage(id);
    return { content: result };
  }
}
