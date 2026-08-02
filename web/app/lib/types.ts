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
};
