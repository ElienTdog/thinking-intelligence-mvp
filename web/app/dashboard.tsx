"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { KnowledgeFeed } from "./knowledge-feed";
import type { BootstrapPayload, Clip, FeedPayload, KnowledgeCard, Question } from "./lib/types";

type Surface = "feed" | "story" | "raw";
type FeedEventType = "seen" | "completed" | "saved" | "less_like" | "opened_source";

async function requestJson(path: string, body?: unknown, method: "POST" | "DELETE" = "POST") {
  const response = await fetch(path, method === "DELETE" ? { method } : body === undefined ? undefined : {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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
      return "未命名来源";
    }
  }
  return clip.content.split("\n").find(Boolean)?.slice(0, 48) || "未命名内容";
}

function clipPreview(clip: Clip) {
  const preview = (clip.rawExcerpt || clip.content).replace(/\s+/g, " ").trim();
  return preview.length > 116 ? `${preview.slice(0, 116)}...` : preview;
}

export function JudgmentWorkbench({ displayName }: { displayName: string }) {
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [surface, setSurface] = useState<Surface>("feed");
  const [feedCards, setFeedCards] = useState<KnowledgeCard[]>([]);
  const [nextFeedCursor, setNextFeedCursor] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [showCapture, setShowCapture] = useState(false);
  const [captureContent, setCaptureContent] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [removingId, setRemovingId] = useState("");
  const [linkingCard, setLinkingCard] = useState<KnowledgeCard | null>(null);
  const captureFromLinkStarted = useRef(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

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
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "暂时无法读取知识流");
    }
  }, []);

  const saveClip = useCallback(async (content: string) => {
    const value = content.trim();
    if (!value) return;
    try {
      const result = await requestJson("/api/clips", { content: value }) as { card?: { id: string } | null; duplicate?: boolean };
      setCaptureContent("");
      setShowCapture(false);
      setNotice(result.duplicate ? "这条内容已经在 Raw 里了。" : result.card ? "已收录，正在进入推荐。" : "已收录到 Raw。它会等到有可用原文时再编译。");
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
    const timer = window.setTimeout(() => { void saveClip(value); }, 0);
    window.history.replaceState({}, "", window.location.pathname);
    return () => window.clearTimeout(timer);
  }, [saveClip]);

  const recordFeedEvent = useCallback((cardId: string, eventType: FeedEventType) => {
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
    void requestJson("/api/injection/run", {})
      .then(async () => {
        setNotice("今日内容已刷新。");
        await load();
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : "今日内容生成失败"))
      .finally(() => setIsGenerating(false));
  }, [load]);

  const removeSource = useCallback(async (clip: Clip) => {
    const title = clipTitle(clip);
    if (!window.confirm(`移除「${title}」以及由它生成的知识卡？`)) return;
    setRemovingId(clip.id);
    try {
      await requestJson(`/api/clips/${clip.id}`, undefined, "DELETE");
      setFeedCards((current) => current.filter((card) => card.rawSourceId !== clip.id));
      setData((current) => current ? {
        ...current,
        clips: current.clips.filter((item) => item.id !== clip.id),
        cards: current.cards.filter((card) => card.rawSourceId !== clip.id),
        storyCards: current.storyCards.filter((card) => card.rawSourceId !== clip.id),
      } : current);
      setNotice("来源已移除。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "移除失败");
    } finally {
      setRemovingId("");
    }
  }, []);

  const connectToQuestion = useCallback(async (question: Question) => {
    if (!linkingCard) return;
    try {
      await requestJson("/api/materials", {
        questionId: question.id,
        type: "source",
        title: linkingCard.title,
        challenge: linkingCard.explanation,
        relevance: linkingCard.whyItMatters,
      });
      setLinkingCard(null);
      setNotice(`已放进「${question.title}」。它没有替你改变判断。`);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "关联失败");
    }
  }, [linkingCard, load]);

  const createQuestion = useCallback(async (title: string, initialJudgment: string) => {
    try {
      await requestJson("/api/questions", { title, initialJudgment, priority: 1 });
      setNotice("问题已保存。知识不会替你写出结论。");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存问题失败");
    }
  }, [load]);

  async function captureClipboard() {
    if (!navigator.clipboard?.readText) {
      setNotice("当前浏览器无法读取剪贴板，请直接粘贴。");
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

  function submitCapture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void saveClip(captureContent);
  }

  function moveSurface(direction: "left" | "right") {
    if (surface === "feed") setSurface(direction === "left" ? "story" : "raw");
    if (surface === "story" && direction === "right") setSurface("feed");
    if (surface === "raw" && direction === "left") setSurface("feed");
  }

  function finishTouch(event: React.TouchEvent<HTMLElement>) {
    const start = touchStart.current;
    const end = event.changedTouches[0];
    touchStart.current = null;
    if (!start || !end) return;
    const horizontal = end.clientX - start.x;
    const vertical = end.clientY - start.y;
    if (Math.abs(horizontal) < 64 || Math.abs(horizontal) < Math.abs(vertical) * 1.2) return;
    moveSurface(horizontal < 0 ? "left" : "right");
  }

  if (!data) return <main className="loading" aria-busy="true"><div className="loading-stack"><span /><span /><span /></div><p>正在打开知识流</p></main>;

  return <main
    className={`feed-app feed-app--${surface}`}
    onTouchStart={(event) => { const touch = event.touches[0]; touchStart.current = { x: touch.clientX, y: touch.clientY }; }}
    onTouchEnd={finishTouch}
  >
    <div className="feed-chrome" aria-label="知识流控制">
      <button className="capture-trigger" onClick={() => setShowCapture(true)} aria-label="收录内容" title="收录内容">+</button>
      <div className="surface-mark" aria-label={surface === "feed" ? "推荐" : surface === "story" ? "故事" : "Raw 来源"}>
        <span className={surface === "story" ? "is-current" : ""} />
        <span className={surface === "feed" ? "is-current" : ""} />
        <span className={surface === "raw" ? "is-current" : ""} />
      </div>
      <button className="feed-account" aria-label={`当前用户：${displayName}`} title={displayName}>{displayName.slice(0, 1) || "我"}</button>
    </div>

    {notice && <p className="feed-toast" role="status">{notice}</p>}

    {surface !== "story" && <button className="surface-edge surface-edge--left" onClick={() => moveSurface("left")} aria-label={surface === "feed" ? "进入今日故事" : "回到推荐"} title={surface === "feed" ? "今日故事" : "推荐"}>‹</button>}
    {surface !== "raw" && <button className="surface-edge surface-edge--right" onClick={() => moveSurface("right")} aria-label={surface === "feed" ? "查看 Raw 来源" : "回到推荐"} title={surface === "feed" ? "Raw 来源" : "推荐"}>›</button>}

    {surface === "feed" && <KnowledgeFeed
      mode="feed"
      cards={feedCards}
      story={data.todayStory}
      storyCards={data.storyCards}
      hasMore={Boolean(nextFeedCursor)}
      isGenerating={isGenerating}
      onEvent={recordFeedEvent}
      onLoadMore={loadMoreFeed}
      onOpenStory={() => setSurface("story")}
      onGenerateToday={generateToday}
      onLinkQuestion={setLinkingCard}
      onRemoveSource={(rawSourceId) => {
        const clip = data.clips.find((item) => item.id === rawSourceId);
        if (clip) void removeSource(clip);
      }}
    />}
    {surface === "story" && <KnowledgeFeed
      mode="story"
      cards={feedCards}
      story={data.todayStory}
      storyCards={data.storyCards}
      hasMore={false}
      isGenerating={isGenerating}
      onEvent={recordFeedEvent}
      onLoadMore={loadMoreFeed}
      onOpenStory={() => setSurface("story")}
      onGenerateToday={generateToday}
      onLinkQuestion={setLinkingCard}
      onRemoveSource={(rawSourceId) => {
        const clip = data.clips.find((item) => item.id === rawSourceId);
        if (clip) void removeSource(clip);
      }}
    />}
    {surface === "raw" && <RawSurface clips={data.clips} removingId={removingId} onCapture={() => setShowCapture(true)} onRemove={removeSource} />}

    {showCapture && <CaptureSheet
      content={captureContent}
      onContentChange={setCaptureContent}
      onCaptureClipboard={() => void captureClipboard()}
      onClose={() => setShowCapture(false)}
      onSubmit={submitCapture}
    />}
    {linkingCard && <QuestionBridge card={linkingCard} questions={data.questions} onClose={() => setLinkingCard(null)} onSelect={(question) => void connectToQuestion(question)} onCreate={(title, initialJudgment) => void createQuestion(title, initialJudgment)} />}
  </main>;
}

function CaptureSheet({ content, onContentChange, onCaptureClipboard, onClose, onSubmit }: {
  content: string;
  onContentChange: (value: string) => void;
  onCaptureClipboard: () => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return <section className="capture-sheet" role="dialog" aria-modal="true" aria-label="收录内容">
    <div className="sheet-handle" />
    <div className="sheet-head"><p>收录</p><button onClick={onClose} aria-label="关闭收录">×</button></div>
    <button className="clipboard-capture" type="button" onClick={onCaptureClipboard}>收录剪贴板</button>
    <form onSubmit={onSubmit}>
      <textarea value={content} onChange={(event) => onContentChange(event.target.value)} required maxLength={8000} placeholder="链接或一段文字" aria-label="要收录的内容" />
      <button className="capture-submit">收录</button>
    </form>
  </section>;
}

function RawSurface({ clips, removingId, onCapture, onRemove }: {
  clips: Clip[];
  removingId: string;
  onCapture: () => void;
  onRemove: (clip: Clip) => void;
}) {
  const labels: Record<Clip["processingStatus"], string> = {
    legacy: "旧收录",
    queued: "等待编译",
    processing: "正在编译",
    compiled: "已编译",
    skipped: "停留在 Raw",
    failed: "编译失败",
  };
  return <section className="raw-surface" aria-label="Raw 来源">
    <header className="raw-head"><div><p>Raw</p><span>{clips.length} 个原始来源</span></div><button onClick={onCapture} aria-label="收录来源" title="收录来源">+</button></header>
    {clips.length ? <div className="raw-grid">{clips.map((clip) => <article className="raw-card" key={clip.id}>
      <div className="raw-card-top"><span>{labels[clip.processingStatus]}</span><button onClick={() => onRemove(clip)} disabled={removingId === clip.id}>{removingId === clip.id ? "移除中" : "移除"}</button></div>
      <h2>{clipTitle(clip)}</h2>
      <p>{clipPreview(clip)}</p>
      <footer>{clip.sourceUrl ? <a href={clip.sourceUrl} target="_blank" rel="noreferrer">{clip.publisher || "打开原文"}</a> : <span>主动收录</span>}<span>{clip.verificationStatus === "verified" ? "已核验" : clip.verificationStatus === "needs_transcript" ? "缺少文字稿" : "待核验"}</span></footer>
    </article>)}</div> : <div className="raw-empty"><p>还没有 Raw。</p><button onClick={onCapture}>收录第一条</button></div>}
  </section>;
}

function QuestionBridge({ card, questions, onClose, onSelect, onCreate }: {
  card: KnowledgeCard;
  questions: Question[];
  onClose: () => void;
  onSelect: (question: Question) => void;
  onCreate: (title: string, initialJudgment: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [initialJudgment, setInitialJudgment] = useState("");
  return <section className="question-bridge" role="dialog" aria-modal="true" aria-label="放进问题">
    <div className="sheet-handle" />
    <div className="sheet-head"><div><p>放进一个问题</p><span>{card.title}</span></div><button onClick={onClose} aria-label="关闭">×</button></div>
    {questions.length ? <div className="question-options">{questions.map((question) => <button key={question.id} onClick={() => onSelect(question)}><strong>{question.title}</strong><span>{question.initialJudgment}</span></button>)}</div> : <form className="new-question" onSubmit={(event) => { event.preventDefault(); onCreate(title, initialJudgment); }}>
      <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={280} required placeholder="我正在判断什么？" aria-label="问题" />
      <textarea value={initialJudgment} onChange={(event) => setInitialJudgment(event.target.value)} maxLength={2000} required placeholder="先留下你此刻的判断" aria-label="初始判断" />
      <button>保存问题</button>
    </form>}
  </section>;
}
