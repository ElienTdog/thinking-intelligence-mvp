"use client";

import { type MouseEvent, useEffect, useRef, useState } from "react";
import type { DailyStory, KnowledgeCard, ReviewMoment, WikiSnapshot } from "./lib/types";

type FeedEventType = "seen" | "completed" | "saved" | "less_like" | "opened_source";
export type LearningPromptType = "recall" | "transfer" | "counter";

type KnowledgeFeedProps = {
  mode: "feed" | "story";
  active: boolean;
  cards: KnowledgeCard[];
  story: DailyStory | null;
  storyCards: KnowledgeCard[];
  wiki: WikiSnapshot;
  hasMore: boolean;
  isGenerating: boolean;
  onEvent: (cardId: string, eventType: FeedEventType) => void;
  onLoadMore: () => void;
  onOpenStory: () => void;
  onGenerateToday: () => void;
  onLinkQuestion: (card: KnowledgeCard) => void;
  onRemoveSource: (rawSourceId: string) => void;
  onStartPractice: (pageId: string, promptType: LearningPromptType) => void;
  onOpenSources: () => void;
};

export function KnowledgeFeed({
  mode,
  active,
  cards,
  story,
  storyCards,
  wiki,
  hasMore,
  isGenerating,
  onEvent,
  onLoadMore,
  onOpenStory,
  onGenerateToday,
  onLinkQuestion,
  onRemoveSource,
  onStartPractice,
  onOpenSources,
}: KnowledgeFeedProps) {
  const visibleCards = mode === "story" ? storyCards : cards;
  const followedCards = visibleCards.filter(isFollowedCreator);
  const [selected, setSelected] = useState<KnowledgeCard | null>(null);
  const seenCardId = useRef("");

  useEffect(() => {
    const first = visibleCards[0];
    if (!active || !first || seenCardId.current === first.id) return;
    seenCardId.current = first.id;
    onEvent(first.id, "seen");
  }, [active, onEvent, visibleCards]);

  if (!visibleCards.length) {
    return <section className="feed-empty" aria-label={mode === "story" ? "今日故事" : "推荐知识流"}>
      <p>{mode === "story" ? "今天还没有故事" : "下一条知识正在路上"}</p>
      <span>{mode === "story" ? "当有足够的可核验知识卡时，它会从一个问题开始。" : "你收录的内容，会优先进入这里。"}</span>
      <button onClick={onGenerateToday} disabled={isGenerating}>{isGenerating ? "生成中" : "生成今日内容"}</button>
    </section>;
  }

  return <section className="knowledge-deck" aria-label={mode === "story" ? "今日故事" : "推荐知识流"}>
    <div className="knowledge-scroll">
      {mode === "feed" && wiki.review && <ReviewMomentView review={wiki.review} onPractice={onStartPractice} />}
      {mode === "feed" && !followedCards.length && <FollowedCreatorEmpty onOpenSources={onOpenSources} />}
      {mode === "story" && story && <StoryOpening story={story} />}
      {visibleCards.map((card, index) => <KnowledgeCardView
        key={card.id}
        card={card}
        chapter={mode === "story" ? index + 1 : 0}
        index={index}
        onEvent={onEvent}
        onOpenStory={onOpenStory}
        onOpen={() => {
          setSelected(card);
          onEvent(card.id, "completed");
        }}
      />)}
      {mode === "feed" && (hasMore
        ? <button className="load-more" onClick={onLoadMore}>继续加载</button>
        : <p className="feed-end">刷到底了</p>)}
      {mode === "story" && story && <footer className="story-takeaway"><p>今天带走</p><strong>{story.takeaway}</strong></footer>}
    </div>
    {selected && <KnowledgeDetail
      card={selected}
      onClose={() => setSelected(null)}
      onEvent={onEvent}
      onLinkQuestion={() => { setSelected(null); onLinkQuestion(selected); }}
      onRemoveSource={() => { setSelected(null); onRemoveSource(selected.rawSourceId); }}
      wiki={wiki}
      onStartPractice={onStartPractice}
    />}
  </section>;
}

function FollowedCreatorEmpty({ onOpenSources }: { onOpenSources: () => void }) {
  return <article className="followed-creator-empty">
    <p>关注作者</p>
    <h2>还没有已同步的卡兹克、赛博禅心或 MacTalk 文章。</h2>
    <span>推荐不会把泛资讯伪装成你的关注内容。先把可读原文同步进本地 Wiki，它会在下一次刷新后排到推荐前面。</span>
    <button onClick={onOpenSources}>查看收件箱与同步状态</button>
  </article>;
}

function ReviewMomentView({ review, onPractice }: { review: ReviewMoment; onPractice: (pageId: string, promptType: LearningPromptType) => void }) {
  const prompt = review.promptType === "transfer"
    ? review.page.transferPrompt
    : review.promptType === "counter"
      ? `你会从哪里质疑「${review.page.title}」？`
      : review.page.recallPrompt;
  return <article className="review-moment">
    <div className="knowledge-topline"><span>到期回看</span><span>先不看答案</span></div>
    <div className="knowledge-copy"><h2>{review.page.title}</h2><p>{prompt}</p></div>
    <div className="knowledge-bottom"><span>把它从记忆里取出来，再决定是否留下。</span><button onClick={() => onPractice(review.page.id, review.promptType)}>回应</button></div>
  </article>;
}

function StoryOpening({ story }: { story: DailyStory }) {
  return <article className="story-opening">
    <p>今日故事 · {story.storyDate}</p>
    <h1>{story.title}</h1>
    <span>{story.openingQuestion}</span>
  </article>;
}

function KnowledgeCardView({
  card,
  chapter,
  index,
  onEvent,
  onOpenStory,
  onOpen,
}: {
  card: KnowledgeCard;
  chapter: number;
  index: number;
  onEvent: (cardId: string, eventType: FeedEventType) => void;
  onOpenStory: () => void;
  onOpen: () => void;
}) {
  const tags = parseTags(card.tags);
  const creator = tags.find((tag) => tag.startsWith("creator:"))?.slice(8);
  const [hasCover, setHasCover] = useState(Boolean(card.coverUrl));
  const touchOrigin = useRef<{ x: number; y: number } | null>(null);
  const suppressOpen = useRef(false);

  function openSource(event: MouseEvent<HTMLAnchorElement>) {
    event.stopPropagation();
    onEvent(card.id, "opened_source");
  }

  return <article className={`knowledge-card tone-${index % 3}${hasCover ? " has-cover" : " is-text-only"}`} tabIndex={0}
    onTouchStart={(event) => {
      const touch = event.touches[0];
      touchOrigin.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
      suppressOpen.current = false;
    }}
    onTouchMove={(event) => {
      const origin = touchOrigin.current;
      const touch = event.touches[0];
      if (!origin || !touch) return;
      if (Math.hypot(touch.clientX - origin.x, touch.clientY - origin.y) > 12) suppressOpen.current = true;
    }}
    onClick={() => {
      if (suppressOpen.current) { suppressOpen.current = false; return; }
      onOpen();
    }} onKeyDown={(event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); }
  }}>
    <div className="knowledge-topline"><span>{chapter ? `第 ${chapter} 节` : creator ? `关注作者 · ${creator}` : tags[0] || "AI 与产品"}</span><span>{card.verificationStatus === "verified" ? "已核验" : "主动收录"}</span></div>
    <KnowledgeCover url={card.coverUrl} onUnavailable={() => setHasCover(false)} />
    <div className="knowledge-copy">
      <h2>{card.title}</h2>
      <p>{compactHook(card.hook)}</p>
      {!hasCover && <div className="knowledge-excerpt"><span>进一步理解</span><p>{compactExplanation(card.explanation || card.whyItMatters)}</p></div>}
    </div>
    <div className="knowledge-bottom">
      <div className="knowledge-source"><span>{card.sourceName}</span>{card.sourceUrl && <a href={card.sourceUrl} target="_blank" rel="noreferrer" onClick={openSource}>原文</a>}</div>
      <div className="knowledge-actions" onClick={(event) => event.stopPropagation()}>
        <button onClick={() => onEvent(card.id, "saved")} aria-label="收藏" title="收藏">☆</button>
        <button onClick={() => onEvent(card.id, "less_like")} aria-label="少看这类" title="少看这类">−</button>
        {card.storyId && !chapter && <button onClick={onOpenStory} aria-label="进入今日故事" title="今日故事">↗</button>}
      </div>
    </div>
  </article>;
}

function KnowledgeDetail({ card, onClose, onEvent, onLinkQuestion, onRemoveSource, wiki, onStartPractice }: {
  card: KnowledgeCard;
  onClose: () => void;
  onEvent: (cardId: string, eventType: FeedEventType) => void;
  onLinkQuestion: () => void;
  onRemoveSource: () => void;
  wiki: WikiSnapshot;
  onStartPractice: (pageId: string, promptType: LearningPromptType) => void;
}) {
  const connections = getConnections(card.wikiPageId, wiki);
  return <section className="knowledge-detail" role="dialog" aria-modal="true" aria-label={card.title}
    onTouchStart={(event) => event.stopPropagation()}
    onTouchMove={(event) => event.stopPropagation()}
    onTouchEnd={(event) => event.stopPropagation()}>
    <div className="detail-head"><span>知识点深读 · {card.sourceName}</span><button onClick={onClose} aria-label="关闭详情">×</button></div>
    <KnowledgeCover url={card.coverUrl} detail />
    <h2>{card.title}</h2>
    <section><p>核心观点</p><strong>{card.hook}</strong></section>
    <section><p>为什么成立</p><strong>{card.explanation}</strong></section>
    <section><p>思考方式</p><span>{card.reasoningMove}</span></section>
    <section><p>什么时候不适用</p><span>{card.boundary}</span></section>
    <section><p>对我有什么用</p><span>{card.whyItMatters}</span></section>
    {card.recommendationReason && <section><p>为什么给我</p><span>{card.recommendationReason}</span></section>}
    {connections.length > 0 && <section className="wiki-connections"><p>在 Wiki 里</p><strong>{connections.map((connection) => connection.title).join(" · ")}</strong><span>这些连接只表示主题或阅读关联；是否支持、冲突或适用，仍需回到各自原文判断。</span></section>}
    <section className="detail-next">
      <p>下一步</p>
      <strong>把这条知识变成自己的</strong>
      <span>先读懂，再选一种方式检验：能否复述、迁移，或指出它不成立的地方。</span>
      <div className="detail-actions">
        {card.sourceUrl && <a className="primary-action" href={card.sourceUrl} target="_blank" rel="noreferrer" onClick={() => onEvent(card.id, "opened_source")}>阅读完整原文</a>}
        {card.wikiPageId && <button onClick={() => onStartPractice(card.wikiPageId!, "recall")}>用自己的话复述</button>}
        {card.wikiPageId && <button onClick={() => onStartPractice(card.wikiPageId!, "transfer")}>换个场景试用</button>}
        {card.wikiPageId && <button onClick={() => onStartPractice(card.wikiPageId!, "counter")}>找一个反例</button>}
        <button className="wide-action" onClick={onLinkQuestion}>放进我正在思考的问题</button>
      </div>
    </section>
    <button className="detail-remove" onClick={onRemoveSource}>不再保留这篇来源</button>
  </section>;
}

function KnowledgeCover({ url, detail = false, onUnavailable }: { url: string; detail?: boolean; onUnavailable?: () => void }) {
  const [unavailable, setUnavailable] = useState(false);
  if (!url || unavailable) return null;
  const image = <img className={detail ? "detail-cover" : ""} src={url} alt="" onError={() => { setUnavailable(true); onUnavailable?.(); }} />;
  return detail ? image : <div className="knowledge-cover">{image}</div>;
}

function getConnections(pageId: string | null, wiki: WikiSnapshot) {
  if (!pageId) return [];
  const pageById = new Map(wiki.pages.map((page) => [page.id, page]));
  const seen = new Set<string>();
  return wiki.links.flatMap((link) => {
    if (link.fromPageId !== pageId && link.toPageId !== pageId) return [];
    const otherId = link.fromPageId === pageId ? link.toPageId : link.fromPageId;
    const page = pageById.get(otherId);
    if (!page || seen.has(page.id)) return [];
    seen.add(page.id);
    return [page];
  }).slice(0, 5);
}

function parseTags(value: string) {
  try {
    const tags = JSON.parse(value);
    return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

function compactHook(value: string) {
  const compact = value.replace(/^文章(?:介绍|讲述|讨论|分享)[：:]?\s*/, "").replace(/\s+/g, " ").trim();
  return compact.length > 86 ? `${compact.slice(0, 86)}...` : compact;
}

function compactExplanation(value: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 180)}...` : compact;
}

function isFollowedCreator(card: KnowledgeCard) {
  const creator = parseTags(card.tags).find((tag) => tag.startsWith("creator:"))?.slice(8);
  return creator === "数字生命卡兹克" || creator === "赛博禅心" || creator === "MacTalk" || creator === "量子位" || creator === "Datawhale";
}
