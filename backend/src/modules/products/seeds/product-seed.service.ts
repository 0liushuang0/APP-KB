import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../entities/product.entity';
import { PRODUCT_TREE_SEED, PRODUCT_CATEGORIES } from './product-tree.seed';

/**
 * 产品数据种子服务
 * 用于初始化产品树数据
 */
@Injectable()
export class ProductSeedService implements OnModuleInit {
  private readonly logger = new Logger(ProductSeedService.name);

  constructor(
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
  ) {}

  async onModuleInit() {
    await this.seedProducts();
  }

  /**
   * 种子产品数据
   */
  async seedProducts(): Promise<void> {
    try {
      // 检查是否已有数据
      const count = await this.productRepository.count();
      if (count > 0) {
        this.logger.log(`Products already seeded (${count} products found)`);
        return;
      }

      this.logger.log('Seeding product tree data...');

      // 批量插入产品
      for (const productData of PRODUCT_TREE_SEED) {
        // 将规格和特点信息拼入description（Product实体无specifications/features字段）
        const specs = Object.entries(productData.specifications)
          .map(([k, v]) => `${k}: ${v}`)
          .join('; ');

        const features = productData.features?.length
          ? ` [特点] ${productData.features.join('; ')}`
          : '';

        const product = this.productRepository.create({
          code: productData.code,
          name: productData.name,
          category: productData.category,
          description: `${productData.description} [规格] ${specs}${features}`,
          price: productData.price,
          unit: productData.unit,
          status: productData.status,
          visibility: 'public',
        });

        await this.productRepository.save(product);
      }

      this.logger.log(`Successfully seeded ${PRODUCT_TREE_SEED.length} products`);

      // 输出分类统计
      const categoryStats = new Map<string, number>();
      for (const product of PRODUCT_TREE_SEED) {
        categoryStats.set(
          product.category,
          (categoryStats.get(product.category) || 0) + 1,
        );
      }

      for (const [category, count] of categoryStats) {
        this.logger.log(`  - ${category}: ${count} products`);
      }
    } catch (error) {
      this.logger.error(`Failed to seed products: ${error.message}`);
    }
  }

  /**
   * 获取产品分类列表
   */
  getCategories() {
    return PRODUCT_CATEGORIES;
  }

  /**
   * 按分类获取产品
   */
  async getProductsByCategory(category: string): Promise<Product[]> {
    return this.productRepository.find({
      where: { category, status: 'active' },
      order: { code: 'ASC' },
    });
  }

  /**
   * 搜索产品
   */
  async searchProducts(keyword: string): Promise<Product[]> {
    return this.productRepository
      .createQueryBuilder('product')
      .where('product.name LIKE :keyword', { keyword: `%${keyword}%` })
      .orWhere('product.description LIKE :keyword', { keyword: `%${keyword}%` })
      .orWhere('product.code LIKE :keyword', { keyword: `%${keyword}%` })
      .andWhere('product.status = :status', { status: 'active' })
      .orderBy('product.code', 'ASC')
      .getMany();
  }

  /**
   * 获取产品统计
   */
  async getProductStats(): Promise<{
    total: number;
    byCategory: Record<string, number>;
    priceRange: { min: number; max: number; avg: number };
  }> {
    const total = await this.productRepository.count();

    // 按分类统计
    const categoryCounts = await this.productRepository
      .createQueryBuilder('product')
      .select('product.category', 'category')
      .addSelect('COUNT(*)', 'count')
      .where('product.status = :status', { status: 'active' })
      .groupBy('product.category')
      .getRawMany();

    const byCategory: Record<string, number> = {};
    for (const item of categoryCounts) {
      byCategory[item.category] = parseInt(item.count);
    }

    // 价格范围
    const priceStats = await this.productRepository
      .createQueryBuilder('product')
      .select('MIN(product.price)', 'min')
      .addSelect('MAX(product.price)', 'max')
      .addSelect('AVG(product.price)', 'avg')
      .where('product.status = :status', { status: 'active' })
      .getRawOne();

    return {
      total,
      byCategory,
      priceRange: {
        min: parseFloat(priceStats?.min || '0'),
        max: parseFloat(priceStats?.max || '0'),
        avg: parseFloat(priceStats?.avg || '0'),
      },
    };
  }
}
