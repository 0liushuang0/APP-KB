import { Injectable } from '@nestjs/common';
import { AiService } from '../../common/services/ai.service';
import {
  PermissionService,
  CurrentUser,
} from '../../common/services/permission.service';
import { SearchPermissionService } from './search-permission.service';
import { PromptGuardService } from './prompt-guard.service';

export interface SearchResult {
  source_type: string;
  source_id: string;
  document_id?: string;
  content: string;
  score: number;
  permission_snapshot?: Record<string, any>;
}

@Injectable()
export class SearchService {
  constructor(
    private aiService: AiService,
    private permissionService: PermissionService,
    private searchPermissionService: SearchPermissionService,
    private promptGuard: PromptGuardService,
  ) {}

  async search(
    query: string,
    sourceTypes: string[],
    user: CurrentUser,
  ): Promise<SearchResult[]> {
    const results = await this.aiService.searchRag(query, sourceTypes, 50);
    return results
      .filter((r) => this.searchPermissionService.canAccessResult(r, user))
      .slice(0, 10);
  }

  async chat(
    query: string,
    sourceTypes: string[],
    user: CurrentUser,
    history: { role: 'user' | 'assistant'; content: string }[] = [],
    /**
     * 页面上下文：调用方（页面内的 AI 助手）把"用户此刻在看什么"一并送来 ——
     * 当前筛选条件、这一页的记录、选中的那条。没有它，助手只能做全库检索，
     * 答的和用户眼前看到的对不上（"就回答本页信息"根本无从谈起）。
     */
    pageContext?: string,
  ) {
    /*
     * Prompt 注入防护（OWASP LLM01）：
     * - 用户输入：检测常见注入模式（"忽略指令""角色伪装""提取提示词"等），
     *   命中则包裹为数据段而非指令段，隔离执行上下文
     * - 对话历史：批量对 user 消息做同样检查
     * - AI 输出：回答生成后检测泄露模式（提示词复述/连接串/密钥），命中则脱敏
     */
    const injection = this.promptGuard.detectInjection(query);
    const guardedQuery = injection ? injection.guarded : query;
    const safeHistory = this.promptGuard.guardHistory(
      history
        .filter((item) => item?.content && ['user', 'assistant'].includes(item.role))
        .slice(-12),
    ) as { role: 'user' | 'assistant'; content: string }[];
    const recentUserContext = safeHistory
      .filter((item) => item.role === 'user')
      .slice(-3)
      .map((item) => item.content)
      .join('；');
    const retrievalQuery = recentUserContext ? `${recentUserContext}；${guardedQuery}` : guardedQuery;
    const results = await this.search(retrievalQuery, sourceTypes, user);

    // 有页面上下文时，即使检索为空也能作答（问题往往就针对眼前这一页）
    if (!results.length && !pageContext) {
      return {
        answer: '当前知识库中没有找到足够依据。请补充产品型号、关键参数、客户名称或相关资料后再试。',
        sources: [],
        grounded: false,
      };
    }
    const retrieved = results
      .map((r, index) => `[${index + 1}] [${r.source_type}:${r.source_id}] ${r.content}`)
      .join('\n\n');
    /*
     * 页面上下文单独传给 AI 服务，不再拼进 context。
     *
     * 原来是拼成「【当前页面内容】…【知识库检索结果】…」一整段送过去的，
     * 但提示词里从没说明这两段的区别 —— 模型不知道哪段带编号，
     * 常把页面内容也标成 [1]，而前端按 sources[n-1] 找记录，
     * 用户点 [1] 就跳到一条不相干的数据上。
     * 拆开传之后，编号只属于检索结果，页面内容一律引用为「本页」。
     *
     * 顺带截断：pageContext 由前端各页自行拼装，没有长度约束；
     * 太长会把 AI 服务的 context 撑过 50000 上限直接 422，
     * 用户看到的是"AI 服务暂时不可用"，而不是"内容太长"。
     */
    const rawAnswer = await this.aiService.ragChat(
      guardedQuery,
      retrieved,
      safeHistory,
      pageContext ? pageContext.slice(0, 8_000) : undefined,
    );
    const outputLeak = this.promptGuard.guardOutput(rawAnswer);
    const answer = outputLeak ? outputLeak.guarded : rawAnswer;
    return {
      answer,
      grounded: true,
      sources: results.map((r) => ({
        sourceType: r.source_type,
        sourceId: r.source_id,
        content: r.content,
        score: r.score,
        documentId: r.document_id,
      })),
    };
  }

  /**
   * 流式问答：先做 RAG 检索，再流式调用 LLM。
   *
   * 通过 callback 逐 token 推送：
   *   { type: 'sources', sources: [...] }
   *   { type: 'token', content: '你' }
   *   { type: 'token', content: '好' }
   *   { type: 'done' }
   */
  async chatStream(
    query: string,
    sourceTypes: string[],
    user: CurrentUser,
    history: { role: 'user' | 'assistant'; content: string }[] = [],
    onEvent: (event: any) => void,
    /**
     * 页面上下文。与非流式的 chat() 保持同一套语义 ——
     * 页面助手改走流式后，如果这条路不认 pageContext，
     * 助手就退化成全库检索，"只回答本页内容"又不成立了。
     */
    pageContext?: string,
  ): Promise<void> {
    const safeHistory = this.promptGuard.guardHistory(
      history
        .filter((item) => item?.content && ['user', 'assistant'].includes(item.role))
        .slice(-12),
    ) as { role: 'user' | 'assistant'; content: string }[];
    const recentUserContext = safeHistory
      .filter((item) => item.role === 'user')
      .slice(-3)
      .map((item) => item.content)
      .join('；');
    const injection = this.promptGuard.detectInjection(query);
    const guardedQuery = injection ? injection.guarded : query;
    const retrievalQuery = recentUserContext ? `${recentUserContext}；${guardedQuery}` : guardedQuery;
    const results = await this.search(retrievalQuery, sourceTypes, user);

    // 先推送来源
    onEvent({
      type: 'sources',
      sources: results.map((r) => ({
        sourceType: r.source_type,
        sourceId: r.source_id,
        content: r.content,
        score: r.score,
        documentId: r.document_id,
      })),
    });

    // 有页面上下文时，检索为空也能作答（问题往往就针对眼前这一页）——
    // 与 chat() 的判断保持一致，否则同一个问题在流式和非流式下表现不同。
    if (!results.length && !pageContext) {
      onEvent({ type: 'token', content: '当前知识库中没有找到足够依据。请补充产品型号、关键参数、客户名称或相关资料后再试。' });
      onEvent({ type: 'done' });
      return;
    }

    const context = results
      .map((r, index) => `[${index + 1}] [${r.source_type}:${r.source_id}] ${r.content}`)
      .join('\n\n');

    // 流式调用 LLM（输入侧已过 prompt guard；输出侧由非流式 chat() 的 guardOutput 覆盖）
    await this.aiService.ragChatStream(
      guardedQuery,
      context,
      safeHistory,
      (token: string) => {
        onEvent({ type: 'token', content: token });
      },
      pageContext ? pageContext.slice(0, 8_000) : undefined,
    );

    onEvent({ type: 'done' });
  }
}
