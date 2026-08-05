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

test("declares the owner-scoped feed and daily injection surfaces", async () => {
  const [schema, migration, workspace, worker, feedRoute, eventRoute, runRoute, deleteRoute, dashboard, knowledgeFeed, wikiRoute, wikiQueryRoute, wikiModel, wikiSchema] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0003_exotic_whirlwind.sql", import.meta.url), "utf8"),
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
  assert.match(migration, /wiki_pages/);
  assert.match(migration, /wiki_links/);
  assert.match(migration, /wiki_page_id/);
  assert.match(workspace, /数字生命卡兹克|赛博禅心|量子位|Datawhale/);
  assert.match(workspace, /aihotCreatorUrl/);
  assert.match(workspace, /MacTalk/);
  assert.match(worker, /scheduled\(/);
  assert.match(worker, /runDailyInjection/);
  assert.match(feedRoute, /knowledgeCards\.ownerId/);
  assert.match(eventRoute, /knowledgeCards\.ownerId/);
  assert.match(runRoute, /DEEPSEEK_API_KEY/);
  assert.match(dashboard, /KnowledgeFeed/);
  assert.match(dashboard, /surface-track/);
  assert.match(dashboard, /onTouchMove/);
  assert.match(dashboard, /\/api\/learning-attempts/);
  assert.match(dashboard, /\/api\/wiki\/lint/);
  assert.match(dashboard, /\/api\/wiki\/query/);
  assert.match(dashboard, /requestJson\("\/api\/injection\/run", \{\}\)/);
  assert.match(dashboard, /requestJson\(`\/api\/clips\/\$\{clip\.id\}`, undefined, "DELETE"\)/);
  assert.match(deleteRoute, /knowledgeCards\.ownerId/);
  assert.match(deleteRoute, /feedEvents/);
  assert.match(deleteRoute, /dailyStories/);
  assert.match(deleteRoute, /wikiPages/);
  assert.match(knowledgeFeed, /ReviewMomentView/);
  assert.match(knowledgeFeed, /在 Wiki 里/);
  assert.match(wikiRoute, /getWikiLint/);
  assert.match(wikiQueryRoute, /queryWiki/);
  assert.match(wikiModel, /refreshTopicIndexes/);
  assert.match(wikiModel, /supports.*contradicts|contradicts.*supports/);
  assert.match(wikiSchema, /Raw layer/);
  assert.match(wikiSchema, /Story Mode/);
  assert.match(wikiSchema, /append-only/);
});

test("keeps official WeChat links as raw sources until a readable body is available", async () => {
  const [injection, dashboard, clipRoute] = await Promise.all([
    readFile(new URL("../app/lib/injection.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/clips/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(injection, /official_link/);
  assert.match(injection, /环境异常|完成验证后即可继续访问/);
  assert.match(injection, /isWechatArticleUrl/);
  assert.match(dashboard, /公众号原文待验证/);
  assert.match(clipRoute, /isWechatArticleUrl/);
});

test("refuses cross-owner and mismatched-material writes", () => {
  const material = { ownerId: "owner-a", questionId: "question-a" };
  assert.equal(canWriteDelta(material, "question-a", "owner-a"), true);
  assert.equal(canWriteDelta(material, "question-b", "owner-a"), false);
  assert.equal(canWriteDelta(material, "question-a", "owner-b"), false);
});
