import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TagsService } from './tags.service';

@ApiTags('标签管理')
@Controller('tags')
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Post()
  create(@Body() body: { name: string; color?: string; category?: string }) {
    return this.tagsService.create(body.name, body.color, body.category);
  }

  @Get()
  findAll(@Query('category') category?: string) {
    return this.tagsService.findAll(category);
  }

  @Get('entity/:type/:id')
  findByEntity(@Param('type') type: string, @Param('id') id: string) {
    return this.tagsService.findByEntity(type, id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tagsService.findOne(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: { name?: string; color?: string }) {
    return this.tagsService.update(id, body.name, body.color);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.tagsService.remove(id);
  }

  @Post('assign')
  assign(@Body() body: { entityType: string; entityId: string; tagIds: string[] }) {
    return this.tagsService.tag(body.entityType, body.entityId, body.tagIds);
  }

  @Delete('assign')
  unassign(@Body() body: { entityType: string; entityId: string; tagIds: string[] }) {
    return this.tagsService.untag(body.entityType, body.entityId, body.tagIds);
  }
}
