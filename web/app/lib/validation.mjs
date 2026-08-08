export const RESPONSE_TYPES = Object.freeze([
  "partially_accept",
  "counterargument",
  "validate_in_context",
  "park",
]);

const MAX_SHORT_TEXT = 280;
const MAX_LONG_TEXT = 2_000;
const MAX_CAPTURE_TEXT = 8_000;

export function cleanText(value, maxLength = MAX_LONG_TEXT) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function validateQuestionPayload(payload) {
  const title = cleanText(payload?.title, MAX_SHORT_TEXT);
  const initialJudgment = cleanText(payload?.initialJudgment);
  const priority = Number(payload?.priority);
  if (!title || !initialJudgment || !Number.isInteger(priority) || priority < 1 || priority > 3) {
    return { error: "title, initialJudgment, and priority (1-3) are required" };
  }
  return { value: { title, initialJudgment, priority } };
}

export function validateMaterialPayload(payload) {
  const questionId = cleanText(payload?.questionId, MAX_SHORT_TEXT);
  const type = cleanText(payload?.type, 20);
  const title = cleanText(payload?.title, MAX_SHORT_TEXT);
  const challenge = cleanText(payload?.challenge);
  const relevance = cleanText(payload?.relevance);
  if (!questionId || !["source", "card"].includes(type) || !title || !challenge || !relevance) {
    return { error: "questionId, type, title, challenge, and relevance are required" };
  }
  return { value: { questionId, type, title, challenge, relevance } };
}

export function validateClipPayload(payload) {
  const content = cleanText(payload?.content, MAX_CAPTURE_TEXT);
  if (!content) return { error: "content is required" };
  if (/^\[?URL(?:\]|\b)/i.test(content)) {
    return { error: "快捷指令没有传入实际内容，请重新插入 URL 编码后的变量" };
  }
  const sourceUrl = findHttpUrl(content);
  return { value: { content, sourceTitle: makeClipTitle(content, sourceUrl), sourceUrl } };
}

export const FEED_EVENT_TYPES = Object.freeze([
  "seen",
  "completed",
  "saved",
  "less_like",
  "opened_source",
]);

export const LEARNING_PROMPT_TYPES = Object.freeze([
  "recall",
  "transfer",
  "counter",
]);

export function validateFeedEventPayload(payload) {
  const cardId = cleanText(payload?.cardId, MAX_SHORT_TEXT);
  const eventType = cleanText(payload?.eventType, 30);
  if (!cardId || !FEED_EVENT_TYPES.includes(eventType)) {
    return { error: "cardId and a known eventType are required" };
  }
  return { value: { cardId, eventType } };
}

export function validateLearningAttemptPayload(payload) {
  const pageId = cleanText(payload?.pageId, MAX_SHORT_TEXT);
  const promptType = cleanText(payload?.promptType, 30);
  const response = cleanText(payload?.response);
  if (!pageId || !LEARNING_PROMPT_TYPES.includes(promptType) || !response) {
    return { error: "pageId, promptType, and response are required" };
  }
  return { value: { pageId, promptType, response } };
}

export function validateWikiQueryPayload(payload) {
  const question = cleanText(payload?.question, 500);
  if (!question) return { error: "question is required" };
  return { value: { question } };
}

export function isCompilableRawSource(source) {
  const content = cleanText(source?.content, MAX_CAPTURE_TEXT);
  if (!content || /^\[?URL(?:\]|\b)/i.test(content)) return false;
  if (source?.sourceType === "video" && !cleanText(source?.rawExcerpt, MAX_CAPTURE_TEXT)) return false;
  return Boolean(cleanText(source?.rawExcerpt, MAX_CAPTURE_TEXT) || !source?.sourceUrl || source.sourceType === "text");
}

export function rankKnowledgeCards(cards, events) {
  const eventMap = new Map();
  for (const event of events) {
    const current = eventMap.get(event.cardId) ?? [];
    current.push(event.eventType);
    eventMap.set(event.cardId, current);
  }
  const savedTags = new Set();
  const mutedTags = new Set();
  for (const card of cards) {
    const types = eventMap.get(card.id) ?? [];
    const tags = parseTags(card.tags);
    if (types.includes("saved")) tags.forEach((tag) => savedTags.add(tag));
    if (types.includes("less_like")) tags.forEach((tag) => mutedTags.add(tag));
  }
  return [...cards].sort((left, right) => scoreCard(right) - scoreCard(left));

  function scoreCard(card) {
    const types = eventMap.get(card.id) ?? [];
    const tags = parseTags(card.tags);
    let score = card.storyId ? 8 : 0;
    if (!types.includes("seen")) score += 30;
    if (!types.includes("completed")) score += 10;
    if (types.includes("saved")) score += 18;
    if (types.includes("opened_source")) score += 8;
    if (types.includes("less_like")) score -= 100;
    for (const tag of tags) {
      if (savedTags.has(tag)) score += 9;
      if (mutedTags.has(tag)) score -= 14;
    }
    // Followed creators form the first reading lane. Explicit "less like" feedback
    // above still wins, so a user can always push an author back down.
    const creator = tags.find((tag) => tag.startsWith("creator:"))?.slice(8);
    // Preserve the user's explicit reading order within the followed-author lane.
    if (creator && PREFERRED_CREATORS.has(creator)) {
      score += 90 + (PREFERRED_CREATORS.size - PREFERRED_CREATORS_ORDER.indexOf(creator)) * 4;
    }
    const ageDays = Math.max(0, (Date.now() - new Date(card.createdAt).getTime()) / 86_400_000);
    return score + Math.max(0, 12 - ageDays);
  }
}

const PREFERRED_CREATORS_ORDER = ["数字生命卡兹克", "赛博禅心", "MacTalk", "量子位", "Datawhale"];
const PREFERRED_CREATORS = new Set(PREFERRED_CREATORS_ORDER);

function parseTags(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((tag) => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

function findHttpUrl(content) {
  const match = content.match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return "";
  const candidate = match[0].replace(/[),.;!?\]}]+$/, "");
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? candidate : "";
  } catch {
    return "";
  }
}

function makeClipTitle(content, sourceUrl) {
  const firstLine = content.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
  const textTitle = firstLine.replace(/https?:\/\/[^\s<>"']+/gi, "").replace(/\s+/g, " ").trim();
  if (textTitle) return textTitle.slice(0, MAX_SHORT_TEXT);
  if (sourceUrl) return new URL(sourceUrl).hostname.replace(/^www\./, "");
  return content.replace(/\s+/g, " ").slice(0, MAX_SHORT_TEXT);
}

export function validateDeltaPayload(payload) {
  const questionId = cleanText(payload?.questionId, MAX_SHORT_TEXT);
  const materialId = cleanText(payload?.materialId, MAX_SHORT_TEXT);
  const responseType = cleanText(payload?.responseType, 40);
  const responseText = cleanText(payload?.responseText);
  const validationScenario = cleanText(payload?.validationScenario);
  if (!questionId || !materialId || !RESPONSE_TYPES.includes(responseType) || !responseText) {
    return { error: "questionId, materialId, responseType, and responseText are required" };
  }
  if (responseType === "validate_in_context" && !validationScenario) {
    return { error: "validationScenario is required for validate_in_context" };
  }
  return { value: { questionId, materialId, responseType, responseText, validationScenario } };
}

export function canWriteDelta(material, questionId, ownerId) {
  return Boolean(
    material && material.questionId === questionId && material.ownerId === ownerId,
  );
}
