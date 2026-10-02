import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserGroup } from './entities/user-group.entity';
import { CreateUserGroupDto, UpdateUserGroupDto } from './dto/user-group.dto';

@Injectable()
export class UserGroupsService {
  constructor(
    @InjectRepository(UserGroup)
    private userGroupRepository: Repository<UserGroup>,
  ) {}

  async findAll(): Promise<UserGroup[]> {
    return this.userGroupRepository.find({ relations: ['users'] });
  }

  async findOne(id: string): Promise<UserGroup> {
    return this.userGroupRepository.findOne({
      where: { id },
      relations: ['users'],
    });
  }

  async create(dto: CreateUserGroupDto): Promise<UserGroup> {
    const group = this.userGroupRepository.create(dto);
    return this.userGroupRepository.save(group);
  }

  async update(id: string, dto: UpdateUserGroupDto): Promise<UserGroup> {
    await this.userGroupRepository.update(id, dto);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.userGroupRepository.delete(id);
  }
}
