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
  const sourceTitle = cleanText(payload?.sourceTitle, MAX_SHORT_TEXT);
  const sourceUrl = cleanText(payload?.sourceUrl, MAX_LONG_TEXT);
  if (!content) return { error: "content is required" };
  if (sourceUrl) {
    try {
      const url = new URL(sourceUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
    } catch {
      return { error: "sourceUrl must be an http or https URL" };
    }
  }
  return { value: { content, sourceTitle, sourceUrl } };
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
