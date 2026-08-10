import { SimpleBandit, SimpleOracle } from "simplebandit";

export const POLICY_VERSION = "topic-bandit-v1";
export const MAX_TOPIC_SHARE = 0.35;
export const MAX_CREATOR_SHARE = 0.5;
export const MAX_CONSECUTIVE_TOPIC = 2;

const FOLLOWED_CREATORS = new Set(["数字生命卡兹克", "赛博禅心", "MacTalk", "量子位", "Datawhale"]);
const EVENT_REWARDS = {
  seen: { click: 0.35, sampleWeight: 0.2 },
  completed: { click: 0.65, sampleWeight: 0.6 },
  saved: { click: 1, sampleWeight: 3 },
  opened_source: { click: 1, sampleWeight: 2.5 },
  less_like: { click: 0, sampleWeight: 4 },
};

export function parseTopicFeatures(card) {
  let value = {};
  try {
    const parsed = JSON.parse(card.topicFeatures || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) value = parsed;
  } catch {
    value = {};
  }
  const tags = parseTags(card.tags);
  const creator = String(value.creator || tags.find((tag) => tag.startsWith("creator:"))?.slice(8) || card.sourceName || "").trim();
  const topic = String(value.topic || tags.find((tag) => !tag.startsWith("creator:") && tag !== "local-wiki") || "待探索").trim().slice(0, 80) || "待探索";
  return {
    topic,
    subtopics: stringList(value.subtopics, 5, 60),
    format: String(value.format || "观点").trim().slice(0, 40) || "观点",
    difficulty: String(value.difficulty || "中等").trim().slice(0, 20) || "中等",
    novelty: clamp(Number(value.novelty) || 0.5, 0, 1),
    creator,
    sourceEvidence: String(value.sourceEvidence || "").trim().slice(0, 500),
  };
}

export function createTopicPolicy(cards, modelJson = "") {
  const actions = topicActions(cards);
  const oracle = new SimpleOracle({
    actionIdFeatures: true,
    actionFeatures: true,
    learningRate: 0.12,
    regularizer: 0.01,
    useInversePropensityWeighting: true,
    laplaceSmoothing: 0.02,
  });
  if (modelJson) {
    try {
      return SimpleBandit.fromJSON(modelJson, actions);
    } catch {
      // A stale model must not make the feed unavailable; rebuild with current topics.
    }
  }
  return new SimpleBandit({ oracle, actions, temperature: 0.35, slateSize: 20 });
}

export async function trainTopicPolicy(cards, modelJson, observations) {
  const bandit = createTopicPolicy(cards, modelJson);
  const knownTopics = new Set(topicActions(cards).map((action) => action.actionId));
  const training = observations.flatMap((observation, index) => {
    const reward = EVENT_REWARDS[observation.eventType];
    if (!reward || !knownTopics.has(observation.topic) || observation.wasShown !== true) return [];
    return [{
      recommendationId: observation.sessionId || `actual-${index}`,
      actionId: observation.topic,
      probability: clamp(Number(observation.selectionProbability) || 0.05, 0.001, 1),
      click: reward.click,
      sampleWeight: reward.sampleWeight,
    }];
  });
  if (training.length) await bandit.train(training);
  return bandit.toJSON();
}

export function recommendTopicSlate(cards, modelJson = "", options = {}) {
  const size = Math.min(Math.max(1, Number(options.size) || 20), cards.length);
  if (!size) return { items: [], modelJson: createTopicPolicy([], modelJson).toJSON(), degradedReasons: [] };
  const random = seededRandom(options.seed || "topic-bandit");
  const bandit = createTopicPolicy(cards, modelJson);
  const topicScores = new Map(bandit.getScoredActions().map((item) => [item.actionId, Math.max(0.0001, item.probability)]));
  const eventsByCard = groupEvents(options.events || []);
  const remaining = [...cards];
  const selected = [];
  const topicCounts = new Map();
  const creatorCounts = new Map();
  const degradedReasons = new Set();

  while (selected.length < size && remaining.length) {
    const prefixSize = selected.length + 1;
    const topicCap = Math.max(1, Math.ceil(prefixSize * MAX_TOPIC_SHARE));
    const creatorCap = Math.max(1, Math.ceil(prefixSize * MAX_CREATOR_SHARE));
    const strict = remaining.filter((card) => eligible(card, selected, topicCounts, creatorCounts, topicCap, creatorCap));
    let pool = strict;
    if (!pool.length) {
      degradedReasons.add("候选分布不足，已放宽主题或作者占比以填满本轮");
      pool = remaining.filter((card) => !breaksConsecutiveTopic(card, selected));
    }
    if (!pool.length) {
      degradedReasons.add("候选主题不足，已放宽连续主题限制");
      pool = remaining;
    }
    const weighted = pool.map((card) => {
      const features = parseTopicFeatures(card);
      const eventTypes = eventsByCard.get(card.id) || [];
      let weight = topicScores.get(features.topic) || 0.0001;
      if (FOLLOWED_CREATORS.has(features.creator)) weight *= 1.18;
      weight *= 0.9 + features.novelty * 0.25;
      if (!eventTypes.includes("seen")) weight *= 1.15;
      if (eventTypes.includes("saved") || eventTypes.includes("opened_source")) weight *= 1.12;
      if (eventTypes.includes("less_like")) weight *= 0.01;
      return { card, features, weight: Math.max(weight, 0.000001) };
    });
    const total = weighted.reduce((sum, item) => sum + item.weight, 0);
    const choice = weightedChoice(weighted, total, random);
    const position = selected.length + 1;
    selected.push({
      card: choice.card,
      topic: choice.features.topic,
      probability: choice.weight / total,
      position,
      reason: recommendationReason(choice.features, topicCounts.get(choice.features.topic) || 0),
    });
    topicCounts.set(choice.features.topic, (topicCounts.get(choice.features.topic) || 0) + 1);
    if (choice.features.creator) creatorCounts.set(choice.features.creator, (creatorCounts.get(choice.features.creator) || 0) + 1);
    remaining.splice(remaining.indexOf(choice.card), 1);
  }
  return { items: selected, modelJson: bandit.toJSON(), degradedReasons: [...degradedReasons] };
}

export function buildImpressionRows(actualCards, shadowItems, options) {
  const { sessionId, mode, cursor = 0, rankedLength = actualCards.length, shadowPolicy = "bandit-shadow" } = options;
  const shadowByCard = new Map(shadowItems.map((item) => [item.card.id, item]));
  const actualPolicy = mode === "BANDIT" ? "bandit" : "legacy";
  const rows = actualCards.map((card, index) => {
    const shadow = shadowByCard.get(card.id);
    return {
      cardId: card.id,
      sessionId,
      topic: parseTopicFeatures(card).topic,
      position: cursor + index + 1,
      policy: actualPolicy,
      selectionProbability: String(shadow?.probability ?? 1 / Math.max(1, rankedLength)),
      wasShown: true,
    };
  });
  if (mode !== "SHADOW") return rows;
  return rows.concat(shadowItems.map((item) => ({
    cardId: item.card.id,
    sessionId,
    topic: item.topic,
    position: item.position,
    policy: shadowPolicy,
    selectionProbability: String(item.probability),
    wasShown: false,
  })));
}

function topicActions(cards) {
  const grouped = new Map();
  for (const card of cards) {
    const features = parseTopicFeatures(card);
    const current = grouped.get(features.topic) || { count: 0, novelty: 0, trusted: 0 };
    current.count += 1;
    current.novelty += features.novelty;
    current.trusted += FOLLOWED_CREATORS.has(features.creator) ? 1 : 0;
    grouped.set(features.topic, current);
  }
  return [...grouped].map(([topic, value]) => ({
    actionId: topic,
    features: {
      novelty: value.novelty / value.count,
      trusted_source: value.trusted / value.count,
      inventory: Math.min(1, value.count / 8),
    },
  }));
}

function eligible(card, selected, topicCounts, creatorCounts, topicCap, creatorCap) {
  const features = parseTopicFeatures(card);
  if ((topicCounts.get(features.topic) || 0) >= topicCap) return false;
  if (features.creator && (creatorCounts.get(features.creator) || 0) >= creatorCap) return false;
  return !breaksConsecutiveTopic(card, selected);
}

function breaksConsecutiveTopic(card, selected) {
  if (selected.length < MAX_CONSECUTIVE_TOPIC) return false;
  const topic = parseTopicFeatures(card).topic;
  return selected.slice(-MAX_CONSECUTIVE_TOPIC).every((item) => item.topic === topic);
}

function recommendationReason(features, priorTopicCount) {
  if (priorTopicCount > 0) return `你最近正在接触「${features.topic}」，这张卡换了一个角度。`;
  if (FOLLOWED_CREATORS.has(features.creator)) return `来自你重点关注的作者，并带来「${features.topic}」这个选题。`;
  return `这是一次与现有兴趣相邻的「${features.topic}」探索。`;
}

function weightedChoice(items, total, random) {
  let cursor = random() * total;
  for (const item of items) {
    cursor -= item.weight;
    if (cursor <= 0) return item;
  }
  return items[items.length - 1];
}

function seededRandom(seed) {
  let value = 2166136261;
  for (const character of String(seed)) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return () => {
    value += 0x6D2B79F5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function groupEvents(events) {
  const grouped = new Map();
  for (const event of events) {
    const current = grouped.get(event.cardId) || [];
    current.push(event.eventType);
    grouped.set(event.cardId, current);
  }
  return grouped;
}

function parseTags(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function stringList(value, limit, itemLimit) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string").map((item) => item.trim().slice(0, itemLimit)).filter(Boolean).slice(0, limit)
    : [];
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
