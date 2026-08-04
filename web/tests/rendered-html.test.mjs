import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canWriteDelta, isCompilableRawSource, rankKnowledgeCards, validateClipPayload, validateDeltaPayload, validateFeedEventPayload } from "../app/lib/validation.mjs";


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
  const [schema, worker, feedRoute, eventRoute, runRoute, deleteRoute, dashboard] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/feed/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/feed-events/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/injection/run/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/clips/[clipId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(schema, /source_feeds/);
  assert.match(schema, /knowledge_cards/);
  assert.match(schema, /feed_events/);
  assert.match(schema, /injection_runs/);
  assert.match(worker, /scheduled\(/);
  assert.match(worker, /runDailyInjection/);
  assert.match(feedRoute, /knowledgeCards\.ownerId/);
  assert.match(eventRoute, /knowledgeCards\.ownerId/);
  assert.match(runRoute, /DEEPSEEK_API_KEY/);
  assert.match(dashboard, /KnowledgeFeed/);
  assert.match(dashboard, /onTouchEnd/);
  assert.match(dashboard, /setSurface\(direction === "left" \? "story" : "raw"\)/);
  assert.match(dashboard, /requestJson\("\/api\/injection\/run", \{\}\)/);
  assert.match(dashboard, /requestJson\(`\/api\/clips\/\$\{clip\.id\}`, undefined, "DELETE"\)/);
  assert.match(deleteRoute, /knowledgeCards\.ownerId/);
  assert.match(deleteRoute, /feedEvents/);
  assert.match(deleteRoute, /dailyStories/);
});

test("refuses cross-owner and mismatched-material writes", () => {
  const material = { ownerId: "owner-a", questionId: "question-a" };
  assert.equal(canWriteDelta(material, "question-a", "owner-a"), true);
  assert.equal(canWriteDelta(material, "question-b", "owner-a"), false);
  assert.equal(canWriteDelta(material, "question-a", "owner-b"), false);
});
