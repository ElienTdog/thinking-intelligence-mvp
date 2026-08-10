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
  assert.match(inboxRoute, /'queued', 'loading', 'captured', 'maintaining', 'needs_user_open', 'failed'/);
  assert.match(mirrorRoute, /local_path/);
  assert.match(mirrorRoute, /allowedStatuses/);
  assert.doesNotMatch(mirrorRoute, /: "mirrored"/);
  assert.match(knowledgeMirrorRoute, /knowledge_cards/);
  assert.match(knowledgeMirrorRoute, /creator:/);
  assert.match(knowledgeMirrorRoute, /text\(digest\.transferPrompt, 1_000\)/);
  assert.match(knowledgeMirrorRoute, /sourceCoverUrl/);
  assert.match(knowledgeMirrorRoute, /text\(item\.sourceCoverUrl, 700_000\)/);
  assert.match(knowledgeMirrorRoute, /cover_url/);
  assert.match(syncStatusRoute, /last_used_at/);
  assert.match(tokenRoute, /wikiSyncTokens/);
});

test("routes official WeChat links through the local capture lifecycle", async () => {
  const [injection, dashboard, clipRoute, retryRoute, css] = await Promise.all([
    readFile(new URL("../app/lib/injection.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/clips/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/clips/[clipId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(injection, /official_link/);
  assert.match(injection, /环境异常|完成验证后即可继续访问/);
  assert.match(injection, /isWechatArticleUrl/);
  assert.match(dashboard, /浏览器加载中/);
  assert.match(dashboard, /正文已获取/);
  assert.match(dashboard, /DeepSeek 维护中/);
  assert.match(dashboard, /需你打开/);
  assert.match(dashboard, /重试采集/);
  assert.match(dashboard, /processingError/);
  assert.doesNotMatch(clipRoute, /compileQueuedSources/);
  assert.match(clipRoute, /processingStatus: "queued"/);
  assert.match(retryRoute, /export async function PATCH/);
  assert.match(retryRoute, /needs_user_open/);
  assert.match(css, /@media \(max-width:393px\)/);
  assert.match(css, /\.raw-card-actions \{ min-width:0; display:flex; flex-wrap:wrap/);
});

test("declares a token-protected loopback WeChat capture extension", async () => {
  const [manifest, background, content] = await Promise.all([
    readFile(new URL("../capture-bridge-extension/manifest.json", import.meta.url), "utf8"),
    readFile(new URL("../capture-bridge-extension/background.js", import.meta.url), "utf8"),
    readFile(new URL("../capture-bridge-extension/content.js", import.meta.url), "utf8"),
  ]);
  assert.match(manifest, /127\.0\.0\.1:8765/);
  assert.match(manifest, /mp\.weixin\.qq\.com/);
  assert.match(background, /Authorization: `Bearer \$\{config\.token\}`/);
  assert.match(background, /\/v1\/extension\/jobs\/next/);
  assert.match(background, /chrome\.alarms\.onAlarm/);
  assert.doesNotMatch(background, /setInterval/);
  assert.match(content, /#js_content/);
  assert.match(content, /needs_user_open/);
  assert.doesNotMatch(background, /cookie|profile/i);
});

test("refuses cross-owner and mismatched-material writes", () => {
  const material = { ownerId: "owner-a", questionId: "question-a" };
  assert.equal(canWriteDelta(material, "question-a", "owner-a"), true);
  assert.equal(canWriteDelta(material, "question-b", "owner-a"), false);
  assert.equal(canWriteDelta(material, "question-a", "owner-b"), false);
});

test("parses open-ended topic features without a fixed taxonomy", async () => {
  const { parseTopicFeatures } = await import("../app/lib/recommendation-policy.mjs");
  const parsed = parseTopicFeatures({
    sourceName: "新作者",
    tags: '[]',
    topicFeatures: JSON.stringify({ topic: "模型外交", subtopics: ["协议协商"], novelty: 0.9 }),
  });
  assert.equal(parsed.topic, "模型外交");
  assert.deepEqual(parsed.subtopics, ["协议协商"]);
});

test("produces a reproducible natural slate for a fixed seed", async () => {
  const { recommendTopicSlate } = await import("../app/lib/recommendation-policy.mjs");
  const cards = topicCards(["A", "B", "C", "D"], 6);
  const first = recommendTopicSlate(cards, "", { seed: "same", size: 20 });
  const second = recommendTopicSlate(cards, "", { seed: "same", size: 20 });
  assert.deepEqual(first.items.map((item) => item.card.id), second.items.map((item) => item.card.id));
});

test("keeps unseen topics eligible for exploration", async () => {
  const { recommendTopicSlate } = await import("../app/lib/recommendation-policy.mjs");
  const cards = topicCards(["熟悉主题", "全新主题", "相邻主题", "随机主题"], 4);
  const slate = recommendTopicSlate(cards, "", { seed: "explore", size: 12 });
  assert.ok(slate.items.some((item) => item.topic === "全新主题"));
});

test("positive actual feedback raises topic frequency before the cap", async () => {
  const { recommendTopicSlate, trainTopicPolicy } = await import("../app/lib/recommendation-policy.mjs");
  const cards = topicCards(["A", "B", "C", "D", "E"], 4);
  const before = recommendTopicSlate(cards, "", { seed: "x", size: 10 });
  const observations = Array.from({ length: 8 }, (_, index) => ({
    sessionId: `actual-${index}`, topic: "A", selectionProbability: 0.2, wasShown: true, eventType: "saved",
  }));
  const model = await trainTopicPolicy(cards, "", observations);
  const after = recommendTopicSlate(cards, model, { seed: "x", size: 10 });
  assert.ok(after.items.filter((item) => item.topic === "A").length > before.items.filter((item) => item.topic === "A").length);
});

test("shadow observations never train the topic model", async () => {
  const { createTopicPolicy, trainTopicPolicy } = await import("../app/lib/recommendation-policy.mjs");
  const cards = topicCards(["A", "B"], 3);
  const initial = createTopicPolicy(cards).toJSON();
  const next = await trainTopicPolicy(cards, initial, [{
    sessionId: "shadow", topic: "A", selectionProbability: 0.5, wasShown: false, eventType: "saved",
  }]);
  assert.equal(next, initial);
});

test("enforces topic share and consecutive-topic limits when inventory permits", async () => {
  const { MAX_CONSECUTIVE_TOPIC, MAX_TOPIC_SHARE, recommendTopicSlate } = await import("../app/lib/recommendation-policy.mjs");
  const slate = recommendTopicSlate(topicCards(["A", "B", "C", "D"], 10), "", { seed: "limits", size: 20 });
  const counts = Object.groupBy(slate.items, (item) => item.topic);
  assert.ok(Math.max(...Object.values(counts).map((items) => items.length)) <= Math.floor(20 * MAX_TOPIC_SHARE));
  assert.ok(slate.items.every((item, index, items) => index < MAX_CONSECUTIVE_TOPIC || !items.slice(index - MAX_CONSECUTIVE_TOPIC, index).every((prior) => prior.topic === item.topic)));
});

test("trusted creators are a prior but cannot monopolize a balanced slate", async () => {
  const { recommendTopicSlate } = await import("../app/lib/recommendation-policy.mjs");
  const preferred = topicCards(["A", "B", "C"], 5, "数字生命卡兹克");
  const others = topicCards(["D", "E", "F"], 5, "其他作者", "other");
  const slate = recommendTopicSlate([...preferred, ...others], "", { seed: "creator-cap", size: 20 });
  assert.ok(slate.items.filter((item) => item.card.sourceName === "数字生命卡兹克").length <= 10);
  assert.ok(slate.items.some((item) => item.card.sourceName === "其他作者"));
});

test("less-like feedback strongly suppresses a card", async () => {
  const { recommendTopicSlate } = await import("../app/lib/recommendation-policy.mjs");
  const cards = topicCards(["A", "B", "C", "D"], 5);
  const muted = cards[0];
  const slate = recommendTopicSlate(cards, "", { seed: "muted", size: 5, events: [{ cardId: muted.id, eventType: "less_like" }] });
  assert.ok(!slate.items.some((item) => item.card.id === muted.id));
});

test("accepts only three to six distinct traceable DeepSeek units", async () => {
  const { parseKnowledgeUnits } = await import("../app/lib/knowledge-units.ts");
  const units = Array.from({ length: 3 }, (_, index) => ({
    title: `单元 ${index}`, hook: "入口", explanation: "解释", reasoningMove: "对照", boundary: "边界",
    whyItMatters: "重要", tags: ["主题"], topic: `主题 ${index}`, subtopics: [], format: "案例",
    difficulty: "中等", novelty: 0.5, sourceEvidence: `原文第 ${index + 1} 段`,
  }));
  assert.equal(parseKnowledgeUnits(JSON.stringify({ units })).length, 3);
  assert.throws(() => parseKnowledgeUnits(JSON.stringify({ units: units.slice(0, 2) })), /3–6/);
});

test("declares owner-scoped shadow impressions and three recommender modes", async () => {
  const [schema, migration, feedRoute, eventRoute] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0007_topic_bandit_shadow.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/feed/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/feed-events/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(schema, /recommendation_models/);
  assert.match(schema, /feed_impressions/);
  assert.match(migration, /topic_features/);
  assert.match(feedRoute, /LEGACY.*BANDIT|BANDIT.*LEGACY/s);
  assert.match(feedRoute, /bandit-shadow/);
  assert.match(feedRoute, /ownerId: auth\.user\.userId/);
  assert.match(eventRoute, /feedImpressions\.ownerId, auth\.user\.userId/);
  assert.match(eventRoute, /feedImpressions\.wasShown, true/);
});

test("keeps the recommendation rationale available without exposing quotas", async () => {
  const [feed, policy] = await Promise.all([
    readFile(new URL("../app/knowledge-feed.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/recommendation-policy.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(feed, /为什么推荐/);
  assert.match(policy, /recommendationReason/);
  assert.doesNotMatch(feed, /selectionProbability|MAX_TOPIC_SHARE|主题配额/);
});

function topicCards(topics, perTopic, creator = "普通作者", prefix = "card") {
  return topics.flatMap((topic) => Array.from({ length: perTopic }, (_, index) => ({
    id: `${prefix}-${topic}-${index}`,
    sourceName: creator,
    tags: JSON.stringify([`creator:${creator}`, topic]),
    topicFeatures: JSON.stringify({ topic, subtopics: [`${topic}-子主题`], novelty: 0.6, creator }),
    createdAt: new Date().toISOString(),
    storyId: null,
  })));
}

test("records actual and shadow orders under one session without training on shadow rows", async () => {
  const { buildImpressionRows, recommendTopicSlate } = await import("../app/lib/recommendation-policy.mjs");
  const cards = topicCards(["A", "B", "C", "D"], 3);
  const shadow = recommendTopicSlate(cards, "", { seed: "paired-orders", size: 8 });
  const rows = buildImpressionRows(cards.slice(0, 4), shadow.items, {
    sessionId: "session-one", mode: "SHADOW", rankedLength: cards.length,
  });
  assert.deepEqual(new Set(rows.map((row) => row.sessionId)), new Set(["session-one"]));
  assert.equal(rows.filter((row) => row.policy === "legacy" && row.wasShown).length, 4);
  assert.equal(rows.filter((row) => row.policy === "bandit-shadow" && !row.wasShown).length, 8);
  assert.equal(rows.some((row) => row.policy === "bandit-shadow" && row.wasShown), false);
});

test("offers an authenticated smart-mix preview without changing the default mode", async () => {
  const [route, dashboard, feed] = await Promise.all([
    readFile(new URL("../app/api/feed/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/knowledge-feed.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /preview === "bandit"/);
  assert.match(route, /RECOMMENDER_MODE[^]*\|\| "SHADOW"/);
  assert.match(dashboard, /preview=bandit/);
  assert.match(feed, /当前排序/);
  assert.match(feed, /智能混排/);
});

test("mirrors DeepSeek units without a long-running model call in the site request", async () => {
  const route = await readFile(new URL("../app/api/local-sync/knowledge/route.ts", import.meta.url), "utf8");
  assert.match(route, /parseKnowledgeUnits/);
  assert.match(route, /item\.units/);
  assert.doesNotMatch(route, /compileKnowledgeUnits|DEEPSEEK_API_KEY/);
});
