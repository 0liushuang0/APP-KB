import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import axios, { AxiosInstance } from 'axios';
import { AiCallLog } from '../../modules/ai/entities/ai-call-log.entity';

export interface Chunk {
  source_type: string;
  source_id: string;
  document_id?: string;
  content: string;
  permission_snapshot?: Record<string, any>;
}

export interface RagSearchResult {
  source_type: string;
  source_id: string;
  document_id?: string;
  content: string;
  score: number;
  permission_snapshot?: Record<string, any>;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private baseUrl: string;
  private client: AxiosInstance;

  constructor(
    private configService: ConfigService,
    @InjectRepository(AiCallLog)
    private callLogRepository: Repository<AiCallLog>,
  ) {
    this.baseUrl = this.configService.get<string>('app.aiServiceUrl');
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 60_000,
      headers: {
        'X-API-Key': this.configService.get<string>('app.aiServiceApiKey'),
      },
    });

    // ── 统一埋点：所有走 axios 的 AI 调用自动写入 ai_call_logs ──
    this.client.interceptors.request.use((config) => {
      (config as any).startedAt = Date.now();
      return config;
    });
    this.client.interceptors.response.use(
      (response) => {
        this.recordAxiosCall(response.config, true, response.data);
        return response;
      },
      (error) => {
        if (error?.config) {
          this.recordAxiosCall(error.config, false, error?.response?.data, error);
        }
        return Promise.reject(error);
      },
    );
  }

  /** 按端点路径推断业务模块（llm 调用优先取 body.module） */
  private moduleOf(path: string, body: any): string {
    if (body?.module) return String(body.module);
    if (path.startsWith('/llm')) return 'llm';
    if (path.startsWith('/rag')) return 'rag';
    if (path.startsWith('/embeddings')) return 'embedding';
    if (path.startsWith('/matching')) return 'matching';
    if (path.startsWith('/requirement')) return 'requirement';
    if (path.startsWith('/customers')) return 'customer-match';
    if (path.startsWith('/ai/solutions')) return 'solution-match';
    if (path.startsWith('/translate')) return 'translate';
    if (path.startsWith('/config')) return 'config';
    return 'other';
  }

  /**
   * 写入 AI 调用日志。fire-and-forget：日志失败绝不影响业务调用。
   * 健康检查（30s 轮询）不记录，避免刷爆日志表。
   */
  private logCall(opts: {
    endpoint: string;
    module?: string;
    input?: any;
    output?: any;
    durationMs: number;
    success: boolean;
    errorMessage?: string;
  }): void {
    try {
      if (opts.endpoint.startsWith('/health')) return;
      const usage = opts.output?.usage;
      const log = this.callLogRepository.create({
        traceId: randomUUID(),
        endpoint: opts.endpoint,
        module: opts.module || 'other',
        inputSummary: opts.input != null
          ? String(typeof opts.input === 'string' ? opts.input : JSON.stringify(opts.input)).slice(0, 800)
          : null,
        outputSummary: opts.output != null
          ? String(typeof opts.output === 'string' ? opts.output : JSON.stringify(opts.output)).slice(0, 800)
          : null,
        durationMs: Math.max(0, Math.round(opts.durationMs)),
        inputTokens: Number(usage?.prompt_tokens) || 0,
        outputTokens: Number(usage?.completion_tokens) || 0,
        success: opts.success,
        errorMessage: opts.errorMessage?.slice(0, 500) || null,
      });
      this.callLogRepository.save(log).catch((e) => {
        this.logger.warn(`Save AI call log failed: ${e?.message}`);
      });
    } catch (e: any) {
      this.logger.warn(`Record AI call log failed: ${e?.message}`);
    }
  }

  private recordAxiosCall(config: any, success: boolean, data: any, error?: any): void {
    const path = config?.url || '';
    if (path.startsWith('/health')) return;
    let body: any;
    try {
      body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    } catch {
      body = undefined;
    }
    this.logCall({
      endpoint: path,
      module: this.moduleOf(path, body),
      input: body,
      output: data,
      durationMs: Date.now() - ((config as any).startedAt || Date.now()),
      success,
      errorMessage: error?.message,
    });
  }

  /**
   * 健康检查。
   *
   * 原来无论什么错都回一句"AI 服务未连接"，但这三种情况的处理方式完全不同：
   *   · 连不上   → 去启动 AI 服务
   *   · 401/403  → 两边共享密钥不一致，重启 AI 服务让它读到新 .env
   *   · 其他     → 看 AI 服务日志
   * 单机产品没有运维，用户只能照着这句话排查，说错了就是把人引到沟里。
   */
  async health(): Promise<{
    online: boolean;
    service: string;
    message?: string;
    reason?: 'offline' | 'unauthorized' | 'error';
  }> {
    try {
      const response = await this.client.get('/health/', { timeout: 3_000 });
      return { online: response.data?.status === 'ok', service: 'ai-service' };
    } catch (error) {
      const status = error?.response?.status;

      if (status === 401 || status === 403) {
        this.logger.error(
          `AI 服务拒绝了后端的凭据（HTTP ${status}）—— ` +
            'backend/.env 的 AI_SERVICE_API_KEY 与 ai-service/.env 的 API_KEY 不一致。' +
            '后端启动时会自动同步，重启 AI 服务即可生效。',
        );
        return {
          online: false,
          service: 'ai-service',
          reason: 'unauthorized',
          message: 'AI 服务密钥不匹配：后端已自动同步密钥，请重启 AI 服务',
        };
      }

      this.logger.warn(`AI health check failed: ${error?.message || 'unknown error'}`);
      return {
        online: false,
        service: 'ai-service',
        reason: status ? 'error' : 'offline',
        message: status ? `AI 服务返回异常（HTTP ${status}）` : 'AI 服务未启动或无法连接',
      };
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    try {
      const res = await this.client.post('/embeddings/', { texts });
      return res.data.embeddings;
    } catch (err) {
      this.logger.error('Embed request failed', err?.message);
      return texts.map(() => new Array(768).fill(0));
    }
  }

  /**
   * 写入分块。
   *
   * @param throwOnError 默认吞掉异常（业务保存不该因为索引失败而回滚）；
   *   全量重建必须传 true —— 否则写失败也只在日志里留一行，重建结果照样报"成功 N 条"，
   *   实际一条没进去（本机就踩过：报 195 条客户，向量库里是 0）。
   */
  async addChunks(
    chunks: Chunk[],
    throwOnError = false,
  ): Promise<{ indexed: number; skipped: number }> {
    if (!chunks.length) return { indexed: 0, skipped: 0 };
    try {
      const res = await this.client.post('/rag/chunks', { chunks });
      /*
       * 用 AI 服务返回的**实际入库数**，不要拿提交数当结果。
       * AI 侧会在入库前挡掉解析失败的内容（二进制残留、乱码、逐字换行），
       * 提交 655 块、真正进库 495 块是常态。报提交数会让界面显示
       * "成功索引 655 个文本块"，而检索里根本没有那 160 块。
       */
      return {
        indexed: Number(res.data?.count ?? chunks.length),
        skipped: Number(res.data?.skipped ?? 0),
      };
    } catch (err) {
      this.logger.error('Add chunks request failed', err?.message);
      if (throwOnError) {
        const detail = (err as any)?.response?.data?.detail;
        throw new Error(
          `写入向量库失败：${typeof detail === 'string' ? detail : err?.message || '未知错误'}`,
        );
      }
      return { indexed: 0, skipped: chunks.length };
    }
  }

  /**
   * 对「瞬时」错误重试：连接被重置、超时、5xx（AI 服务正在重启/加载模型/排队）。
   * 运行日志里文档解析成功率只有 60%，失败几乎都是这几类，隔几秒再试多半就好；
   * 422（文件本身解析不了）和 4xx 是确定性结果，不重试。
   */
  private async postWithRetry(url: string, body: unknown, attempts = 3): Promise<any> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await this.client.post(url, body);
      } catch (err) {
        lastErr = err;
        const status = (err as any)?.response?.status as number | undefined;
        const code = (err as any)?.code as string | undefined;
        const transient =
          (status === undefined && (code === 'ECONNRESET' || code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED')) ||
          (status !== undefined && status >= 500);
        if (!transient || i === attempts - 1) break;
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      }
    }
    throw lastErr;
  }

  async parseFile(filename: string, base64Content: string): Promise<string> {
    return (await this.parseFileDetailed(filename, base64Content)).text;
  }

  /**
   * 解析文件，并带回"为什么解析不了"。
   *
   * AI 服务用 422 表达可操作的失败原因（旧版 .doc、不支持的类型、扫描件无文字层），
   * 这些话是写给用户看的、能照着做的。原来一律吞掉只返回空串，调用方只能统一
   * 报"扫描件或图片型PDF"，把"格式不对""类型不支持"也说成扫描件，把人往沟里带。
   */
  async parseFileDetailed(
    filename: string,
    base64Content: string,
  ): Promise<{ text: string; error?: string; transient?: boolean }> {
    try {
      const res = await this.postWithRetry('/embeddings/parse', {
        filename,
        content: base64Content,
      });
      return { text: res.data?.text || '' };
    } catch (err) {
      const status = (err as any)?.response?.status;
      const detail = (err as any)?.response?.data?.detail;
      if (status === 422 && typeof detail === 'string') {
        this.logger.warn(`Parse rejected: ${filename} - ${detail}`);
        return { text: '', error: detail };
      }
      this.logger.error('Parse file request failed', err?.message);
      return { text: '', error: 'AI 服务解析失败，请稍后重试', transient: true };
    }
  }

  async deleteChunks(sourceType: string, sourceId: string): Promise<void> {
    try {
      await this.client.post('/rag/delete-by-source', {
        source_type: sourceType,
        source_id: sourceId,
      });
    } catch (err) {
      this.logger.error('Delete chunks request failed', err?.message);
    }
  }

  /**
   * 清空某一类的全部向量。
   *
   * 与 deleteChunks 不同，这里不吞异常：全量重建的第一步就是清空，
   * 清空失败却继续写入，只会得到"新旧混杂"的索引，比重建前更糟。
   */
  async purgeSourceType(sourceType: string): Promise<number> {
    const res = await this.client.post('/rag/purge-source-type', {
      source_type: sourceType,
    });
    return Number(res.data?.deleted || 0);
  }

  /** 索引健康度：各 source_type 已索引的分块数 / 对象数 */
  async getIndexStats(): Promise<{
    by_source_type: Record<string, { chunks: number; objects: number }>;
    total_chunks: number;
    total_objects: number;
  }> {
    const res = await this.client.get('/rag/stats');
    return res.data;
  }

  /**
   * 知识库检索。
   *
   * 走 /rag/hybrid-search（向量 + 关键词加权融合），而不是纯向量的 /rag/search。
   * 纯向量这条路对"精确词"是瞎的 —— 产品型号 BJ125D、报价单号、客户单位全称
   * 这类查询，靠的就是关键词侧命中；只要 embedding 稍有偏差就整条检索不到。
   * 混合检索早就实现好了（rag.py hybrid_search），只是一直没有人调用它。
   */
  async searchRag(
    query: string,
    sourceTypes?: string[],
    topK = 5,
  ): Promise<RagSearchResult[]> {
    try {
      // 不传权重：让 AI 服务按查询形态自适应（编号型查询关键词优先，
      // 自然语言向量优先）。写死权重会把这套逻辑架空。
      const res = await this.client.post('/rag/hybrid-search', {
        query,
        source_types: sourceTypes,
        top_k: topK,
      });
      return res.data.results || [];
    } catch (err) {
      this.logger.error('RAG search request failed', err?.message);
      return [];
    }
  }

  async chat(
    messages: { role: string; content: string }[],
    module = 'default',
  ): Promise<string> {
    try {
      const res = await this.client.post('/llm/chat', {
        messages,
        module,
      });
      return res.data.content || '';
    } catch (err) {
      this.logger.error('LLM chat request failed', err?.message);
      return 'AI 服务暂时不可用';
    }
  }

  async summarize(text: string, module = 'document'): Promise<string> {
    const messages = [
      {
        role: 'system',
        content:
          '请用中文总结以下内容，保留关键业务信息，长度控制在200字以内。',
      },
      { role: 'user', content: text },
    ];
    return this.chat(messages, module);
  }

  async generateProposal(requirements: string, context = ''): Promise<string> {
    const messages = [
      {
        role: 'system',
        content:
          '你是博亚精工售前方案专家。请仅根据客户需求和参考资料生成专业技术方案（Markdown 格式）；关键参数和历史结论使用 [1]、[2] 标注来源。资料不足时列出待确认项，不得编造设备参数、价格和交期。',
      },
      {
        role: 'user',
        content: `客户需求：${requirements}\n\n参考资料：\n${context}`,
      },
    ];
    return this.chat(messages, 'proposal');
  }

  async suggestQuotation(
    requirements: string,
    context = '',
  ): Promise<string> {
    const messages = [
      {
        role: 'system',
        content:
          '你是博亚精工报价顾问。请仅根据客户需求和参考资料给出报价建议，包括成本构成和总价估算；事实依据使用 [1]、[2] 标注。资料不足时明确列出缺项，不得编造价格、成本和交期。\n' +
          '在建议正文之后，额外用 ```json``` 代码块输出建议的报价明细行（数组，每项包含 name 品名、specification 规格、quantity 数量、unit 单位、unitPrice 单价；无法确定价格时 unitPrice 填 0），代码块内不要包含任何其他文字。',
      },
      {
        role: 'user',
        content: `客户需求：${requirements}\n\n参考资料：\n${context}`,
      },
    ];
    return this.chat(messages, 'quotation');
  }

  /**
   * RAG 问答。
   *
   * pageContext（页面助手送来的"用户此刻看到什么"）单独传，不要自己拼进 context。
   * 拼在一起后模型分不清哪一部分带编号，很容易把页面内容也标成 [1]，
   * 而前端是按 sources[n-1] 找对应记录的 —— 点 [1] 会跳到毫不相干的数据上。
   */
  async ragChat(
    query: string,
    context: string,
    history: { role: 'user' | 'assistant'; content: string }[] = [],
    pageContext?: string,
  ): Promise<string> {
    try {
      const res = await this.client.post('/llm/rag-chat', {
        query,
        context,
        page_context: pageContext ? pageContext.slice(0, 20_000) : '',
        module: 'default',
        history: history.slice(-12),
      });
      return res.data.content || '';
    } catch (err) {
      this.logger.error('RAG chat request failed', err?.message);
      return 'AI 服务暂时不可用';
    }
  }

  /**
   * 流式 RAG 问答：逐 token 回调。
   *
   * 调用 AI 服务的 /llm/rag-chat?stream=true，
   * 解析 SSE 响应，每个 token 通过 onToken 回调推送。
   */
  async ragChatStream(
    query: string,
    context: string,
    history: { role: 'user' | 'assistant'; content: string }[] = [],
    onToken: (token: string) => void,
    pageContext?: string,
  ): Promise<void> {
    const startedAt = Date.now();
    try {
      await this.doRagChatStream(query, context, history, onToken, pageContext);
      this.logCall({
        endpoint: '/llm/rag-chat(stream)',
        module: 'default',
        input: { query },
        durationMs: Date.now() - startedAt,
        success: true,
      });
    } catch (err: any) {
      this.logCall({
        endpoint: '/llm/rag-chat(stream)',
        module: 'default',
        input: { query },
        durationMs: Date.now() - startedAt,
        success: false,
        errorMessage: err?.message,
      });
      throw err;
    }
  }

  private async doRagChatStream(
    query: string,
    context: string,
    history: { role: 'user' | 'assistant'; content: string }[] = [],
    onToken: (token: string) => void,
    pageContext?: string,
  ): Promise<void> {
    const http = require('http');
    const url = new URL(`${this.baseUrl}/llm/rag-chat`);

    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        query,
        context,
        page_context: pageContext ? pageContext.slice(0, 20_000) : '',
        module: 'default',
        stream: true,
        history: history.slice(-12),
      });

      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.configService.get<string>('app.aiServiceApiKey'),
          'Content-Length': Buffer.byteLength(postData),
        },
      };

      const req = http.request(options, (res: any) => {
        if (res.statusCode !== 200) {
          reject(new Error(`AI service returned ${res.statusCode}`));
          return;
        }

        let buffer = '';
        let done = false;

        /**
         * 解析一行 SSE。
         *
         * AI 服务侧的 data 字段是 JSON（{"t":"…"}），不是裸 token —— 裸 token 里
         * 的换行会把一帧撑成多行，除第一行外全部对不上 "data: " 前缀而被丢弃，
         * 表现为回答缺字缺段。JSON 转义后帧内不含裸换行，按行切分才成立。
         *
         * 逐行 trim 是安全的：真正的内容在 JSON 字符串里，首尾空格不会被吃掉。
         */
        const handleLine = (line: string): void => {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) return;
          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            done = true;
            return;
          }
          try {
            const payload = JSON.parse(data);
            const token = payload?.t;
            if (typeof token === 'string' && token) onToken(token);
          } catch {
            // 非 JSON 行忽略：正常情况下不会出现，出现了也不该把整个回答打断
          }
        };

        res.on('data', (chunk: Buffer) => {
          if (done) return;
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            handleLine(line);
            if (done) {
              resolve();
              return;
            }
          }
        });

        res.on('end', () => {
          // 处理缓冲区剩余数据
          if (!done && buffer.trim()) handleLine(buffer);
          resolve();
        });

        res.on('error', reject);
      });

      req.on('error', (err: any) => {
        this.logger.error('RAG stream request failed', err?.message);
        onToken('AI 服务暂时不可用');
        resolve();
      });

      req.setTimeout(120_000, () => {
        req.destroy();
        onToken('请求超时');
        resolve();
      });

      req.write(postData);
      req.end();
    });
  }

  async getLlmConfig(): Promise<any> {
    try {
      const res = await this.client.get('/config');
      return res.data;
    } catch (err) {
      this.logger.error('Get LLM config failed', err?.message);
      throw err;
    }
  }

  async updateLlmConfig(config: any): Promise<any> {
    try {
      const res = await this.client.put('/config', config);
      return res.data;
    } catch (err) {
      this.logger.error('Update LLM config failed', err?.message);
      throw err;
    }
  }

  async getEngineTemplates(): Promise<any> {
    try {
      const res = await this.client.get('/config/engine-templates');
      return res.data;
    } catch (err) {
      this.logger.error('Get engine templates failed', err?.message);
      throw err;
    }
  }

  async analyzeRequirement(
    title: string,
    description: string,
    rawTexts: string[],
  ): Promise<any> {
    try {
      const res = await this.client.post('/matching/analyze', {
        title,
        description,
        raw_texts: rawTexts,
      });
      return res.data;
    } catch (err) {
      this.logger.error('Analyze requirement failed', err?.message);
      return { spec: {}, summary: 'AI分析服务暂时不可用', confidence: 0 };
    }
  }

  async findSimilar(
    query: string,
    sourceTypes?: string[],
    topK = 10,
    customerId?: string,
  ): Promise<any> {
    try {
      const res = await this.client.post('/matching/similar', {
        query,
        source_types: sourceTypes,
        top_k: topK,
        customer_id: customerId,
      });
      return res.data;
    } catch (err) {
      this.logger.error('Find similar failed', err?.message);
      return { total: 0, results: [], grouped: {} };
    }
  }

  async paramDiff(current: any, historical: any): Promise<any> {
    try {
      const res = await this.client.post('/matching/param-diff', {
        current,
        historical,
      });
      return res.data;
    } catch (err) {
      this.logger.error('Param diff failed', err?.message);
      return { matches: [], differences: [], similarity: 0 };
    }
  }

  async structureRequirement(
    title: string,
    description: string,
    sources: any[],
  ): Promise<any> {
    try {
      // 资料长、走大模型时常要 40–90 秒；默认 60 秒超时会把正常的识别判成"服务不可用"
      const res = await this.client.post('/requirement/structure', {
        title,
        description,
        sources,
      }, { timeout: 180_000 });
      return res.data;
    } catch (err) {
      this.logger.error('Structure requirement failed', err?.message);
      return { card: {}, error: '需求结构化服务暂时不可用' };
    }
  }

  /**
   * 根据需求卡的缺失字段生成补问话术（微信 / 邮件两套）。
   * 对应 AI 服务 requirement_engine.engine.gen_followup_draft。
   */
  async followupDraft(card: any, customer = '客户'): Promise<any> {
    try {
      const res = await this.client.post('/requirement/followup-draft', {
        card,
        customer,
      });
      return res.data;
    } catch (err) {
      this.logger.error('Follow-up draft failed', err?.message);
      return { wechat: '', email: '', error: '补问草稿服务暂时不可用' };
    }
  }

  /** 获取内置参数模板列表（产品大类 + 字段定义） */
  async getRequirementTemplates(): Promise<any> {
    try {
      const res = await this.client.get('/requirement/templates');
      return res.data;
    } catch (err) {
      this.logger.error('Fetch requirement templates failed', err?.message);
      return { templates: [] };
    }
  }

  /**
   * 相似客户匹配：基于客户画像在已索引的客户知识库中检索相似客户。
   * 对应 AI 服务 /customers/similar。
   */
  async findSimilarCustomers(payload: {
    customer_id: string;
    name: string;
    industry?: string;
    scale?: string;
    products?: string[];
    requirements?: string[];
    purchase_history?: string[];
    top_k?: number;
  }): Promise<any> {
    try {
      const res = await this.client.post('/customers/similar', payload);
      return res.data;
    } catch (err) {
      this.logger.error('Find similar customers failed', err?.message);
      return { error: '相似客户匹配服务暂时不可用', similar_customers: [], total: 0 };
    }
  }

  /**
   * 交叉销售分析：基于采购历史推荐配套产品。
   * 对应 AI 服务 /customers/cross-sell。
   */
  async analyzeCrossSell(customerId: string, purchaseHistory: string[]): Promise<any> {
    try {
      const res = await this.client.post('/customers/cross-sell', {
        customer_id: customerId,
        purchase_history: purchaseHistory,
      });
      return res.data;
    } catch (err) {
      this.logger.error('Cross-sell analysis failed', err?.message);
      return { error: '交叉销售分析服务暂时不可用', recommendations: [], total_opportunities: 0 };
    }
  }

  /** 方案匹配解释：针对某条需求与候选方案，给出推荐亮点与风险关注点 */
  async explainSolutionMatch(
    requirement: Record<string, any>,
    solution: Record<string, any>,
  ): Promise<{ highlights: string[]; risks: string[] }> {
    try {
      const res = await this.client.post('/ai/solutions/match-explanation', {
        requirement,
        solution,
      });
      return res.data;
    } catch (err) {
      this.logger.error('Match explanation failed', err?.message);
      return { highlights: [], risks: ['方案分析服务暂时不可用，请稍后重试'] };
    }
  }
}
