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
import { zhRejectManagedChanges } from '../../common/zh-contract';
import { ZH_SETTINGS_STORE, ZH_SETTING_LABELS } from '../zh-settings/zh-settings';

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
  async setValue(@Body() dto: CreateSystemConfigDto) {
    zhRejectManagedChanges(ZH_SETTINGS_STORE, { [dto.key]: dto.value }, { [dto.key]: (await this.systemConfigService.getValue(dto.key)) ?? '' }, ZH_SETTING_LABELS);
    return this.systemConfigService.setValue(
      dto.key,
      dto.value,
      dto.category,
      dto.description,
    );
  }

  @Patch(':id')
  @Roles('admin')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSystemConfigDto,
  ) {
    const row = (await this.systemConfigService.findAll()).find((c) => c.id === id);
    if (row && dto.value !== undefined) {
      zhRejectManagedChanges(ZH_SETTINGS_STORE, { [row.key]: dto.value }, { [row.key]: row.value }, ZH_SETTING_LABELS);
    }
    return this.systemConfigService.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin')
  remove(@Param('id') id: string) {
    return this.systemConfigService.remove(id);
  }
}
