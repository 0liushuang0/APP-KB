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
import { SolutionsService } from './solutions.service';
import {
  CreateSolutionDto,
  UpdateSolutionDto,
  CreateConfigOptionDto,
  CreatePriceTableDto,
  CalculatePriceDto,
  QuerySolutionDto,
  MoveDirectoryDto,
} from './dto/solution.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/services/permission.service';

@ApiTags('方案库')
@Controller('solutions')
export class SolutionsController {
  constructor(private readonly solutionsService: SolutionsService) {}

  @Get()
  findAll(@Query() query: QuerySolutionDto, @CurrentUser() user: CurrentUserType) {
    return this.solutionsService.findAll(query, user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.solutionsService.findOne(id, user);
  }

  @Post()
  create(@Body() dto: CreateSolutionDto, @CurrentUser() user: CurrentUserType) {
    return this.solutionsService.create(dto, user);
  }

  /** 复制方案（连带配置项与价格表），新方案为草稿状态 */
  @Post(':id/copy')
  copy(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.solutionsService.copy(id, user);
  }

  /** 批量移动/重命名目录节点：把 from 前缀改成 to */
  @Post('move-directory')
  moveDirectory(@Body() dto: MoveDirectoryDto) {
    return this.solutionsService.moveDirectory(dto.from, dto.to || '');
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSolutionDto) {
    return this.solutionsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.solutionsService.remove(id);
  }

  @Post('calculate-price')
  calculatePrice(@Body() dto: CalculatePriceDto, @CurrentUser() user: CurrentUserType) {
    return this.solutionsService.calculatePrice(dto, user);
  }

  @Post(':id/validate-config')
  validateConfig(@Param('id') id: string, @Body() body: { config: Record<string, string> }) {
    return this.solutionsService.validateConfig(id, body.config || {});
  }

  @Post('config-options')
  upsertConfigOption(@Body() dto: CreateConfigOptionDto) {
    return this.solutionsService.upsertConfigOption(dto);
  }

  @Delete('config-options/:id')
  removeConfigOption(@Param('id') id: string) {
    return this.solutionsService.removeConfigOption(id);
  }

  @Post('price-tables')
  upsertPriceTable(@Body() dto: CreatePriceTableDto) {
    return this.solutionsService.upsertPriceTable(dto);
  }

  @Delete('price-tables/:id')
  removePriceTable(@Param('id') id: string) {
    return this.solutionsService.removePriceTable(id);
  }
}
