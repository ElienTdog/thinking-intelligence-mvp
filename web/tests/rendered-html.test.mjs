import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canWriteDelta, isCompilableRawSource, rankKnowledgeCards, validateClipPayload, validateDeltaPayload, validateFeedEventPayload, validateLearningAttemptPayload, validateWikiQueryPayload } from "../app/lib/validation.mjs";


test("declares the private Alpha sign-in boundary", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /PRIVATE ALPHA/);
  assert.match(page, /使用 ChatGPT 登录/);
  assert.match(page, /chatGPTSignInPath/);
});

test("does not retain the starter preview in product sources", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(page, /JudgmentWorkbench/);
  assert.match(page, /force-dynamic/);
  assert.match(page, /requestedCapture/);
  assert.match(layout, /思考情报台/);
  assert.match(page, /本地 Wiki/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("rejects an empty or unknown judgment response", () => {
  assert.ok(validateDeltaPayload({ questionId: "q", materialId: "m", responseType: "park", responseText: "" }).error);
  assert.ok(validateDeltaPayload({ questionId: "q", materialId: "m", responseType: "invented", responseText: "because" }).error);
});

test("requires a validation scenario for real-world verification", () => {
  assert.match(validateDeltaPayload({ questionId: "q", materialId: "m", responseType: "validate_in_context", responseText: "test it" }).error, /validationScenario/);
  assert.deepEqual(validateDeltaPayload({ questionId: "q", materialId: "m", responseType: "validate_in_context", responseText: "test it", validationScenario: "next interview" }).value, { questionId: "q", materialId: "m", responseType: "validate_in_context", responseText: "test it", validationScenario: "next interview" });
});

test("captures raw material with generated metadata and no required form fields", async () => {
  assert.match(validateClipPayload({ content: "" }).error, /content/);
  assert.match(validateClipPayload({ content: "[URL]" }).error, /快捷指令/);
  assert.deepEqual(
    validateClipPayload({ content: "https://www.example.com/post" }).value,
    { content: "https://www.example.com/post", sourceTitle: "example.com", sourceUrl: "https://www.example.com/post" },
  );
  assert.deepEqual(
    validateClipPayload({ content: "一个还没想清楚的判断\n先留下来" }).value,
    { content: "一个还没想清楚的判断\n先留下来", sourceTitle: "一个还没想清楚的判断", sourceUrl: "" },
  );
  const dashboard = await readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /收录剪贴板/);
  assert.doesNotMatch(dashboard, /标题（可选）|来源链接（可选）/);
});

test("keeps unverifiable and transcript-free raw sources out of the compiler", () => {
  assert.equal(isCompilableRawSource({ content: "https://video.example", sourceUrl: "https://video.example", sourceType: "video", rawExcerpt: "" }), false);
  assert.equal(isCompilableRawSource({ content: "https://article.example", sourceUrl: "https://article.example", sourceType: "article", rawExcerpt: "" }), false);
  assert.equal(isCompilableRawSource({ content: "可靠的主动收录文本", sourceUrl: "", sourceType: "text", rawExcerpt: "可靠的主动收录文本" }), true);
});

test("requires a real page and user response for a recall attempt", () => {
  assert.ok(validateLearningAttemptPayload({ pageId: "", promptType: "recall", response: "我记得" }).error);
  assert.ok(validateLearningAttemptPayload({ pageId: "page", promptType: "invented", response: "我记得" }).error);
  assert.deepEqual(
    validateLearningAttemptPayload({ pageId: "page", promptType: "transfer", response: "下次评审时试一次" }).value,
    { pageId: "page", promptType: "transfer", response: "下次评审时试一次" },
  );
});

test("requires a real question before filing a Wiki query", () => {
  assert.ok(validateWikiQueryPayload({ question: "" }).error);
  assert.deepEqual(validateWikiQueryPayload({ question: "这和我正在做的产品有什么关系？" }).value, { question: "这和我正在做的产品有什么关系？" });
});

test("ranks unseen cards ahead of muted cards and validates feedback", () => {
  const cards = [
    { id: "new", tags: '["AI"]', createdAt: new Date().toISOString(), storyId: null },
    { id: "muted", tags: '["AI"]', createdAt: new Date().toISOString(), storyId: null },
  ];
  const ranked = rankKnowledgeCards(cards, [{ cardId: "muted", eventType: "less_like" }]);
  assert.equal(ranked[0].id, "new");
  assert.ok(validateFeedEventPayload({ cardId: "card", eventType: "saved" }).value);
  assert.ok(validateFeedEventPayload({ cardId: "card", eventType: "invented" }).error);
});

test("prioritizes followed creators while preserving feedback-driven ranking", () => {
  const cards = [
    { id: "generic", tags: '["AI"]', sourceName: "普通资讯", createdAt: new Date().toISOString(), storyId: null },
    { id: "khazix", tags: '["creator:数字生命卡兹克"]', sourceName: "数字生命卡兹克", createdAt: new Date().toISOString(), storyId: null },
  ];
  assert.equal(rankKnowledgeCards(cards, [])[0].id, "khazix");
  assert.equal(rankKnowledgeCards(cards, [{ cardId: "khazix", eventType: "less_like" }])[0].id, "generic");
});

test("makes missing followed-creator material visible instead of disguising it as a generic recommendation", async () => {
  const [feed, css] = await Promise.all([
    readFile(new URL("../app/knowledge-feed.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(feed, /还没有已同步的卡兹克、赛博禅心或 MacTalk 文章/);
  assert.match(feed, /查看收件箱与同步状态/);
  assert.match(css, /\.followed-creator-empty/);
  assert.match(css, /\.raw-head \{ align-items:flex-start; flex-wrap:wrap; \}/);
  assert.match(css, /\.raw-card footer \{ display:grid/);
});

test("declares the owner-scoped feed and local Wiki mirror surfaces", async () => {
  const [schema, migration, localKnowledgeMigration, workspace, worker, feedRoute, eventRoute, runRoute, deleteRoute, dashboard, knowledgeFeed, wikiRoute, wikiQueryRoute, wikiModel, wikiSchema, inboxRoute, mirrorRoute, knowledgeMirrorRoute, syncStatusRoute, tokenRoute] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0003_exotic_whirlwind.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0005_local_wiki_knowledge_pages.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/knowledge-workspace.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/feed/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/feed-events/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/injection/run/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/clips/[clipId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/knowledge-feed.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/wiki/lint/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/wiki/query/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/wiki.ts", import.meta.url), "utf8"),
    readFile(new URL("../LLM_WIKI_SCHEMA.md", import.meta.url), "utf8"),
    readFile(new URL("../app/api/local-sync/inbox/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/local-sync/mirror/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/local-sync/knowledge/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/local-sync/status/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/local-sync/token/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(schema, /source_feeds/);
  assert.match(schema, /knowledge_cards/);
  assert.match(schema, /feed_events/);
  assert.match(schema, /injection_runs/);
  assert.match(schema, /wiki_pages/);
  assert.match(schema, /wiki_links/);
  assert.match(schema, /wiki_page_sources/);
  assert.match(schema, /wiki_activity/);
  assert.match(schema, /learning_attempts/);
  assert.match(schema, /wikiSyncTokens/);
  assert.match(schema, /localPath: text\("local_path"\)/);
  assert.match(localKnowledgeMigration, /wiki_pages.*local_path/s);
  assert.match(migration, /wiki_pages/);
  assert.match(migration, /wiki_links/);
  assert.match(migration, /wiki_page_id/);
  assert.match(workspace, /数字生命卡兹克|赛博禅心|量子位|Datawhale/);
  assert.match(workspace, /aihotCreatorUrl/);
  assert.match(workspace, /MacTalk/);
  assert.match(worker, /Local Markdown is the write authority/);
  assert.doesNotMatch(worker, /runDailyInjection/);
  assert.match(feedRoute, /knowledgeCards\.ownerId/);
  assert.match(eventRoute, /knowledgeCards\.ownerId/);
  assert.match(runRoute, /DEEPSEEK_API_KEY/);
  assert.match(dashboard, /KnowledgeFeed/);
  assert.match(dashboard, /surface-track/);
  assert.match(dashboard, /onTouchMove/);
  assert.match(dashboard, /\/api\/learning-attempts/);
  assert.match(dashboard, /\/api\/wiki\/lint/);
  assert.match(dashboard, /\/api\/wiki\/query/);
  assert.match(dashboard, /已刷新本地 Wiki 的在线镜像/);
  assert.doesNotMatch(dashboard, /requestJson\("\/api\/injection\/run", \{\}\)/);
  assert.match(dashboard, /连接本地 Wiki/);
  assert.match(dashboard, /在线阅读/);
  assert.match(dashboard, /surface === "raw" && direction === "right"/);
  assert.match(dashboard, /surface === "story" && direction === "left"/);
  assert.match(dashboard, /surface === "raw" \? "is-current"/);
  assert.match(dashboard, /requestJson\(`\/api\/clips\/\$\{clip\.id\}`, undefined, "DELETE"\)/);
  assert.match(deleteRoute, /knowledgeCards\.ownerId/);
  assert.match(deleteRoute, /feedEvents/);
  assert.match(deleteRoute, /dailyStories/);
  assert.match(deleteRoute, /wikiPages/);
  assert.match(knowledgeFeed, /ReviewMomentView/);
  assert.match(knowledgeFeed, /在 Wiki 里/);
  assert.match(knowledgeFeed, /knowledge-cover/);
  assert.match(knowledgeFeed, /KnowledgeCover/);
  assert.match(knowledgeFeed, /onError=\{\(\) => setUnavailable\(true\)\}/);
  assert.match(knowledgeFeed, /compactHook/);
  assert.match(wikiRoute, /getWikiLint/);
  assert.match(wikiQueryRoute, /queryWiki/);
  assert.match(wikiModel, /refreshTopicIndexes/);
  assert.match(wikiModel, /supports.*contradicts|contradicts.*supports/);
  assert.match(wikiSchema, /Raw layer/);
  assert.match(wikiSchema, /Story Mode/);
  assert.match(wikiSchema, /append-only/);
  assert.match(inboxRoute, /processing_status IN \('inbox', 'needs_clipper'\)/);
  assert.match(mirrorRoute, /local_path/);
  assert.match(knowledgeMirrorRoute, /knowledge_cards/);
  assert.match(knowledgeMirrorRoute, /creator:/);
  assert.match(knowledgeMirrorRoute, /text\(digest\.transferPrompt, 1_000\)/);
  assert.match(knowledgeMirrorRoute, /sourceCoverUrl/);
  assert.match(knowledgeMirrorRoute, /cover_url/);
  assert.match(syncStatusRoute, /last_used_at/);
  assert.match(tokenRoute, /wikiSyncTokens/);
});

test("keeps official WeChat links out of automatic compilation", async () => {
  const [injection, dashboard, clipRoute] = await Promise.all([
    readFile(new URL("../app/lib/injection.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/clips/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(injection, /official_link/);
  assert.match(injection, /环境异常|完成验证后即可继续访问/);
  assert.match(injection, /isWechatArticleUrl/);
  assert.match(dashboard, /公众号原文待验证/);
  assert.doesNotMatch(clipRoute, /compileQueuedSources/);
  assert.match(clipRoute, /processingStatus: "inbox"/);
});

test("refuses cross-owner and mismatched-material writes", () => {
  const material = { ownerId: "owner-a", questionId: "question-a" };
  assert.equal(canWriteDelta(material, "question-a", "owner-a"), true);
  assert.equal(canWriteDelta(material, "question-b", "owner-a"), false);
  assert.equal(canWriteDelta(material, "question-a", "owner-b"), false);
});
