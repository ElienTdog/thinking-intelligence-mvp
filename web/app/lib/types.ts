export type Question = {
  id: string;
  title: string;
  initialJudgment: string;
  priority: number;
  createdAt: string;
};

export type Material = {
  id: string;
  questionId: string;
  type: "source" | "card";
  title: string;
  challenge: string;
  relevance: string;
  createdAt: string;
};

export type Clip = {
  id: string;
  content: string;
  sourceUrl: string;
  sourceTitle: string;
  status: string;
  origin: "legacy" | "user_capture" | "daily_injection" | "local_wiki";
  sourceType: "text" | "article" | "video";
  publisher: string;
  publishedAt: string;
  verificationStatus: "unknown" | "verified" | "lead" | "official_link" | "needs_transcript";
  processingStatus: "legacy" | "inbox" | "needs_clipper" | "queued" | "loading" | "captured" | "maintaining" | "mirrored" | "needs_user_open" | "processing" | "compiled" | "skipped" | "failed";
  rawExcerpt: string;
  contentHash: string;
  priority: number;
  processingError: string;
  processedAt: string;
  localPath: string;
  mirrorVersion: string;
  mirrorUpdatedAt: string;
  createdAt: string;
};

export type KnowledgeCard = {
  id: string;
  rawSourceId: string;
  wikiPageId: string | null;
  storyId: string | null;
  storyPosition: number;
  title: string;
  hook: string;
  explanation: string;
  reasoningMove: string;
  boundary: string;
  whyItMatters: string;
  coverUrl: string;
  tags: string;
  topicFeatures: string;
  unitKey: string;
  recommendationReason?: string;
  sourceName: string;
  sourceUrl: string;
  verificationStatus: "unknown" | "verified" | "lead" | "official_link" | "needs_transcript";
  state: "published";
  createdAt: string;
};

export type WikiPage = {
  id: string;
  kind: "claim" | "topic" | "synthesis";
  title: string;
  summary: string;
  evidenceStatus: string;
  recallPrompt: string;
  transferPrompt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type WikiLink = {
  id: string;
  fromPageId: string;
  toPageId: string;
  relation: "about" | "related_to" | "supports" | "contradicts" | "depends_on";
  rationale: string;
  createdAt: string;
};

export type WikiActivity = {
  id: string;
  pageId: string | null;
  action: string;
  message: string;
  createdAt: string;
};

export type ReviewMoment = {
  page: WikiPage;
  cardId: string;
  promptType: "recall" | "transfer" | "counter";
};

export type WikiSnapshot = {
  pages: WikiPage[];
  links: WikiLink[];
  activity: WikiActivity[];
  review: ReviewMoment | null;
};

export type DailyStory = {
  id: string;
  storyDate: string;
  title: string;
  openingQuestion: string;
  takeaway: string;
  status: "published";
  createdAt: string;
};

export type FeedPayload = {
  cards: KnowledgeCard[];
  nextCursor: string | null;
};

export type JudgmentDelta = {
  id: string;
  questionId: string;
  materialId: string;
  responseType: "partially_accept" | "counterargument" | "validate_in_context" | "park";
  responseText: string;
  validationScenario: string;
  status: "response_recorded" | "needs_validation";
  createdAt: string;
};

export type BootstrapPayload = {
  questions: Question[];
  materials: Material[];
  deltas: JudgmentDelta[];
  clips: Clip[];
  cards: KnowledgeCard[];
  todayStory: DailyStory | null;
  storyCards: KnowledgeCard[];
  wiki: WikiSnapshot;
};
