import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, TreeRepository } from 'typeorm';
import { Department } from './entities/department.entity';
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto/department.dto';

@Injectable()
export class DepartmentsService {
  constructor(
    @InjectRepository(Department)
    private departmentRepository: TreeRepository<Department>,
  ) {}

  async findAll(): Promise<Department[]> {
    return this.departmentRepository.findTrees();
  }

  async findOne(id: string): Promise<Department> {
    return this.departmentRepository.findOne({ where: { id } });
  }

  async create(dto: CreateDepartmentDto): Promise<Department> {
    const department = this.departmentRepository.create(dto);
    if (dto.parentId) {
      department.parent = await this.findOne(dto.parentId);
    }
    return this.departmentRepository.save(department);
  }

  async update(id: string, dto: UpdateDepartmentDto): Promise<Department> {
    const department = await this.findOne(id);
    Object.assign(department, dto);
    if (dto.parentId) {
      department.parent = await this.findOne(dto.parentId);
    }
    return this.departmentRepository.save(department);
  }

  async remove(id: string): Promise<void> {
    await this.departmentRepository.delete(id);
  }
}
