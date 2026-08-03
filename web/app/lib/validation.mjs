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
  const sourceUrl = findHttpUrl(content);
  return { value: { content, sourceTitle: makeClipTitle(content, sourceUrl), sourceUrl } };
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
