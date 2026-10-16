import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SavedView } from './saved-view.entity';
import { CurrentUser } from '../../common/services/permission.service';

export interface SavedViewInput {
  page: string;
  name: string;
  state: any;
  shared?: boolean;
  isDefault?: boolean;
}

const PAGE_RE = /^[a-z][a-z0-9-]{1,40}$/;

@Injectable()
export class SavedViewsService {
  constructor(@InjectRepository(SavedView) private readonly views: Repository<SavedView>) {}

  private out(v: SavedView, user: CurrentUser) {
    let state: any = {};
    try {
      state = JSON.parse(v.state);
    } catch {
      state = {};
    }
    return { ...v, state, mine: v.ownerId === user?.userId };
  }

  /** 我的视图 + 别人共享的团队视图 */
  async list(page: string, user: CurrentUser) {
    if (!PAGE_RE.test(page || '')) throw new BadRequestException('page 不合法');
    const rows = await this.views
      .createQueryBuilder('v')
      .where('v.page = :page', { page })
      .andWhere('(v.ownerId = :me OR v.shared = :t)', { me: user?.userId || '', t: true })
      .orderBy('v.shared', 'ASC')
      .addOrderBy('v.name', 'ASC')
      .getMany();
    return rows.map((v) => {
      const o = this.out(v, user);
      // 别人的默认视图不是我的默认
      if (!o.mine) o.isDefault = false;
      return o;
    });
  }

  async create(input: SavedViewInput, user: CurrentUser) {
    if (!PAGE_RE.test(input?.page || '')) throw new BadRequestException('page 不合法');
    const name = String(input?.name || '').trim().slice(0, 60);
    if (!name) throw new BadRequestException('请给视图起个名字');
    const state = JSON.stringify(input.state ?? {});
    if (state.length > 20_000) throw new BadRequestException('视图内容过大');
    if (input.isDefault) await this.clearDefault(input.page, user);
    const saved = await this.views.save(
      this.views.create({ page: input.page, name, state, shared: !!input.shared, isDefault: !!input.isDefault, ownerId: user?.userId }),
    );
    return this.out(saved, user);
  }

  async update(id: string, input: Partial<SavedViewInput>, user: CurrentUser) {
    const v = await this.views.findOne({ where: { id } });
    if (!v) throw new NotFoundException('视图不存在');
    if (v.ownerId !== user?.userId) throw new ForbiddenException('只能修改自己创建的视图');
    if (input.name !== undefined) v.name = String(input.name).trim().slice(0, 60) || v.name;
    if (input.state !== undefined) v.state = JSON.stringify(input.state ?? {});
    if (input.shared !== undefined) v.shared = !!input.shared;
    if (input.isDefault !== undefined) {
      if (input.isDefault) await this.clearDefault(v.page, user);
      v.isDefault = !!input.isDefault;
    }
    return this.out(await this.views.save(v), user);
  }

  async remove(id: string, user: CurrentUser) {
    const v = await this.views.findOne({ where: { id } });
    if (!v) throw new NotFoundException('视图不存在');
    if (v.ownerId !== user?.userId && !user?.isSystemAdmin) throw new ForbiddenException('只能删除自己创建的视图');
    await this.views.delete(id);
    return { success: true };
  }

  private async clearDefault(page: string, user: CurrentUser) {
    await this.views.update({ page, ownerId: user?.userId, isDefault: true } as any, { isDefault: false });
  }
}
