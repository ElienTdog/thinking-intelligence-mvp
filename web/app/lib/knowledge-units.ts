export type KnowledgeUnit = {
  title: string;
  hook: string;
  explanation: string;
  reasoningMove: string;
  boundary: string;
  whyItMatters: string;
  tags: string[];
  topic: string;
  subtopics: string[];
  format: string;
  difficulty: string;
  novelty: number;
  sourceEvidence: string;
};

type DeepSeekConfig = { apiKey?: string; model?: string; fetcher?: typeof fetch };

export async function compileKnowledgeUnits(
  source: { title: string; url: string; text: string },
  config: DeepSeekConfig,
) {
  if (!config.apiKey) throw new Error("DEEPSEEK_API_KEY is not configured");
  const response = await (config.fetcher ?? fetch)("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model || "deepseek-v4-flash",
      messages: [
        { role: "system", content: "你只输出有效 JSON。所有知识单元必须可追溯到提供的原文，不得补充原文之外的事实。" },
        { role: "user", content: `把这篇已核验、可读的原文拆成 3–6 个彼此不同、可独立阅读的中文知识单元。相似观点合并，不按段落机械切分。topic 和 subtopics 可以创造新选题，不受固定分类限制。sourceEvidence 必须是原文中的短证据或忠实定位，不得伪造引文。输出 {"units":[...]}，每个 unit 必须包含 title、hook、explanation、reasoningMove、boundary、whyItMatters、tags、topic、subtopics、format、difficulty、novelty、sourceEvidence；novelty 为 0–1。\n\n标题：${source.title}\n链接：${source.url}\n原文：${source.text.slice(0, 18000)}` },
      ],
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      stream: false,
      max_tokens: 6000,
    }),
  });
  if (!response.ok) throw new Error(`DeepSeek request failed (${response.status})`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek returned empty json");
  return parseKnowledgeUnits(content);
}

export function parseKnowledgeUnits(value: string): KnowledgeUnit[] {
  const parsed = JSON.parse(value) as { units?: unknown[] };
  if (!Array.isArray(parsed?.units)) throw new Error("knowledge unit json has no units");
  const seen = new Set<string>();
  const units = parsed.units.flatMap((raw) => {
    const item = raw as Record<string, unknown>;
    const required = ["title", "hook", "explanation", "reasoningMove", "boundary", "whyItMatters", "topic", "format", "difficulty", "sourceEvidence"];
    if (required.some((key) => !String(item?.[key] ?? "").trim())) return [];
    const title = String(item.title).trim().slice(0, 160);
    const topic = String(item.topic).trim().slice(0, 80);
    const identity = `${title.toLowerCase()}:${topic.toLowerCase()}`;
    if (seen.has(identity)) return [];
    seen.add(identity);
    const tags = stringList(item.tags, 3, 60);
    if (!tags.length) tags.push(topic);
    return [{
      title,
      hook: String(item.hook).trim().slice(0, 240),
      explanation: String(item.explanation).trim().slice(0, 2_000),
      reasoningMove: String(item.reasoningMove).trim().slice(0, 800),
      boundary: String(item.boundary).trim().slice(0, 800),
      whyItMatters: String(item.whyItMatters).trim().slice(0, 800),
      tags,
      topic,
      subtopics: stringList(item.subtopics, 5, 60),
      format: String(item.format).trim().slice(0, 40),
      difficulty: String(item.difficulty).trim().slice(0, 20),
      novelty: clamp(Number(item.novelty) || 0.5, 0, 1),
      sourceEvidence: String(item.sourceEvidence).trim().slice(0, 500),
    }];
  }).slice(0, 6);
  if (units.length < 3) throw new Error("DeepSeek must return 3–6 distinct knowledge units");
  return units;
}

export function topicFeatures(unit: KnowledgeUnit, creator = "") {
  return JSON.stringify({
    topic: unit.topic,
    subtopics: unit.subtopics,
    format: unit.format,
    difficulty: unit.difficulty,
    novelty: unit.novelty,
    creator,
    sourceEvidence: unit.sourceEvidence,
  });
}

function stringList(value: unknown, limit: number, itemLimit: number) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, itemLimit)).filter(Boolean).slice(0, limit)
    : [];
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
