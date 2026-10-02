import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from './entities/role.entity';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';

@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Role)
    private roleRepository: Repository<Role>,
  ) {}

  async findAll(): Promise<Role[]> {
    return this.roleRepository.find();
  }

  async findOne(id: string): Promise<Role> {
    return this.roleRepository.findOne({ where: { id } });
  }

  async findByCode(code: string): Promise<Role> {
    return this.roleRepository.findOne({ where: { code } });
  }

  async create(dto: CreateRoleDto): Promise<Role> {
    const role = this.roleRepository.create(dto);
    return this.roleRepository.save(role);
  }

  async update(id: string, dto: UpdateRoleDto): Promise<Role> {
    await this.roleRepository.update(id, dto);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.roleRepository.delete(id);
  }

  async seedSystemRoles(): Promise<void> {
    const roles = [
      {
        code: 'admin',
        name: '系统管理员',
        description: '拥有所有权限',
        permissions: ['*'],
        isSystem: true,
      },
      {
        code: 'dept_admin',
        name: '部门管理员',
        description: '管理部门及用户',
        permissions: ['users:manage', 'departments:manage', 'knowledge:manage'],
        isSystem: true,
      },
      {
        code: 'knowledge_admin',
        name: '知识管理员',
        description: '审核知识、管理分类',
        permissions: ['knowledge:manage', 'knowledge:approve'],
        isSystem: true,
      },
      {
        code: 'editor',
        name: '编辑者',
        description: '创建和编辑业务对象',
        permissions: ['knowledge:create', 'knowledge:edit', 'customers:write', 'proposals:write', 'quotations:write'],
        isSystem: true,
      },
      {
        code: 'viewer',
        name: '查看者',
        description: '查看有权限的内容',
        permissions: ['knowledge:read', 'customers:read', 'proposals:read', 'quotations:read'],
        isSystem: true,
      },
      {
        code: 'guest',
        name: '访客',
        description: '仅查看公开内容',
        permissions: ['knowledge:read_public'],
        isSystem: true,
      },
    ];

    for (const role of roles) {
      const exists = await this.findByCode(role.code);
      if (!exists) {
        await this.create(role as CreateRoleDto);
      }
    }
  }
}
