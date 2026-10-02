/**
 * 命令行触发向量索引重建。
 *
 * 为什么需要它：重建原来只有一个入口 —— HTTP `POST /ai/index/reindex`，
 * 而那个接口要 JWT + admin 角色。切换 embedding 模型、修复解析逻辑之后
 * 都必须全量重建，这些都是运维动作，不该被"先登录再点按钮"卡住；
 * 排查问题时也需要一个能在终端里跑、能看到每类写入条数的入口。
 *
 * 这里走的是和 HTTP 接口**完全相同**的 ReindexService，
 * 不重复实现任何索引逻辑，行为与界面上点「重建」一致。
 *
 * 用法（在 backend 目录下）：
 *   npx ts-node -r tsconfig-paths/register scripts/reindex.ts              # 全部业务类型
 *   npx ts-node -r tsconfig-paths/register scripts/reindex.ts customer supplier
 *   npx ts-node -r tsconfig-paths/register scripts/reindex.ts knowledge    # 只重建知识资料
 *   npx ts-node -r tsconfig-paths/register scripts/reindex.ts all          # 业务 + 知识
 *
 * 知识资料单列一档：它的正文不落库（parsedText 存的是索引状态标记），
 * 只能重新读文件解析，走的是 DocumentsService.reindexKnowledge 那条路。
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ReindexService, REINDEXABLE_TYPES } from '../src/modules/ai/reindex.service';
import { DocumentsService } from '../src/modules/documents/documents.service';
import { CurrentUser } from '../src/common/services/permission.service';

/** 知识资料每批处理几份。解析 PDF 要整份读进内存，批太大容易把进程撑爆。 */
const KNOWLEDGE_BATCH = 3;

async function runKnowledge(app: any) {
  const docs = app.get(DocumentsService);
  // reindexKnowledge 的 user 参数只透传给 indexDocument，而后者并不使用它，
  // 这里给一个最小的系统身份即可。
  const sysUser = { userId: 'cli', isSystemAdmin: true, roles: ['admin'] } as unknown as CurrentUser;

  let indexed = 0, chunks = 0, skipped = 0, failed = 0, processed = 0;
  let offset = 0;
  for (let round = 0; round < 200; round++) {
    const r = await docs.reindexKnowledge(sysUser, {
      limit: KNOWLEDGE_BATCH,
      force: true,
      offset,
    });
    indexed += r.indexed;
    chunks += r.chunks;
    skipped += r.skipped;
    failed += r.failed;
    processed += r.processed;
    offset += r.processed;
    console.log(
      `  已处理 ${processed}/${r.total}  入库 ${indexed} 份 / ${chunks} 块  ` +
        `跳过 ${skipped}  失败 ${failed}  剩余 ${r.remaining}`,
    );
    if (r.remaining <= 0 || r.processed === 0) break;
  }
  return { indexed, chunks, skipped, failed };
}

async function bootstrap() {
  const args = process.argv.slice(2).filter(Boolean);
  const wantAll = args.includes('all');
  const wantKnowledge = wantAll || args.includes('knowledge');
  const types = args.filter((a) => a !== 'knowledge' && a !== 'all');

  const unknown = types.filter(
    (t) => !(REINDEXABLE_TYPES as readonly string[]).includes(t),
  );
  if (unknown.length) {
    console.error(`不支持重建的类型：${unknown.join('、')}`);
    console.error(`可选：${REINDEXABLE_TYPES.join('、')}、knowledge、all`);
    process.exit(1);
  }

  // logger 只留警告以上：重建会刷很多行，正常输出淹没在里面反而看不清结果
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  const reindex = app.get(ReindexService);
  const startedAt = Date.now();

  // 只点名 knowledge 时跳过业务对象重建
  const skipBusiness = wantKnowledge && !wantAll && types.length === 0;
  if (!skipBusiness) {
    console.log(`开始重建业务对象：${types.length ? types.join('、') : '全部类型'}`);
    const result = await reindex.reindex(types.length ? types : undefined);
    console.log('\n业务对象结果（-1 表示该类型失败，详见上面的错误日志）：');
    let total = 0;
    for (const [type, n] of Object.entries(result)) {
      console.log(`  ${type.padEnd(14)}${n}`);
      if (n > 0) total += n;
    }
    console.log(`  共写入 ${total} 个对象`);
  }

  if (wantKnowledge) {
    console.log('\n开始重建知识资料（重新读文件解析，较慢）：');
    const k = await runKnowledge(app);
    console.log(
      `  知识资料完成：入库 ${k.indexed} 份 / ${k.chunks} 块，` +
        `跳过 ${k.skipped}，失败 ${k.failed}`,
    );
  }

  console.log(`\n总耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

  const health = await reindex.getHealth();
  console.log('\n索引健康度：');
  console.log(`  ${'类型'.padEnd(12)}${'应索引'.padStart(8)}${'已索引'.padStart(8)}${'分块'.padStart(8)}`);
  for (const row of health.rows) {
    if (!row.expected && !row.indexed) continue;
    console.log(
      `  ${row.label.padEnd(12)}${String(row.expected).padStart(8)}` +
        `${String(row.indexed ?? '-').padStart(8)}${String(row.chunks ?? '-').padStart(8)}`,
    );
  }
  console.log(`  总分块：${health.totalChunks ?? '-'}`);

  await app.close();
  // AppModule 里挂着定时任务（质保到期扫描、自动备份）和文件监听，
  // 它们的 timer 会让事件循环一直不空，app.close() 之后进程仍然挂着不退。
  // 脚本跑完就该结束，显式退出。
  process.exit(0);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
