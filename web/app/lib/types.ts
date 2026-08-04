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
  origin: "legacy" | "user_capture" | "daily_injection";
  sourceType: "text" | "article" | "video";
  publisher: string;
  publishedAt: string;
  verificationStatus: "unknown" | "verified" | "lead" | "needs_transcript";
  processingStatus: "legacy" | "queued" | "processing" | "compiled" | "skipped" | "failed";
  rawExcerpt: string;
  contentHash: string;
  priority: number;
  processingError: string;
  processedAt: string;
  createdAt: string;
};

export type KnowledgeCard = {
  id: string;
  rawSourceId: string;
  storyId: string | null;
  storyPosition: number;
  title: string;
  hook: string;
  explanation: string;
  reasoningMove: string;
  boundary: string;
  whyItMatters: string;
  tags: string;
  sourceName: string;
  sourceUrl: string;
  verificationStatus: "unknown" | "verified" | "lead" | "needs_transcript";
  state: "published";
  createdAt: string;
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
};
