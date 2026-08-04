"use client";

import { type MouseEvent, useEffect, useRef, useState } from "react";
import type { DailyStory, KnowledgeCard } from "./lib/types";

type FeedEventType = "seen" | "completed" | "saved" | "less_like" | "opened_source";

type KnowledgeFeedProps = {
  mode: "feed" | "story";
  cards: KnowledgeCard[];
  story: DailyStory | null;
  storyCards: KnowledgeCard[];
  hasMore: boolean;
  isGenerating: boolean;
  onEvent: (cardId: string, eventType: FeedEventType) => void;
  onLoadMore: () => void;
  onOpenStory: () => void;
  onGenerateToday: () => void;
  onLinkQuestion: (card: KnowledgeCard) => void;
  onRemoveSource: (rawSourceId: string) => void;
};

export function KnowledgeFeed({
  mode,
  cards,
  story,
  storyCards,
  hasMore,
  isGenerating,
  onEvent,
  onLoadMore,
  onOpenStory,
  onGenerateToday,
  onLinkQuestion,
  onRemoveSource,
}: KnowledgeFeedProps) {
  const visibleCards = mode === "story" ? storyCards : cards;
  const [selected, setSelected] = useState<KnowledgeCard | null>(null);
  const seenCardId = useRef("");

  useEffect(() => {
    const first = visibleCards[0];
    if (!first || seenCardId.current === first.id) return;
    seenCardId.current = first.id;
    onEvent(first.id, "seen");
  }, [onEvent, visibleCards]);

  if (!visibleCards.length) {
    return <section className="feed-empty" aria-label={mode === "story" ? "今日故事" : "推荐知识流"}>
      <p>{mode === "story" ? "今天还没有故事" : "下一条知识正在路上"}</p>
      <span>{mode === "story" ? "当有足够的可核验知识卡时，它会从一个问题开始。" : "你收录的内容，会优先进入这里。"}</span>
      <button onClick={onGenerateToday} disabled={isGenerating}>{isGenerating ? "生成中" : "生成今日内容"}</button>
    </section>;
  }

  return <section className="knowledge-deck" aria-label={mode === "story" ? "今日故事" : "推荐知识流"}>
    <div className="knowledge-scroll">
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
      onOpenStory={onOpenStory}
      onLinkQuestion={() => { setSelected(null); onLinkQuestion(selected); }}
      onRemoveSource={() => { setSelected(null); onRemoveSource(selected.rawSourceId); }}
    />}
  </section>;
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

  function openSource(event: MouseEvent<HTMLAnchorElement>) {
    event.stopPropagation();
    onEvent(card.id, "opened_source");
  }

  return <article className={`knowledge-card tone-${index % 3}`} tabIndex={0} onClick={onOpen} onKeyDown={(event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); }
  }}>
    <div className="knowledge-topline"><span>{chapter ? `第 ${chapter} 节` : tags[0] || "AI 与产品"}</span><span>{card.verificationStatus === "verified" ? "已核验" : "主动收录"}</span></div>
    <div className="knowledge-copy"><h2>{card.hook}</h2><p>{card.title}</p></div>
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

function KnowledgeDetail({ card, onClose, onEvent, onOpenStory, onLinkQuestion, onRemoveSource }: {
  card: KnowledgeCard;
  onClose: () => void;
  onEvent: (cardId: string, eventType: FeedEventType) => void;
  onOpenStory: () => void;
  onLinkQuestion: () => void;
  onRemoveSource: () => void;
}) {
  return <section className="knowledge-detail" role="dialog" aria-modal="true" aria-label={card.title}>
    <div className="detail-head"><span>{card.sourceName}</span><button onClick={onClose} aria-label="关闭详情">×</button></div>
    <h2>{card.hook}</h2>
    <section><p>核心观点</p><strong>{card.explanation}</strong></section>
    <section><p>推理动作</p><span>{card.reasoningMove}</span></section>
    <section><p>适用边界</p><span>{card.boundary}</span></section>
    <section><p>为什么重要</p><span>{card.whyItMatters}</span></section>
    <div className="detail-actions">
      {card.sourceUrl && <a href={card.sourceUrl} target="_blank" rel="noreferrer" onClick={() => onEvent(card.id, "opened_source")}>打开原文</a>}
      <button onClick={onLinkQuestion}>放进问题</button>
      {card.storyId && <button onClick={onOpenStory}>今日故事</button>}
      <button className="remove-source" onClick={onRemoveSource}>移除来源</button>
    </div>
  </section>;
}

function parseTags(value: string) {
  try {
    const tags = JSON.parse(value);
    return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}
