import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ParamTemplatesService } from './param-templates.service';
import {
  CreateParamTemplateDto,
  UpdateParamTemplateDto,
} from './dto/param-template.dto';

@ApiTags('参数模板')
@Controller('param-templates')
export class ParamTemplatesController {
  constructor(
    private readonly paramTemplatesService: ParamTemplatesService,
  ) {}

  @Get()
  findAll() {
    return this.paramTemplatesService.findAll();
  }

  @Get('categories')
  getCategories() {
    return this.paramTemplatesService.getCategories();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.paramTemplatesService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateParamTemplateDto) {
    return this.paramTemplatesService.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateParamTemplateDto,
  ) {
    return this.paramTemplatesService.update(id, dto);
  }

  /** 引用数：删除前先让用户知道会影响多少条需求 */
  @Get(':id/usage')
  async usage(@Param('id') id: string) {
    const template = await this.paramTemplatesService.findOne(id);
    return { count: await this.paramTemplatesService.usageCount(template.category) };
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Query('force') force?: string) {
    return this.paramTemplatesService.remove(id, force === 'true');
  }
}
