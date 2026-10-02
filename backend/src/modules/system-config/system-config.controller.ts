import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SystemConfigService } from './system-config.service';
import {
  CreateSystemConfigDto,
  UpdateSystemConfigDto,
} from './dto/system-config.dto';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('系统配置')
@Controller('system-configs')
export class SystemConfigController {
  constructor(private readonly systemConfigService: SystemConfigService) {}

  @Get()
  findAll() {
    return this.systemConfigService.findAll();
  }

  @Get(':key')
  getValue(@Param('key') key: string) {
    return this.systemConfigService.getValue(key);
  }

  // P0 安全修复：写操作限制为管理员
  @Post()
  @Roles('admin')
  setValue(@Body() dto: CreateSystemConfigDto) {
    return this.systemConfigService.setValue(
      dto.key,
      dto.value,
      dto.category,
      dto.description,
    );
  }

  @Patch(':id')
  @Roles('admin')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSystemConfigDto,
  ) {
    return this.systemConfigService.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin')
  remove(@Param('id') id: string) {
    return this.systemConfigService.remove(id);
  }
}
