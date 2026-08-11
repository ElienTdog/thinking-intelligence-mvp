"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { KnowledgeFeed, type LearningPromptType } from "./knowledge-feed";
import type { BootstrapPayload, Clip, FeedPayload, KnowledgeCard, Question, WikiPage } from "./lib/types";

type Surface = "feed" | "story" | "raw";
type FeedEventType = "seen" | "completed" | "saved" | "less_like" | "opened_source";
type WikiLint = {
  orphaned: Array<{ id: string; title: string }>;
  missingSources: Array<{ id: string; title: string }>;
  unverified: Array<{ id: string; title: string }>;
};
type SyncStatus = { connected: boolean; lastUsedAt: string; queued: number; loading: number; captured: number; maintaining: number; needsUserOpen: number; failed: number; mirrored: number };

async function requestJson(path: string, body?: unknown, method: "POST" | "PATCH" | "DELETE" = "POST") {
  const response = await fetch(path, method === "DELETE" || method === "PATCH" ? { method } : body === undefined ? undefined : {
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
  const [showSyncConnect, setShowSyncConnect] = useState(false);
  const [syncToken, setSyncToken] = useState("");
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [readingClip, setReadingClip] = useState<Clip | null>(null);
  const [captureContent, setCaptureContent] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [removingId, setRemovingId] = useState("");
  const [retryingId, setRetryingId] = useState("");
  const [linkingCard, setLinkingCard] = useState<KnowledgeCard | null>(null);
  const [practice, setPractice] = useState<{ pageId: string; promptType: LearningPromptType } | null>(null);
  const [showWiki, setShowWiki] = useState(false);
  const [wikiLint, setWikiLint] = useState<WikiLint | null>(null);
  const [wikiQueryResult, setWikiQueryResult] = useState<WikiPage | null>(null);
  const captureFromLinkStarted = useRef(false);
  const touchStart = useRef<{ x: number; y: number; at: number } | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDraggingSurface, setIsDraggingSurface] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await requestJson("/api/bootstrap") as BootstrapPayload;
      setData(next);
      void fetch("/api/local-sync/status").then((response) => response.ok ? response.json() : null).then((status) => { if (status) setSyncStatus(status as SyncStatus); }).catch(() => undefined);
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
      const result = await requestJson("/api/clips", { content: value }) as { duplicate?: boolean };
      setCaptureContent("");
      setShowCapture(false);
      setNotice(result.duplicate ? "这条来源已经在收件箱里了。" : "已排队，Mac 上的浏览器采集桥会继续处理。 ");
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
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (surface !== "raw") return;
    const timer = window.setInterval(() => { void load(); }, 6000);
    return () => window.clearInterval(timer);
  }, [load, surface]);

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
    void load()
      .then(() => setNotice("已刷新本地 Wiki 的在线镜像。"))
      .catch((error) => setNotice(error instanceof Error ? error.message : "暂时无法刷新镜像"))
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

  const retrySource = useCallback(async (clip: Clip) => {
    setRetryingId(clip.id);
    try {
      await requestJson(`/api/clips/${clip.id}`, undefined, "PATCH");
      setNotice("已重新排队，等待本机浏览器采集桥。 ");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "暂时无法重试采集");
    } finally {
      setRetryingId("");
    }
  }, [load]);

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

  const savePractice = useCallback(async (pageId: string, promptType: LearningPromptType, response: string) => {
    try {
      await requestJson("/api/learning-attempts", { pageId, promptType, response });
      setPractice(null);
      setNotice("已留下这次回应。明天它会回来问你一次。");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "这次回应没有保存");
    }
  }, [load]);

  const openWiki = useCallback(() => {
    setShowWiki(true);
    void requestJson("/api/wiki/lint")
      .then((result) => setWikiLint(result as WikiLint))
      .catch((error) => setNotice(error instanceof Error ? error.message : "暂时无法检查 Wiki"));
  }, []);

  const createSyncToken = useCallback(async () => {
    try {
      const result = await requestJson("/api/local-sync/token", {}) as { token: string };
      setSyncToken(result.token);
      setShowSyncConnect(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "暂时无法创建本地同步凭证");
    }
  }, []);

  const askWiki = useCallback(async (question: string) => {
    try {
      const result = await requestJson("/api/wiki/query", { question }) as { page: WikiPage };
      setWikiQueryResult(result.page);
      setNotice("回答已写入 Wiki。它保留了可回看的来源关系。");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Wiki 暂时无法回答这个问题");
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
    if (surface === "story" && direction === "right") setSurface("feed");
    if (surface === "feed") setSurface(direction === "left" ? "story" : "raw");
    if (surface === "raw" && direction === "left") setSurface("feed");
  }

  function beginTouch(event: React.TouchEvent<HTMLElement>) {
    const touch = event.touches[0];
    touchStart.current = touch ? { x: touch.clientX, y: touch.clientY, at: performance.now() } : null;
  }

  function moveTouch(event: React.TouchEvent<HTMLElement>) {
    const start = touchStart.current;
    const touch = event.touches[0];
    if (!start || !touch) return;
    const horizontal = touch.clientX - start.x;
    const vertical = touch.clientY - start.y;
    if (Math.abs(horizontal) < 10 || Math.abs(horizontal) <= Math.abs(vertical)) return;
    event.preventDefault();
    const blocked = (surface === "raw" && horizontal < 0) || (surface === "story" && horizontal > 0);
    const maxDrag = Math.min(window.innerWidth * 0.3, 160);
    setIsDraggingSurface(true);
    setDragOffset(Math.max(-maxDrag, Math.min(maxDrag, blocked ? horizontal * 0.18 : horizontal)));
  }

  function finishTouch(event: React.TouchEvent<HTMLElement>) {
    const start = touchStart.current;
    const end = event.changedTouches[0];
    touchStart.current = null;
    setIsDraggingSurface(false);
    setDragOffset(0);
    if (!start || !end) return;
    const horizontal = end.clientX - start.x;
    const vertical = end.clientY - start.y;
    const velocity = Math.abs(horizontal) / Math.max(1, performance.now() - start.at);
    if ((Math.abs(horizontal) < 64 && velocity < 0.55) || Math.abs(horizontal) < Math.abs(vertical) * 1.2) return;
    moveSurface(horizontal < 0 ? "right" : "left");
  }

  if (!data) return <main className="loading" aria-busy="true"><div className="loading-stack"><span /><span /><span /></div><p>正在打开知识流</p></main>;

  const surfaceIndex = surface === "story" ? 0 : surface === "feed" ? 1 : 2;
  const practicePage = practice ? data.wiki.pages.find((page) => page.id === practice.pageId) ?? null : null;

  return <main
    className={`feed-app feed-app--${surface}${isDraggingSurface ? " is-dragging" : ""}`}
    onTouchStart={beginTouch}
    onTouchMove={moveTouch}
    onTouchEnd={finishTouch}
    onTouchCancel={() => { touchStart.current = null; setIsDraggingSurface(false); setDragOffset(0); }}
  >
    <div className="feed-chrome" aria-label="知识流控制">
      <button className="capture-trigger" onClick={() => setShowCapture(true)} aria-label="收录内容" title="收录内容">+</button>
      <div className="surface-mark" aria-label={surface === "feed" ? "推荐" : surface === "story" ? "故事" : "来源收件箱"}>
        <span className={surface === "story" ? "is-current" : ""} />
        <span className={surface === "feed" ? "is-current" : ""} />
        <span className={surface === "raw" ? "is-current" : ""} />
      </div>
      <button className="feed-account" aria-label={`当前用户：${displayName}`} title={displayName}>{displayName.slice(0, 1) || "我"}</button>
    </div>

    {notice && <p className="feed-toast" role="status">{notice}</p>}

    {surface !== "story" && <button className="surface-edge surface-edge--left" onClick={() => moveSurface("left")} aria-label={surface === "feed" ? "进入今日故事" : "回到推荐"} title={surface === "feed" ? "今日故事" : "推荐"}>‹</button>}
    {surface !== "raw" && <button className="surface-edge surface-edge--right" onClick={() => moveSurface("right")} aria-label={surface === "feed" ? "查看来源收件箱" : "回到推荐"} title={surface === "feed" ? "来源收件箱" : "推荐"}>›</button>}

    <div
      className="surface-track"
      style={{ transform: `translate3d(calc(-${surfaceIndex * 100}vw + ${dragOffset}px), 0, 0)` }}
      aria-live="polite"
    >
      <section className="surface-panel" aria-hidden={surface !== "story"}>
        <KnowledgeFeed
          mode="story"
          active={surface === "story"}
          cards={feedCards}
          story={data.todayStory}
          storyCards={data.storyCards}
          wiki={data.wiki}
          hasMore={false}
          isGenerating={isGenerating}
          onEvent={recordFeedEvent}
          onLoadMore={loadMoreFeed}
          onOpenStory={() => setSurface("story")}
          onGenerateToday={generateToday}
          onLinkQuestion={setLinkingCard}
          onStartPractice={(pageId, promptType) => setPractice({ pageId, promptType })}
          onOpenSources={() => setSurface("raw")}
          onRemoveSource={(rawSourceId) => {
            const clip = data.clips.find((item) => item.id === rawSourceId);
            if (clip) void removeSource(clip);
          }}
        />
      </section>
      <section className="surface-panel" aria-hidden={surface !== "feed"}>
        <KnowledgeFeed
          mode="feed"
          active={surface === "feed"}
          cards={feedCards}
          story={data.todayStory}
          storyCards={data.storyCards}
          wiki={data.wiki}
          hasMore={Boolean(nextFeedCursor)}
          isGenerating={isGenerating}
          onEvent={recordFeedEvent}
          onLoadMore={loadMoreFeed}
          onOpenStory={() => setSurface("story")}
          onGenerateToday={generateToday}
          onLinkQuestion={setLinkingCard}
          onStartPractice={(pageId, promptType) => setPractice({ pageId, promptType })}
          onOpenSources={() => setSurface("raw")}
          onRemoveSource={(rawSourceId) => {
            const clip = data.clips.find((item) => item.id === rawSourceId);
            if (clip) void removeSource(clip);
          }}
        />
      </section>
      <section className="surface-panel" aria-hidden={surface !== "raw"}>
        <RawSurface clips={data.clips} syncStatus={syncStatus} removingId={removingId} retryingId={retryingId} onCapture={() => setShowCapture(true)} onRemove={removeSource} onRetry={retrySource} onOpenWiki={openWiki} onConnect={() => void createSyncToken()} onRead={setReadingClip} />
      </section>
    </div>

    {showCapture && <CaptureSheet
      content={captureContent}
      onContentChange={setCaptureContent}
      onCaptureClipboard={() => void captureClipboard()}
      onClose={() => setShowCapture(false)}
      onSubmit={submitCapture}
    />}
    {showSyncConnect && <SyncConnectSheet token={syncToken} onClose={() => setShowSyncConnect(false)} />}
    {readingClip && <RawReadingSheet clip={readingClip} onClose={() => setReadingClip(null)} />}
    {linkingCard && <QuestionBridge card={linkingCard} questions={data.questions} onClose={() => setLinkingCard(null)} onSelect={(question) => void connectToQuestion(question)} onCreate={(title, initialJudgment) => void createQuestion(title, initialJudgment)} />}
    {practice && practicePage && <PracticeSheet key={`${practicePage.id}:${practice.promptType}`} page={practicePage} initialPromptType={practice.promptType} onClose={() => setPractice(null)} onSubmit={(promptType, response) => void savePractice(practicePage.id, promptType, response)} />}
    {showWiki && <WikiSheet pages={data.wiki.pages} activity={data.wiki.activity} lint={wikiLint} queryResult={wikiQueryResult} onAsk={(question) => void askWiki(question)} onClose={() => setShowWiki(false)} />}
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
    <div className="sheet-head"><p>来源收件箱</p><button onClick={onClose} aria-label="关闭收录">×</button></div>
    <button className="clipboard-capture" type="button" onClick={onCaptureClipboard}>收录剪贴板</button>
    <form onSubmit={onSubmit}>
      <textarea value={content} onChange={(event) => onContentChange(event.target.value)} required maxLength={8000} placeholder="粘贴一个链接或一段原始文字" aria-label="要收录的内容" />
      <button className="capture-submit">放入收件箱</button>
    </form>
  </section>;
}

function RawSurface({ clips, syncStatus, removingId, retryingId, onCapture, onRemove, onRetry, onOpenWiki, onConnect, onRead }: {
  clips: Clip[];
  syncStatus: SyncStatus | null;
  removingId: string;
  retryingId: string;
  onCapture: () => void;
  onRemove: (clip: Clip) => void;
  onRetry: (clip: Clip) => void;
  onOpenWiki: () => void;
  onConnect: () => void;
  onRead: (clip: Clip) => void;
}) {
  const labels: Record<Clip["processingStatus"], string> = {
    legacy: "旧收录",
    inbox: "等待迁移",
    needs_clipper: "需你打开",
    queued: "已排队",
    loading: "浏览器加载中",
    captured: "正文已获取",
    maintaining: "DeepSeek 维护中",
    mirrored: "已镜像",
    needs_user_open: "需你打开",
    processing: "正在编译",
    compiled: "已编译",
    skipped: "停留在 Raw",
    failed: "编译失败",
  };
  const activeCount = syncStatus ? syncStatus.queued + syncStatus.loading + syncStatus.captured + syncStatus.maintaining : 0;
  const syncLabel = !syncStatus ? "正在读取同步状态" : syncStatus.connected ? `处理中 ${activeCount} · 需打开 ${syncStatus.needsUserOpen} · 已镜像 ${syncStatus.mirrored}` : "尚未连接本地 Wiki";
  return <section className="raw-surface" aria-label="来源收件箱">
    <header className="raw-head"><div><p>来源收件箱</p><span>{clips.length} 条来源；{syncLabel}</span></div><div className="raw-head-actions"><button className="raw-index-trigger" onClick={onOpenWiki} aria-label="打开知识索引" title="知识索引与自检">⌘</button><button className="raw-sync-trigger" onClick={onConnect} aria-label="连接本地 Wiki" title="连接本地 Wiki">⌁</button><button onClick={onCapture} aria-label="收录来源" title="收录来源">+</button></div></header>
    {clips.length ? <div className="raw-grid">{clips.map((clip) => <article className="raw-card" key={clip.id}>
      <div className="raw-card-top"><span>{labels[clip.processingStatus]}</span><button onClick={() => onRemove(clip)} disabled={removingId === clip.id}>{removingId === clip.id ? "移除中" : "移除"}</button></div>
      <h2>{clipTitle(clip)}</h2>
      <p>{clipPreview(clip)}</p>
      {clip.processingError && <p className="raw-error">{clip.processingError}</p>}
      <footer><span>{clip.localPath ? `Wiki：${clip.localPath}` : clip.processingStatus === "needs_user_open" || clip.processingStatus === "needs_clipper" ? "正文尚未获取" : "等待本地写入"}</span></footer>
      <div className="raw-card-actions">
        {clip.sourceUrl && (clip.processingStatus === "needs_user_open" || clip.processingStatus === "needs_clipper") && <a href={clip.sourceUrl} target="_blank" rel="noreferrer">在浏览器打开</a>}
        {clip.sourceUrl && clip.processingStatus !== "needs_user_open" && clip.processingStatus !== "needs_clipper" && <a href={clip.sourceUrl} target="_blank" rel="noreferrer">打开原文</a>}
        {["captured", "maintaining", "mirrored"].includes(clip.processingStatus) && <button className="raw-read" onClick={() => onRead(clip)}>在线阅读</button>}
        {["needs_user_open", "needs_clipper", "failed"].includes(clip.processingStatus) && <button className="raw-retry" onClick={() => onRetry(clip)} disabled={retryingId === clip.id}>{retryingId === clip.id ? "重新排队中" : "重试采集"}</button>}
      </div>
    </article>)}</div> : <div className="raw-empty"><p>还没有 Raw。</p><button onClick={onCapture}>收录第一条</button></div>}
  </section>;
}

function RawReadingSheet({ clip, onClose }: { clip: Clip; onClose: () => void }) {
  return <section className="raw-reading-sheet" role="dialog" aria-modal="true" aria-label={`阅读 ${clipTitle(clip)}`}>
    <div className="sheet-head"><div><p>{clipTitle(clip)}</p><span>{clip.localPath || "本地 Wiki 镜像"}</span></div><button onClick={onClose} aria-label="关闭阅读">×</button></div>
    {clip.sourceUrl && <a href={clip.sourceUrl} target="_blank" rel="noreferrer">打开原文</a>}
    <article>{clip.content}</article>
  </section>;
}

function SyncConnectSheet({ token, onClose }: { token: string; onClose: () => void }) {
  const command = `python3 tools/wiki_inbox_sync.py --server "${window.location.origin}" --token "${token}" --configure`;
  async function copyCommand() {
    await navigator.clipboard.writeText(command);
  }
  return <section className="capture-sheet sync-connect-sheet" role="dialog" aria-modal="true" aria-label="连接本地 Wiki">
    <div className="sheet-handle" />
    <div className="sheet-head"><div><p>连接本地 Wiki</p><span>这个凭证只显示一次</span></div><button onClick={onClose} aria-label="关闭连接说明">×</button></div>
    <p className="sync-connect-copy">在 Mac 终端、`/Users/bytedance/Documents/思考` 文件夹下运行一次。它会把凭证保存到钥匙串，不会写入你的笔记。</p>
    <code className="sync-command">{command}</code>
    <button className="capture-submit" type="button" onClick={() => void copyCommand()}>复制连接命令</button>
    <p className="sync-connect-copy">之后运行同一个脚本即可把收件箱写入本地 Wiki；自动登录运行的安装项会在下一步提供。</p>
  </section>;
}

function PracticeSheet({ page, initialPromptType, onClose, onSubmit }: {
  page: WikiPage;
  initialPromptType: LearningPromptType;
  onClose: () => void;
  onSubmit: (promptType: LearningPromptType, response: string) => void;
}) {
  const [promptType, setPromptType] = useState<LearningPromptType>(initialPromptType);
  const [response, setResponse] = useState("");
  const prompt = promptType === "transfer"
    ? page.transferPrompt
    : promptType === "counter"
      ? `你会从哪里质疑「${page.title}」？哪条证据会改变你的看法？`
      : page.recallPrompt;
  return <section className="practice-sheet" role="dialog" aria-modal="true" aria-label="知识练习">
    <div className="sheet-handle" />
    <div className="sheet-head"><div><p>回想一下</p><span>{page.title}</span></div><button onClick={onClose} aria-label="关闭练习">×</button></div>
    <div className="practice-modes" role="group" aria-label="回应方式">
      <button className={promptType === "recall" ? "is-active" : ""} onClick={() => setPromptType("recall")}>复述</button>
      <button className={promptType === "transfer" ? "is-active" : ""} onClick={() => setPromptType("transfer")}>迁移</button>
      <button className={promptType === "counter" ? "is-active" : ""} onClick={() => setPromptType("counter")}>反驳</button>
    </div>
    <p className="practice-prompt">{prompt}</p>
    <form onSubmit={(event) => { event.preventDefault(); onSubmit(promptType, response); }}>
      <textarea value={response} onChange={(event) => setResponse(event.target.value)} required maxLength={2000} placeholder="先写你自己的答案" aria-label="你的回应" />
      <button className="practice-submit">留下回应</button>
    </form>
  </section>;
}

function WikiSheet({ pages, activity, lint, queryResult, onAsk, onClose }: {
  pages: WikiPage[];
  activity: BootstrapPayload["wiki"]["activity"];
  lint: WikiLint | null;
  queryResult: WikiPage | null;
  onAsk: (question: string) => void;
  onClose: () => void;
}) {
  const topics = pages.filter((page) => page.kind === "topic").slice(0, 18);
  const issueCount = (lint?.orphaned.length ?? 0) + (lint?.missingSources.length ?? 0) + (lint?.unverified.length ?? 0);
  const [question, setQuestion] = useState("");
  return <section className="wiki-sheet" role="dialog" aria-modal="true" aria-label="知识索引">
    <div className="sheet-handle" />
    <div className="sheet-head"><div><p>Wiki</p><span>{pages.filter((page) => page.kind === "claim").length} 个知识页，{topics.length} 个主题索引</span></div><button onClick={onClose} aria-label="关闭知识索引">×</button></div>
    <form className="wiki-query" onSubmit={(event) => { event.preventDefault(); if (!question.trim()) return; onAsk(question); setQuestion(""); }}>
      <label htmlFor="wiki-question">问 Wiki</label>
      <div><input id="wiki-question" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} placeholder="这些观点之间，我应该如何判断？" /><button>提问</button></div>
    </form>
    {queryResult && <section className="wiki-sheet-section wiki-answer"><p>{queryResult.title}</p><strong>{queryResult.summary}</strong><span>这张综合页已经进入索引和变更日志，可继续回到关联知识页核验。</span></section>}
    <section className="wiki-sheet-section"><p>索引</p><div className="wiki-topic-list">{topics.length ? topics.map((topic) => <span key={topic.id}>{topic.title}</span>) : <span>等待第一张知识页</span>}</div></section>
    <section className="wiki-sheet-section"><p>最近变动</p>{activity.length ? <ul>{activity.slice(0, 6).map((item) => <li key={item.id}>{item.message}</li>)}</ul> : <span>还没有变动记录。</span>}</section>
    <section className="wiki-sheet-section"><p>自检</p><strong>{lint ? issueCount ? `${issueCount} 项需要回看` : "当前关系与来源完整" : "正在检查来源与关系"}</strong>{lint && issueCount > 0 && <span>未核验 {lint.unverified.length}，缺少来源 {lint.missingSources.length}，孤立页 {lint.orphaned.length}</span>}</section>
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
