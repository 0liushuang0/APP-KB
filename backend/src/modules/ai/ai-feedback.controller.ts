import { Controller, Post, Get, Body, Query, Req, Param, BadRequestException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { AiFeedback } from './entities/ai-feedback.entity';

@ApiTags('AI反馈')
@Controller('ai-feedback')
export class AiFeedbackController {
  constructor(
    @InjectRepository(AiFeedback)
    private feedbackRepository: Repository<AiFeedback>,
  ) {}

  @Post()
  async create(
    @Body() body: {
      messageId: string;
      rating: 'positive' | 'negative';
      comment?: string;
      sessionId: string;
      module?: string;
    },
    @Req() req: any,
  ) {
    const feedback = this.feedbackRepository.create({
      messageId: body.messageId,
      rating: body.rating,
      comment: body.comment,
      sessionId: body.sessionId,
      module: body.module || 'ai-assistant',
      userId: req.user?.id,
    });
    return this.feedbackRepository.save(feedback);
  }

  /**
   * 高分问答沉淀为 FAQ（知识飞轮）。
   * 仅 positive 反馈可转；问答原文由前端随请求带上（feedback 表只存引用）。
   * 落盘到知识库 FAQ常见问题 目录，与售后 convertToFaq 同一套写入方式。
   */
  @Post(':id/convert-to-faq')
  async convertToFaq(
    @Param('id') id: string,
    @Body() body: { question: string; answer: string },
    @Req() req: any,
  ) {
    const feedback = await this.feedbackRepository.findOne({ where: { id } });
    if (!feedback) throw new BadRequestException('反馈不存在');
    if (feedback.rating !== 'positive') throw new BadRequestException('仅高分问答可沉淀为 FAQ');
    const question = body?.question?.trim();
    const answer = body?.answer?.trim();
    if (!question || !answer) throw new BadRequestException('缺少问答内容');

    const title = question.slice(0, 50);
    const md = [
      `# ${title}`,
      '',
      '> 来源：AI 助手高分问答沉淀',
      '',
      '## 问题',
      question,
      '',
      '## 回答',
      answer,
      '',
      '---',
      `*由 AI 问答自动沉淀 · ${new Date().toLocaleDateString('zh-CN')}*`,
    ].join('\n');

    const knowledgeDir = path.resolve(process.cwd(), 'data', 'uploads', 'knowledge', 'FAQ常见问题');
    if (!fs.existsSync(knowledgeDir)) fs.mkdirSync(knowledgeDir, { recursive: true });
    const safe = title.replace(/[\\/:*?"<>|]/g, '_');
    const fileName = `FAQ_${Date.now()}_${safe}.md`;
    fs.writeFileSync(path.join(knowledgeDir, fileName), md, 'utf-8');

    const fileKey = `knowledge/FAQ常见问题/${fileName}`;
    // id/时间 JS 侧生成；randomblob/datetime('now') 是 SQLite 专有，PG 下会 500
    const now = new Date();
    await this.feedbackRepository.manager.query(
      `INSERT INTO documents ("id", "title", "fileName", "fileKey", "fileSize", "mimeType", "category", "status", "visibility", "uploaderId", "parsedText", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 'text/markdown', 'knowledge/faq_selection', 'approved', 'public', $6, $7, $8, $9)`,
      [randomUUID(), title, fileName, fileKey, Buffer.byteLength(md), req.user?.id, md, now, now],
    );

    return { fileName };
  }

  @Get()
  async findAll(
    @Query() query: {
      messageId?: string;
      sessionId?: string;
      module?: string;
      page?: string;
      limit?: string;
    },
  ) {
    const page = parseInt(query.page || '1', 10);
    const limit = Math.min(parseInt(query.limit || '20', 10), 100);
    const where: any = {};
    if (query.messageId) where.messageId = query.messageId;
    if (query.sessionId) where.sessionId = query.sessionId;
    if (query.module) where.module = query.module;

    const [items, total] = await this.feedbackRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { items, total, page, limit };
  }

  @Get('stats')
  async getStats(@Query('module') module?: string) {
    const where: any = {};
    if (module) where.module = module;

    const all = await this.feedbackRepository.find({ where });
    const positive = all.filter((f) => f.rating === 'positive').length;
    const negative = all.filter((f) => f.rating === 'negative').length;
    const total = all.length;

    return {
      total,
      positive,
      negative,
      positiveRate: total > 0 ? Math.round((positive / total) * 100) : 0,
    };
  }
}
