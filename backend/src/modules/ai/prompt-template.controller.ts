import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PromptTemplateService } from './prompt-template.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/services/permission.service';

@ApiTags('提示词模板')
@Controller('prompt-templates')
export class PromptTemplateController {
  constructor(private readonly templateService: PromptTemplateService) {}

  @Post()
  create(
    @Body() body: { name: string; content: string; category?: string; variables?: string[] },
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.templateService.create(body.name, body.content, body.category, body.variables, user?.userId);
  }

  @Get()
  findAll(@Query('category') category?: string) {
    return this.templateService.findAll(category);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.templateService.findOne(id);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() data: { name?: string; content?: string; category?: string; variables?: string[]; isDefault?: boolean },
  ) {
    return this.templateService.update(id, data);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.templateService.remove(id);
  }

  @Post(':id/apply')
  applyVariables(@Param('id') id: string, @Body() body: { variables: Record<string, string> }) {
    return this.templateService.applyVariables(id, body.variables);
  }
}
