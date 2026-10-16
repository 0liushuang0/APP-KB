import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SuppliersService } from './suppliers.service';
import { SupplierProductsService } from './supplier-products.service';
import {
  CreateSupplierDto,
  UpdateSupplierDto,
  QuerySupplierDto,
  CreateSupplierProductDto,
  UpdateSupplierProductDto,
  QuerySupplierProductDto,
  CreateSupplierQuoteDto,
  CompareSupplierDto,
} from './dto/supplier.dto';
import {
  PRODUCT_CATEGORY_OPTIONS,
  SUPPLIER_ORIGIN_LABELS,
  SUPPLIER_TIER_LABELS,
  COOPERATION_LEVEL_LABELS,
} from './entities/supplier.entity';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/services/permission.service';

@ApiTags('供应商管理')
@Controller('suppliers')
export class SuppliersController {
  constructor(
    private readonly suppliersService: SuppliersService,
    private readonly supplierProductsService: SupplierProductsService,
  ) {}

  @Get()
  findAll(@Query() query: QuerySupplierDto, @CurrentUser() user: CurrentUserType) {
    return this.suppliersService.findAll(query, user);
  }

  /** 筛选面板的可选项字典 */
  @Get('meta')
  meta() {
    return {
      categories: PRODUCT_CATEGORY_OPTIONS,
      origins: Object.entries(SUPPLIER_ORIGIN_LABELS).map(([value, label]) => ({ value, label })),
      tiers: Object.entries(SUPPLIER_TIER_LABELS).map(([value, label]) => ({ value, label })),
      cooperationLevels: Object.entries(COOPERATION_LEVEL_LABELS).map(([value, label]) => ({ value, label })),
    };
  }

  /** 比价：按品类 / 关键词横向对比多家供应商的同类产品 */
  @Get('compare')
  compare(@Query() query: CompareSupplierDto) {
    return this.supplierProductsService.compare(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.suppliersService.findOne(id, user);
  }

  @Post()
  create(@Body() dto: CreateSupplierDto, @CurrentUser() user: CurrentUserType) {
    return this.suppliersService.create(dto, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSupplierDto, @CurrentUser() user: CurrentUserType) {
    return this.suppliersService.update(id, dto, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.suppliersService.remove(id, user);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.suppliersService.approve(id, user);
  }

  // ── 供应产品目录 ───────────────────────────────────────────
  @Get(':id/products')
  listProducts(@Param('id') id: string) {
    return this.supplierProductsService.findBySupplier(id);
  }

  @Post(':id/products')
  createProduct(@Param('id') id: string, @Body() dto: CreateSupplierProductDto) {
    return this.supplierProductsService.create(id, dto);
  }
}

@ApiTags('供应产品')
@Controller('supplier-products')
export class SupplierProductsController {
  constructor(private readonly service: SupplierProductsService) {}

  @Get()
  findAll(@Query() query: QuerySupplierProductDto) {
    return this.service.findAll(query);
  }

  /** 给我方产品推荐可能的采购来源（名称相似、尚未映射的供应产品） */
  @Get('suggest-for-product/:productId')
  suggestForProduct(@Param('productId') productId: string) {
    return this.service.suggestForProduct(productId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSupplierProductDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  /** 记录一次实际报价，同时刷新目录价区间 */
  @Post(':id/quotes')
  addQuote(
    @Param('id') id: string,
    @Body() dto: CreateSupplierQuoteDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.service.addQuote(id, dto, user);
  }

  @Get(':id/price-history')
  priceHistory(@Param('id') id: string) {
    return this.service.priceHistory(id);
  }

  /** 按规格签名自动挂物料（同规格匹配到唯一物料则回填 materialId） */
  @Post(':id/auto-link-material')
  autoLinkMaterial(@Param('id') id: string) {
    return this.service.autoLinkMaterial(id);
  }
}
