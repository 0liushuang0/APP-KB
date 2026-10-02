import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { MaterialsService, CreateMaterialDto, UpdateMaterialDto, QueryMaterialDto } from './materials.service';

@ApiTags('物料管理')
@Controller('materials')
export class MaterialsController {
  constructor(private readonly materialsService: MaterialsService) {}

  @Get()
  findAll(@Query() query: QueryMaterialDto) {
    return this.materialsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.materialsService.findOne(id);
  }

  /** 该物料各供应商报价（同规格跨厂家比价） */
  @Get(':id/offerings')
  offerings(@Param('id') id: string) {
    return this.materialsService.offerings(id);
  }

  /** 在物料下添加一条厂家报价 */
  @Post(':id/offerings')
  addOffering(@Param('id') id: string, @Body() dto: any) {
    return this.materialsService.addOffering(id, dto);
  }

  /** 删除一条厂家报价 */
  @Delete(':id/offerings/:offeringId')
  async removeOffering(@Param('offeringId') offeringId: string) {
    await this.materialsService.removeOffering(offeringId);
    return { success: true };
  }

  @Post()
  create(@Body() dto: CreateMaterialDto) {
    return this.materialsService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMaterialDto) {
    return this.materialsService.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.materialsService.remove(id);
    return { success: true };
  }
}
