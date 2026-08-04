"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KnowledgeFeed } from "./knowledge-feed";
import type { BootstrapPayload, Clip, FeedPayload, JudgmentDelta, KnowledgeCard, Material, Question } from "./lib/types";

type View = "feed" | "story" | "raw" | "pending" | "questions" | "materials" | "deltas" | "capture";

const responseLabels: Record<JudgmentDelta["responseType"], string> = {
  partially_accept: "部分接受",
  counterargument: "提出反驳",
  validate_in_context: "拿真实场景验证",
  park: "暂存",
};

async function requestJson(path: string, body?: unknown) {
  const response = await fetch(path, body ? {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  } : undefined);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "请求未完成");
  return payload;
}

function clipTitle(clip: Clip) {
  if (clip.sourceTitle) return clip.sourceTitle;
  if (clip.sourceUrl) {
    try {
      return new URL(clip.sourceUrl).hostname.replace(/^www\./, "");
    } catch {
      return "未命名素材";
    }
  }
  return clip.content.split("\n").find(Boolean)?.slice(0, 48) || "未命名素材";
}

function clipPreview(clip: Clip) {
  const preview = clip.content.replace(/\s+/g, " ").trim();
  return preview.length > 180 ? `${preview.slice(0, 180)}...` : preview;
}

export function JudgmentWorkbench({ displayName }: { displayName: string }) {
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<View>("feed");
  const [feedCards, setFeedCards] = useState<KnowledgeCard[]>([]);
  const [nextFeedCursor, setNextFeedCursor] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showQuestionForm, setShowQuestionForm] = useState(false);
  const [showMaterialForm, setShowMaterialForm] = useState(false);
  const [respondingTo, setRespondingTo] = useState<Material | null>(null);
  const [captureContent, setCaptureContent] = useState("");
  const [notice, setNotice] = useState("");
  const captureFromLinkStarted = useRef(false);

  const load = useCallback(async () => {
    try {
      const next = await requestJson("/api/bootstrap") as BootstrapPayload;
      setData(next);
      try {
        const feed = await requestJson("/api/feed?limit=8") as FeedPayload;
        setFeedCards(feed.cards);
        setNextFeedCursor(feed.nextCursor);
      } catch {
        setFeedCards(next.cards);
        setNextFeedCursor(null);
      }
      setSelectedQuestionId((current) => current && next.questions.some((item) => item.id === current)
        ? current : next.questions[0]?.id ?? null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "暂时无法读取工作区");
    }
  }, []);

  const saveClip = useCallback(async (content: string) => {
    const value = content.trim();
    try {
      const result = await requestJson("/api/clips", { content: value }) as { card?: { id: string } | null; duplicate?: boolean };
      setCaptureContent("");
      setNotice(result.duplicate ? "这条来源已经在 Raw 层里了。" : result.card ? "已收录并编译成知识卡。" : "已收录到 Raw 层，等待可编译文本或每日注入。");
      await load();
    } catch (error) {
      setCaptureContent(value);
      setNotice(error instanceof Error ? error.message : "收录失败");
    }
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("capture");
    if (!value || captureFromLinkStarted.current) return;
    captureFromLinkStarted.current = true;
    const timer = window.setTimeout(() => {
      setActiveView("feed");
      void saveClip(value);
    }, 0);
    window.history.replaceState({}, "", window.location.pathname);
    return () => window.clearTimeout(timer);
  }, [saveClip]);

  const selectedQuestion = useMemo(() => data?.questions.find((item) => item.id === selectedQuestionId) ?? null,
    [data, selectedQuestionId]);
  const materials = useMemo(() => data?.materials.filter((item) => item.questionId === selectedQuestionId) ?? [], [data, selectedQuestionId]);
  const deltas = useMemo(() => data?.deltas.filter((item) => item.questionId === selectedQuestionId) ?? [], [data, selectedQuestionId]);
  const clips = data?.clips ?? [];
  const latestByMaterial = useMemo(() => {
    const value = new Map<string, JudgmentDelta>();
    deltas.forEach((delta) => { if (!value.has(delta.materialId)) value.set(delta.materialId, delta); });
    return value;
  }, [deltas]);
  const needsValidation = deltas.filter((item) => item.status === "needs_validation");
  const unanswered = materials.filter((item) => !latestByMaterial.has(item.id));
  const queue = activeView === "pending" ? [...needsValidation.map((delta) => ({ kind: "delta" as const, delta })), ...unanswered.map((material) => ({ kind: "material" as const, material }))] : [];
  const isKnowledgeView = activeView === "feed" || activeView === "story" || activeView === "raw" || activeView === "capture";

  const recordFeedEvent = useCallback((cardId: string, eventType: "seen" | "completed" | "saved" | "less_like" | "opened_source") => {
    if (eventType === "less_like") setFeedCards((current) => current.filter((card) => card.id !== cardId));
    void requestJson("/api/feed-events", { cardId, eventType }).catch(() => undefined);
  }, []);

  const loadMoreFeed = useCallback(() => {
    if (!nextFeedCursor) return;
    void requestJson(`/api/feed?limit=8&cursor=${encodeURIComponent(nextFeedCursor)}`)
      .then((payload) => {
        const next = payload as FeedPayload;
        setFeedCards((current) => [...current, ...next.cards.filter((card) => !current.some((item) => item.id === card.id))]);
        setNextFeedCursor(next.nextCursor);
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : "无法加载更多知识卡"));
  }, [nextFeedCursor]);

  const generateToday = useCallback(() => {
    setIsGenerating(true);
    void requestJson("/api/injection/run")
      .then(async () => {
        setNotice("今日 Raw、知识卡与故事已刷新。");
        await load();
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : "今日内容生成失败"))
      .finally(() => setIsGenerating(false));
  }, [load]);

  async function createQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await requestJson("/api/questions", { title: form.get("title"), initialJudgment: form.get("initialJudgment"), priority: form.get("priority") });
      formElement.reset(); setShowQuestionForm(false); setNotice("问题已保存。下一步是放进一条会挑战它的材料。"); await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "保存失败"); }
  }

  async function createMaterial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await requestJson("/api/materials", { questionId: selectedQuestionId, type: form.get("type"), title: form.get("title"), challenge: form.get("challenge"), relevance: form.get("relevance") });
      formElement.reset(); setShowMaterialForm(false); setNotice("材料已保存。现在写一句回应，留下判断的变化。"); await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "保存失败"); }
  }

  async function createDelta(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (!respondingTo) return;
    try {
      await requestJson("/api/judgment-deltas", { questionId: selectedQuestionId, materialId: respondingTo.id, responseType: form.get("responseType"), responseText: form.get("responseText"), validationScenario: form.get("validationScenario") });
      formElement.reset(); setRespondingTo(null); setNotice("判断差分已保存。它不会自动改写你的临时立场。"); await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "保存失败"); }
  }

  async function captureClipboard() {
    if (!navigator.clipboard?.readText) {
      setNotice("当前浏览器无法读取剪贴板，请直接粘贴内容。");
      return;
    }
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) throw new Error("剪贴板为空");
      await saveClip(text);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法读取剪贴板");
    }
  }

  async function createClip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveClip(captureContent);
  }

  if (!data) return <main className="loading" aria-busy="true"><div className="loading-stack"><span /><span /><span /></div><p>正在打开你的判断工作台</p></main>;

  const isCapture = activeView === "capture";
  const heading = activeView === "feed" ? "推荐" : activeView === "story" ? "今日故事" : activeView === "raw" ? "Raw" : isCapture ? "收录" : selectedQuestion?.title ?? "从一个真实问题开始";
  const eyebrow = activeView === "feed" ? "AI 时代知识点" : activeView === "story" ? "问题到判断" : activeView === "raw" ? "来源、核验与编译" : isCapture ? "复制即知识" : activeView === "pending" ? "判断工作台" : "你的工作区";

  return <main className="workbench-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">↗</span><span>思考情报台</span></div>
      <p className="account">{displayName}</p>
      <nav className="desktop-nav" aria-label="工作台导航">
        <NavButton view="feed" activeView={activeView} onSelect={setActiveView} label="推荐" />
        <NavButton view="story" activeView={activeView} onSelect={setActiveView} label="今日故事" />
        <NavButton view="capture" activeView={activeView} onSelect={setActiveView} label="收录素材" />
        <NavButton view="raw" activeView={activeView} onSelect={setActiveView} label="Raw" count={clips.length} />
        <NavButton view="pending" activeView={activeView} onSelect={setActiveView} label="判断" count={needsValidation.length + unanswered.length} />
      </nav>
      <button className="secondary full" onClick={() => setShowQuestionForm((visible) => !visible)}>新问题</button>
      {showQuestionForm && <form className="compact-form sidebar-form" onSubmit={createQuestion}>
        <label>问题<input name="title" required maxLength={280} placeholder="我正在判断什么？" /></label>
        <label>我的初始判断<textarea name="initialJudgment" required maxLength={2000} placeholder="先保留粗糙但真实的起点。" /></label>
        <label>优先级<select name="priority" defaultValue="1"><option value="1">P1 现在最重要</option><option value="2">P2 值得跟进</option><option value="3">P3 暂存</option></select></label>
        <button className="primary">保存问题</button>
      </form>}
      <p className="privacy-note">线上只保存你的主动记录。本地 Markdown 不会被同步。</p>
    </aside>

    <section className="content-panel">
      <header className="panel-head">
        <div><p className="eyebrow">{eyebrow}</p><h1>{heading}</h1></div>
        <div className="panel-actions">
          <button className={isCapture ? "secondary" : "primary"} onClick={() => setActiveView("capture")}>收录</button>
          {(activeView === "feed" || activeView === "story") && <button className="secondary run-injection" onClick={generateToday} disabled={isGenerating}>{isGenerating ? "生成中" : "生成今日内容"}</button>}
          {selectedQuestion && !isKnowledgeView && <button className="secondary" onClick={() => setShowMaterialForm((visible) => !visible)}>添加材料</button>}
        </div>
      </header>
      {notice && <p className="notice" role="status">{notice}</p>}
      {activeView === "feed" && <KnowledgeFeed mode="feed" cards={feedCards} story={data.todayStory} storyCards={data.storyCards} rawClips={clips} hasMore={Boolean(nextFeedCursor)} isGenerating={isGenerating} onEvent={recordFeedEvent} onLoadMore={loadMoreFeed} onOpenStory={() => setActiveView("story")} onGenerateToday={generateToday} />}
      {activeView === "story" && <KnowledgeFeed mode="story" cards={feedCards} story={data.todayStory} storyCards={data.storyCards} rawClips={clips} hasMore={false} isGenerating={isGenerating} onEvent={recordFeedEvent} onLoadMore={loadMoreFeed} onOpenStory={() => setActiveView("story")} onGenerateToday={generateToday} />}
      {isCapture && <CapturePanel content={captureContent} clips={clips} onContentChange={setCaptureContent} onCaptureClipboard={() => void captureClipboard()} onSubmit={createClip} />}
      {activeView === "raw" && <MaterialLibrary clips={clips} materials={[]} onCapture={() => setActiveView("capture")} />}
      {!isKnowledgeView && !selectedQuestion && activeView !== "materials" && <div className="empty"><h2>先写下一个问题</h2><p>它不需要完整。写下你正在做判断的真实情境，再让材料来挑战它。</p><button className="primary" onClick={() => setShowQuestionForm(true)}>创建第一个问题</button></div>}
      {showMaterialForm && selectedQuestion && !isKnowledgeView && <form className="material-form" onSubmit={createMaterial}>
        <div className="form-title">把一条材料放进这个问题</div>
        <div className="form-grid"><label>类型<select name="type" defaultValue="source"><option value="source">外部来源</option><option value="card">思考卡</option></select></label><label>标题<input name="title" required maxLength={280} placeholder="它在说什么？" /></label></div>
        <label>它带来的挑战<textarea name="challenge" required maxLength={2000} placeholder="它怎样不同意、限制或重写我的判断？" /></label>
        <label>为什么和我有关<textarea name="relevance" required maxLength={2000} placeholder="它会影响我正在做的哪个选择？" /></label>
        <button className="primary">保存材料</button>
      </form>}
      {selectedQuestion && activeView === "pending" && <div className="stream">
        {queue.length === 0 && <div className="empty compact"><h2>这一题暂时没有待回应材料</h2><p>添加一条外部来源或思考卡，让它具体挑战你的初始判断。</p></div>}
        {queue.map((item) => item.kind === "delta" ? <DeltaCard key={item.delta.id} delta={item.delta} material={materials.find((material) => material.id === item.delta.materialId)} /> : <MaterialCard key={item.material.id} material={item.material} onRespond={() => setRespondingTo(item.material)} />)}
      </div>}
      {selectedQuestion && activeView === "questions" && <QuestionList questions={data.questions} selectedId={selectedQuestionId} onSelect={setSelectedQuestionId} />}
      {activeView === "materials" && <MaterialLibrary clips={clips} materials={materials} onCapture={() => setActiveView("capture")} />}
      {selectedQuestion && activeView === "deltas" && <div className="stream">{deltas.length ? deltas.map((delta) => <DeltaCard key={delta.id} delta={delta} material={materials.find((material) => material.id === delta.materialId)} />) : <div className="empty compact"><p>还没有判断差分。</p></div>}</div>}
      {respondingTo && <form className="response-form" onSubmit={createDelta}>
        <div><p className="eyebrow">回应材料</p><h2>{respondingTo.title}</h2></div>
        <label>我的回应<select name="responseType" defaultValue="partially_accept"><option value="partially_accept">部分接受</option><option value="counterargument">提出反驳</option><option value="validate_in_context">拿真实场景验证</option><option value="park">暂存</option></select></label>
        <label>一句理由<textarea name="responseText" required maxLength={2000} placeholder="我具体接受、反驳或准备验证什么？" /></label>
        <label>验证场景（仅验证时必填）<textarea name="validationScenario" maxLength={2000} placeholder="例如：下次做用户访谈时，用这个判断设计一个问题。" /></label>
        <div className="form-actions"><button type="button" className="secondary" onClick={() => setRespondingTo(null)}>取消</button><button className="primary">记录判断差分</button></div>
      </form>}
    </section>

    <aside className="insight-panel">
      {isKnowledgeView ? <FeedLens story={data.todayStory} cards={feedCards} clips={clips} /> : <>
      <p className="eyebrow">当前问题</p><h2>{selectedQuestion?.title ?? "未选择"}</h2>
      <section><p className="section-label">初始判断</p><p>{selectedQuestion?.initialJudgment ?? "先写下你的起点。"}</p></section>
      <section><p className="section-label">当前临时立场</p><p className="muted">尚未确认。这里不会由材料或 AI 自动写入。</p></section>
      <section><p className="section-label">判断差分</p><div className="stat-row"><strong>{unanswered.length}</strong><span>待回应</span></div><div className="stat-row"><strong>{needsValidation.length}</strong><span>待真实场景验证</span></div></section>
      {deltas[0] && <section><p className="section-label">最新记录</p><p className="delta-copy">{deltas[0].responseText}</p></section>}
      </>}
    </aside>

    <nav className="mobile-nav" aria-label="移动端导航">
      <NavButton view="feed" activeView={activeView} onSelect={setActiveView} label="推荐" />
      <NavButton view="story" activeView={activeView} onSelect={setActiveView} label="故事" />
      <NavButton view="capture" activeView={activeView} onSelect={setActiveView} label="收录" />
      <NavButton view="raw" activeView={activeView} onSelect={setActiveView} label="Raw" count={clips.length} />
      <NavButton view="pending" activeView={activeView} onSelect={setActiveView} label="判断" count={needsValidation.length + unanswered.length} />
    </nav>
  </main>;
}

function NavButton({ view, activeView, onSelect, label, count }: { view: View; activeView: View; onSelect: (view: View) => void; label: string; count?: number }) {
  return <button className={activeView === view ? "nav-active" : ""} onClick={() => onSelect(view)}>{label}{typeof count === "number" && <em>{count}</em>}</button>;
}

function FeedLens({ story, cards, clips }: { story: BootstrapPayload["todayStory"]; cards: KnowledgeCard[]; clips: Clip[] }) {
  const queued = clips.filter((clip) => clip.processingStatus === "queued").length;
  const skipped = clips.filter((clip) => clip.processingStatus === "skipped").length;
  return <>
    <p className="eyebrow">知识流</p><h2>{story?.title ?? "下一条知识，来自可追溯的来源"}</h2>
    <section><p className="section-label">推荐池</p><div className="stat-row"><strong>{cards.length}</strong><span>可刷知识卡</span></div></section>
    <section><p className="section-label">Raw 编译</p><div className="stat-row"><strong>{queued}</strong><span>等待编译</span></div><div className="stat-row"><strong>{skipped}</strong><span>停留在 Raw</span></div></section>
    <section><p className="section-label">你的判断</p><p className="muted">知识卡不改写你的立场。需要时，把它作为材料带进判断工作台。</p></section>
  </>;
}

function CapturePanel({ content, clips, onContentChange, onCaptureClipboard, onSubmit }: {
  content: string;
  clips: Clip[];
  onContentChange: (value: string) => void;
  onCaptureClipboard: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return <section className="capture-studio">
    <button type="button" className="primary capture-clipboard" onClick={onCaptureClipboard}>收录剪贴板</button>
    <details className="manual-capture">
      <summary>手动粘贴</summary>
      <form className="capture-form" onSubmit={onSubmit}>
        <textarea name="content" aria-label="粘贴内容" value={content} required maxLength={8000} onChange={(event) => onContentChange(event.target.value)} placeholder="链接或一段文字" />
        <div className="form-actions capture-actions"><button className="secondary">保存</button></div>
      </form>
    </details>
    <section className="recent-clips"><div className="library-heading"><p className="eyebrow">最近收录</p><span>{clips.length}</span></div>{clips.length ? clips.slice(0, 3).map((clip) => <ClipRow key={clip.id} clip={clip} />) : <p className="muted">还没有素材。</p>}</section>
  </section>;
}

function MaterialLibrary({ clips, materials, onCapture }: { clips: Clip[]; materials: Material[]; onCapture: () => void }) {
  return <section className="material-library">
    <div className="library-heading"><div><p className="eyebrow">待整理</p><h2>素材库</h2></div><button className="primary" onClick={onCapture}>收录素材</button></div>
    {clips.length ? <div className="clip-list">{clips.map((clip) => <ClipRow key={clip.id} clip={clip} />)}</div> : <div className="empty compact"><p>还没有收录素材。</p></div>}
    {materials.length > 0 && <><div className="library-heading linked-heading"><div><p className="eyebrow">已关联当前问题</p><h2>判断材料</h2></div></div><div className="stream">{materials.map((material) => <MaterialCard key={material.id} material={material} />)}</div></>}
  </section>;
}

function ClipRow({ clip }: { clip: Clip }) {
  const statuses: Record<Clip["processingStatus"], string> = {
    legacy: "旧收录",
    queued: "等待编译",
    processing: "正在编译",
    compiled: "已编译",
    skipped: clip.processingError || "停留在 Raw",
    failed: clip.processingError || "编译失败",
  };
  return <article className="clip-row"><div className="clip-meta"><span>{statuses[clip.processingStatus]}</span>{clip.sourceUrl && <a href={clip.sourceUrl} target="_blank" rel="noreferrer">打开来源</a>}</div><h3>{clipTitle(clip)}</h3><p>{clip.rawExcerpt || clipPreview(clip)}</p></article>;
}

function MaterialCard({ material, onRespond }: { material: Material; onRespond?: () => void }) {
  return <article className="card material-card"><div className="card-meta">{material.type === "source" ? "外部来源" : "思考卡"}</div><h2>{material.title}</h2><p><b>挑战：</b>{material.challenge}</p><p><b>关联：</b>{material.relevance}</p>{onRespond && <button className="primary" onClick={onRespond}>回应这条材料</button>}</article>;
}

function DeltaCard({ delta, material }: { delta: JudgmentDelta; material?: Material }) {
  return <article className="card delta-card"><div className="card-meta"><span>{delta.status === "needs_validation" ? "待真实场景验证" : "回应已记录"}</span>{material ? ` · ${material.title}` : ""}</div><h2>{responseLabels[delta.responseType]}</h2><p>{delta.responseText}</p>{delta.validationScenario && <p><b>验证场景：</b>{delta.validationScenario}</p>}</article>;
}

function QuestionList({ questions, selectedId, onSelect }: { questions: Question[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return <div className="question-list">{questions.map((question) => <button key={question.id} className={question.id === selectedId ? "question-row selected" : "question-row"} onClick={() => onSelect(question.id)}><span>P{question.priority}</span><strong>{question.title}</strong><small>{question.initialJudgment}</small></button>)}</div>;
}
