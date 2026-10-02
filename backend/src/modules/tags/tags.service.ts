import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Tag } from './entities/tag.entity';
import { TagRelation } from './entities/tag-relation.entity';

@Injectable()
export class TagsService {
  constructor(
    @InjectRepository(Tag)
    private tagRepository: Repository<Tag>,
    @InjectRepository(TagRelation)
    private relationRepository: Repository<TagRelation>,
  ) {}

  async create(name: string, color?: string, category?: string): Promise<Tag> {
    const existing = await this.tagRepository.findOne({ where: { name } });
    if (existing) throw new BadRequestException('标签名已存在');
    const tag = this.tagRepository.create({ name, color, category });
    return this.tagRepository.save(tag);
  }

  async findAll(category?: string): Promise<Tag[]> {
    const where = category ? { category } : {};
    return this.tagRepository.find({ where, order: { name: 'ASC' } });
  }

  async findOne(id: string): Promise<Tag> {
    const tag = await this.tagRepository.findOne({ where: { id } });
    if (!tag) throw new NotFoundException('标签不存在');
    return tag;
  }

  async update(id: string, name?: string, color?: string): Promise<Tag> {
    const tag = await this.findOne(id);
    if (name !== undefined) tag.name = name;
    if (color !== undefined) tag.color = color;
    return this.tagRepository.save(tag);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.relationRepository.delete({ tagId: id });
    await this.tagRepository.delete(id);
  }

  async tag(entityType: string, entityId: string, tagIds: string[]): Promise<void> {
    const tags = await this.tagRepository.find({ where: { id: In(tagIds) } });
    if (tags.length !== tagIds.length) throw new BadRequestException('部分标签不存在');
    const existing = await this.relationRepository.find({
      where: { entityType, entityId, tagId: In(tagIds) },
    });
    const existingIds = new Set(existing.map((r) => r.tagId));
    const newRelations = tagIds
      .filter((tid) => !existingIds.has(tid))
      .map((tid) => this.relationRepository.create({ tagId: tid, entityType, entityId }));
    if (newRelations.length) await this.relationRepository.save(newRelations);
  }

  async untag(entityType: string, entityId: string, tagIds: string[]): Promise<void> {
    await this.relationRepository.delete({
      entityType,
      entityId,
      tagId: In(tagIds),
    });
  }

  async findByEntity(entityType: string, entityId: string): Promise<Tag[]> {
    const relations = await this.relationRepository.find({
      where: { entityType, entityId },
      relations: ['tag'],
    });
    return relations.map((r) => r.tag);
  }

  async findByTag(tagId: string): Promise<TagRelation[]> {
    return this.relationRepository.find({ where: { tagId } });
  }
}
