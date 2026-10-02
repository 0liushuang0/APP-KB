import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiBudget } from './entities/ai-budget.entity';

@Injectable()
export class AiBudgetService {
  constructor(
    @InjectRepository(AiBudget)
    private budgetRepository: Repository<AiBudget>,
  ) {}

  private getCurrentPeriod(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  async getBudget(userId: string): Promise<AiBudget | null> {
    const period = this.getCurrentPeriod();
    return this.budgetRepository.findOne({
      where: { userId, period },
    });
  }

  async setBudget(userId: string, monthlyLimit: number): Promise<AiBudget> {
    const period = this.getCurrentPeriod();
    let budget = await this.budgetRepository.findOne({
      where: { userId, period },
    });

    if (budget) {
      budget.monthlyLimit = monthlyLimit;
    } else {
      budget = this.budgetRepository.create({
        userId,
        monthlyLimit,
        currentUsage: 0,
        alertThreshold: 0.8,
        period,
        isActive: true,
      });
    }

    return this.budgetRepository.save(budget);
  }

  async recordUsage(userId: string, cost: number): Promise<void> {
    const period = this.getCurrentPeriod();
    let budget = await this.budgetRepository.findOne({
      where: { userId, period },
    });

    if (!budget) {
      budget = this.budgetRepository.create({
        userId,
        monthlyLimit: 0,
        currentUsage: 0,
        alertThreshold: 0.8,
        period,
        isActive: true,
      });
    }

    budget.currentUsage = Number(budget.currentUsage) + cost;
    await this.budgetRepository.save(budget);
  }

  async checkBudget(userId: string): Promise<{
    allowed: boolean;
    usage: number;
    limit: number;
    percentage: number;
    alertLevel: 'none' | 'warning' | 'critical';
  }> {
    const budget = await this.getBudget(userId);

    if (!budget || !budget.isActive) {
      return {
        allowed: true,
        usage: 0,
        limit: 0,
        percentage: 0,
        alertLevel: 'none',
      };
    }

    const usage = Number(budget.currentUsage);
    const limit = Number(budget.monthlyLimit);
    const percentage = limit > 0 ? usage / limit : 0;
    const alertThreshold = Number(budget.alertThreshold);

    let alertLevel: 'none' | 'warning' | 'critical' = 'none';
    if (percentage >= 1) {
      alertLevel = 'critical';
    } else if (percentage >= alertThreshold) {
      alertLevel = 'warning';
    }

    return {
      allowed: limit === 0 || usage < limit,
      usage,
      limit,
      percentage,
      alertLevel,
    };
  }

  async resetMonthly(): Promise<void> {
    const period = this.getCurrentPeriod();
    await this.budgetRepository.update(
      { period },
      { currentUsage: 0 },
    );
  }
}