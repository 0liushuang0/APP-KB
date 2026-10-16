import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/services/permission.service';
import { SavedViewsService, SavedViewInput } from './saved-views.service';

/** 列表「保存的视图」：个人 / 团队共享，可设默认 */
@ApiTags('保存的视图')
@Controller('saved-views')
export class SavedViewsController {
  constructor(private readonly service: SavedViewsService) {}

  @Get()
  list(@Query('page') page: string, @CurrentUser() user: CurrentUserType) {
    return this.service.list(page, user);
  }

  @Post()
  create(@Body() body: SavedViewInput, @CurrentUser() user: CurrentUserType) {
    return this.service.create(body, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: Partial<SavedViewInput>, @CurrentUser() user: CurrentUserType) {
    return this.service.update(id, body, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.service.remove(id, user);
  }
}
