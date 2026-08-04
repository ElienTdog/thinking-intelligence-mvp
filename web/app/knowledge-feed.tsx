"use client";

import { type MouseEvent, useEffect, useRef, useState } from "react";
import type { Clip, DailyStory, KnowledgeCard } from "./lib/types";

type FeedEventType = "seen" | "completed" | "saved" | "less_like" | "opened_source";

type KnowledgeFeedProps = {
  mode: "feed" | "story";
  cards: KnowledgeCard[];
  story: DailyStory | null;
  storyCards: KnowledgeCard[];
  rawClips: Clip[];
  hasMore: boolean;
  isGenerating: boolean;
  onEvent: (cardId: string, eventType: FeedEventType) => void;
  onLoadMore: () => void;
  onOpenStory: () => void;
  onGenerateToday: () => void;
};

export function KnowledgeFeed({
  mode,
  cards,
  story,
  storyCards,
  rawClips,
  hasMore,
  isGenerating,
  onEvent,
  onLoadMore,
  onOpenStory,
  onGenerateToday,
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
    return <section className="feed-empty">
      <p className="eyebrow">{mode === "story" ? "今日故事" : "推荐"}</p>
      <h2>{mode === "story" ? "今天还没有故事" : "知识流正在等第一条可核验来源"}</h2>
      <p>{mode === "story"
        ? "当今天有 3 到 5 张可追溯的知识卡时，它们会在这里围绕一个问题展开。"
        : "主动收录的内容会优先进入编译队列。没有可读原文、字幕或文字稿的链接会停留在 Raw 层。"}</p>
      <div className="feed-empty-actions"><button className="primary" onClick={onGenerateToday} disabled={isGenerating}>{isGenerating ? "正在生成" : "生成今日内容"}</button><span>{rawClips.filter((clip) => clip.processingStatus === "queued").length} 条等待编译</span></div>
    </section>;
  }

  return <section className="knowledge-deck" aria-label={mode === "story" ? "今日故事" : "推荐知识流"}>
    {mode === "story" && story && <header className="story-intro"><p className="eyebrow">今日故事 · {story.storyDate}</p><h2>{story.title}</h2><p>{story.openingQuestion}</p></header>}
    <div className="knowledge-scroll">
      {visibleCards.map((card, index) => <KnowledgeCardView
        key={card.id}
        card={card}
        chapter={mode === "story" ? index + 1 : 0}
        onEvent={onEvent}
        onOpenStory={onOpenStory}
        onOpen={() => {
          setSelected(card);
          onEvent(card.id, "completed");
        }}
      />)}
      {mode === "feed" && (hasMore
        ? <button className="load-more" onClick={onLoadMore}>继续加载</button>
        : <p className="feed-end">刷到底了。下一批可核验知识会在这里出现。</p>)}
      {mode === "story" && story && <footer className="story-takeaway"><p className="eyebrow">带走的判断</p><p>{story.takeaway}</p></footer>}
    </div>
    {selected && <KnowledgeDetail card={selected} onClose={() => setSelected(null)} onEvent={onEvent} />}
  </section>;
}

function KnowledgeCardView({
  card,
  chapter,
  onEvent,
  onOpenStory,
  onOpen,
}: {
  card: KnowledgeCard;
  chapter: number;
  onEvent: (cardId: string, eventType: FeedEventType) => void;
  onOpenStory: () => void;
  onOpen: () => void;
}) {
  const tags = parseTags(card.tags);

  function openSource(event: MouseEvent<HTMLAnchorElement>) {
    event.stopPropagation();
    onEvent(card.id, "opened_source");
  }

  return <article className="knowledge-card" tabIndex={0} onClick={onOpen} onKeyDown={(event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); }
  }}>
    <div className="knowledge-topline"><span>{chapter ? `第 ${chapter} 节` : tags[0] || "AI 与产品"}</span><span>{card.verificationStatus === "verified" ? "已核验来源" : "主动收录"}</span></div>
    <h2>{card.hook}</h2>
    <p className="knowledge-claim">{card.title}</p>
    <div className="knowledge-source"><span>{card.sourceName}</span>{card.sourceUrl && <a href={card.sourceUrl} target="_blank" rel="noreferrer" onClick={openSource}>原文</a>}</div>
    <div className="knowledge-actions" onClick={(event) => event.stopPropagation()}>
      <button onClick={() => onEvent(card.id, "saved")}>收藏</button>
      <button onClick={() => onEvent(card.id, "less_like")}>少看这类</button>
      {card.storyId && !chapter && <button onClick={onOpenStory}>今日故事</button>}
    </div>
  </article>;
}

function KnowledgeDetail({ card, onClose, onEvent }: {
  card: KnowledgeCard;
  onClose: () => void;
  onEvent: (cardId: string, eventType: FeedEventType) => void;
}) {
  return <section className="knowledge-detail" role="dialog" aria-modal="true" aria-label={card.title}>
    <div className="knowledge-detail-head"><p className="eyebrow">知识卡</p><button onClick={onClose} aria-label="关闭详情">关闭</button></div>
    <h2>{card.hook}</h2>
    <section><p className="section-label">核心观点</p><p>{card.explanation}</p></section>
    <section><p className="section-label">推理动作</p><p>{card.reasoningMove}</p></section>
    <section><p className="section-label">适用边界</p><p>{card.boundary}</p></section>
    <section><p className="section-label">为什么重要</p><p>{card.whyItMatters}</p></section>
    <div className="knowledge-detail-source"><span>{card.sourceName}</span>{card.sourceUrl && <a href={card.sourceUrl} target="_blank" rel="noreferrer" onClick={() => onEvent(card.id, "opened_source")}>打开原文</a>}</div>
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
