import {
  Controller,
  Get,
  Put,
  Body,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AiBudgetService } from './ai-budget.service';

@ApiTags('AI预算')
@Controller('ai-budget')
export class AiBudgetController {
  constructor(private readonly aiBudgetService: AiBudgetService) {}

  @Get()
  @ApiOperation({ summary: '获取当前用户预算' })
  async getBudget(@Request() req) {
    const userId = req.user?.id || 'default';
    return this.aiBudgetService.getBudget(userId);
  }

  @Put()
  @ApiOperation({ summary: '设置预算限额' })
  async setBudget(@Request() req, @Body() body: { monthlyLimit: number }) {
    const userId = req.user?.id || 'default';
    return this.aiBudgetService.setBudget(userId, body.monthlyLimit);
  }

  @Get('status')
  @ApiOperation({ summary: '检查预算状态' })
  async checkBudget(@Request() req) {
    const userId = req.user?.id || 'default';
    return this.aiBudgetService.checkBudget(userId);
  }
}