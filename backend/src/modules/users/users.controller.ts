import { Controller, Get, Post, Put, Delete, Body, Param, UseInterceptors } from '@nestjs/common';
import { ClassSerializerInterceptor } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from './entities/user.entity';

@ApiTags('用户管理')
@ApiBearerAuth()
@UseInterceptors(ClassSerializerInterceptor)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getProfile(@CurrentUser() user: User) {
    return this.usersService.findOne(user.id);
  }

  @Get()
  @Roles('admin', 'dept_admin')
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  @Roles('admin', 'dept_admin')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  @Roles('admin', 'dept_admin')
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Put(':id')
  @Roles('admin', 'dept_admin')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() caller: User) {
    // P0 安全修复：非系统管理员禁止修改角色和系统管理员标志
    if (!caller.isSystemAdmin) {
      delete dto.roleIds;
      delete dto.isSystemAdmin;
    }
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin', 'dept_admin')
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
