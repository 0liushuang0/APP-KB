import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UserGroupsService } from './user-groups.service';
import { CreateUserGroupDto, UpdateUserGroupDto } from './dto/user-group.dto';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('用户组管理')
@ApiBearerAuth()
@Controller('user-groups')
export class UserGroupsController {
  constructor(private readonly userGroupsService: UserGroupsService) {}

  @Get()
  findAll() {
    return this.userGroupsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.userGroupsService.findOne(id);
  }

  @Post()
  @Roles('admin', 'dept_admin')
  create(@Body() dto: CreateUserGroupDto) {
    return this.userGroupsService.create(dto);
  }

  @Put(':id')
  @Roles('admin', 'dept_admin')
  update(@Param('id') id: string, @Body() dto: UpdateUserGroupDto) {
    return this.userGroupsService.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin', 'dept_admin')
  remove(@Param('id') id: string) {
    return this.userGroupsService.remove(id);
  }
}
