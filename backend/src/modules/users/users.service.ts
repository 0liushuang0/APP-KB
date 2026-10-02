import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { RolesService } from '../roles/roles.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private rolesService: RolesService,
  ) {}

  async findAll(): Promise<User[]> {
    return this.userRepository.find({
      relations: ['department', 'roles', 'groups'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { id },
      relations: ['department', 'roles', 'groups'],
    });
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { username },
      relations: ['roles', 'groups'],
    });
  }

  async create(dto: CreateUserDto): Promise<User> {
    const existing = await this.findByUsername(dto.username);
    if (existing) {
      throw new BadRequestException('用户名已存在');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const user = this.userRepository.create({
      ...dto,
      password: hashedPassword,
      isActive: true,
    });

    if (dto.roleIds?.length) {
      user.roles = await Promise.all(
        dto.roleIds.map((id) => this.rolesService.findOne(id)),
      );
    }

    return this.userRepository.save(user);
  }

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.findOne(id);
    if (!user) throw new NotFoundException('用户不存在');

    const updates: any = { ...dto };
    delete updates.roleIds;
    delete updates.groupIds;
    if (dto.password) {
      updates.password = await bcrypt.hash(dto.password, 10);
    }

    if (dto.roleIds !== undefined) {
      user.roles = dto.roleIds.length
        ? await Promise.all(dto.roleIds.map((rid) => this.rolesService.findOne(rid)))
        : [];
    }

    if (dto.groupIds !== undefined) {
      const groups = dto.groupIds.map((gid) => ({ id: gid } as any));
      user.groups = groups;
    }

    Object.assign(user, updates);
    return this.userRepository.save(user);
  }

  async remove(id: string): Promise<void> {
    const user = await this.findOne(id);
    if (!user) throw new NotFoundException('用户不存在');
    if (user.isSystemAdmin) {
      throw new ForbiddenException('不能删除系统管理员');
    }
    await this.userRepository.delete(id);
  }

  async validatePassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.password);
  }

  async updatePassword(userId: string, password: string): Promise<void> {
    const hashed = await bcrypt.hash(password, 10);
    await this.userRepository.update(userId, { password: hashed });
  }
}
