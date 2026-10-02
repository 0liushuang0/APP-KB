import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AiService } from '../../common/services/ai.service';

@ApiTags('智能匹配')
@Controller('matching')
export class MatchingController {
  constructor(private readonly aiService: AiService) {}

  @Post('similar')
  findSimilar(
    @Body() body: {
      query: string;
      source_types?: string[];
      top_k?: number;
      customer_id?: string;
    },
  ) {
    return this.aiService.findSimilar(
      body.query,
      body.source_types,
      body.top_k || 10,
      body.customer_id,
    );
  }

  @Post('param-diff')
  paramDiff(
    @Body() body: { current: any; historical: any },
  ) {
    return this.aiService.paramDiff(body.current, body.historical);
  }

  @Post('analyze')
  analyze(
    @Body() body: {
      title: string;
      description: string;
      raw_texts: string[];
    },
  ) {
    return this.aiService.analyzeRequirement(
      body.title,
      body.description,
      body.raw_texts,
    );
  }
}
