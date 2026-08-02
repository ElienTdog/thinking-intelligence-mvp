"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { BootstrapPayload, JudgmentDelta, Material, Question } from "./lib/types";

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

export function JudgmentWorkbench({ displayName }: { displayName: string }) {
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState("pending");
  const [showQuestionForm, setShowQuestionForm] = useState(false);
  const [showMaterialForm, setShowMaterialForm] = useState(false);
  const [respondingTo, setRespondingTo] = useState<Material | null>(null);
  const [notice, setNotice] = useState("");

  const load = async () => {
    try {
      const next = await requestJson("/api/bootstrap") as BootstrapPayload;
      setData(next);
      setSelectedQuestionId((current) => current && next.questions.some((item) => item.id === current)
        ? current : next.questions[0]?.id ?? null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "暂时无法读取工作区");
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const selectedQuestion = useMemo(() => data?.questions.find((item) => item.id === selectedQuestionId) ?? null,
    [data, selectedQuestionId]);
  const materials = useMemo(() => data?.materials.filter((item) => item.questionId === selectedQuestionId) ?? [], [data, selectedQuestionId]);
  const deltas = useMemo(() => data?.deltas.filter((item) => item.questionId === selectedQuestionId) ?? [], [data, selectedQuestionId]);
  const latestByMaterial = useMemo(() => {
    const value = new Map<string, JudgmentDelta>();
    deltas.forEach((delta) => { if (!value.has(delta.materialId)) value.set(delta.materialId, delta); });
    return value;
  }, [deltas]);
  const needsValidation = deltas.filter((item) => item.status === "needs_validation");
  const unanswered = materials.filter((item) => !latestByMaterial.has(item.id));
  const queue = activeView === "pending" ? [...needsValidation.map((delta) => ({ kind: "delta" as const, delta })), ...unanswered.map((material) => ({ kind: "material" as const, material }))] : [];

  async function createQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await requestJson("/api/questions", { title: form.get("title"), initialJudgment: form.get("initialJudgment"), priority: form.get("priority") });
      event.currentTarget.reset(); setShowQuestionForm(false); setNotice("问题已保存。下一步是放进一条会挑战它的材料。"); await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "保存失败"); }
  }

  async function createMaterial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await requestJson("/api/materials", { questionId: selectedQuestionId, type: form.get("type"), title: form.get("title"), challenge: form.get("challenge"), relevance: form.get("relevance") });
      event.currentTarget.reset(); setShowMaterialForm(false); setNotice("材料已保存。现在写一句回应，留下判断的变化。 "); await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "保存失败"); }
  }

  async function createDelta(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!respondingTo) return;
    try {
      await requestJson("/api/judgment-deltas", { questionId: selectedQuestionId, materialId: respondingTo.id, responseType: form.get("responseType"), responseText: form.get("responseText"), validationScenario: form.get("validationScenario") });
      event.currentTarget.reset(); setRespondingTo(null); setNotice("判断差分已保存；它不会自动改写你的临时立场。 "); await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "保存失败"); }
  }

  if (!data) return <main className="loading">正在打开你的判断工作台…</main>;

  return <main className="workbench-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">↗</span><span>思考情报台</span></div>
      <p className="account">{displayName}</p>
      <nav aria-label="工作台导航">
        <button className={activeView === "pending" ? "nav-active" : ""} onClick={() => setActiveView("pending")}>待我判断 <em>{needsValidation.length + unanswered.length}</em></button>
        <button className={activeView === "questions" ? "nav-active" : ""} onClick={() => setActiveView("questions")}>问题</button>
        <button className={activeView === "materials" ? "nav-active" : ""} onClick={() => setActiveView("materials")}>材料</button>
        <button className={activeView === "deltas" ? "nav-active" : ""} onClick={() => setActiveView("deltas")}>判断差分</button>
      </nav>
      <button className="secondary full" onClick={() => setShowQuestionForm((visible) => !visible)}>+ 新问题</button>
      {showQuestionForm && <form className="compact-form sidebar-form" onSubmit={createQuestion}>
        <label>问题<input name="title" required maxLength={280} placeholder="我正在判断什么？" /></label>
        <label>我的初始判断<textarea name="initialJudgment" required maxLength={2000} placeholder="先保留粗糙但真实的起点。" /></label>
        <label>优先级<select name="priority" defaultValue="1"><option value="1">P1 · 现在最重要</option><option value="2">P2 · 值得跟进</option><option value="3">P3 · 暂存</option></select></label>
        <button className="primary">保存问题</button>
      </form>}
      <p className="privacy-note">线上只保存你的主动记录；本地 Markdown 不会被同步。</p>
    </aside>

    <section className="content-panel">
      <header className="panel-head">
        <div><p className="eyebrow">{activeView === "pending" ? "最小判断闭环" : "你的工作区"}</p><h1>{selectedQuestion?.title ?? "从一个真实问题开始"}</h1></div>
        {selectedQuestion && <button className="secondary" onClick={() => setShowMaterialForm((visible) => !visible)}>+ 添加材料</button>}
      </header>
      {notice && <p className="notice" role="status">{notice}</p>}
      {!selectedQuestion && <div className="empty"><h2>先写下一个问题</h2><p>它不需要完整。写下你正在做判断的那个真实情境，再让材料来挑战它。</p><button className="primary" onClick={() => setShowQuestionForm(true)}>创建第一个问题</button></div>}
      {showMaterialForm && selectedQuestion && <form className="material-form" onSubmit={createMaterial}>
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
      {selectedQuestion && activeView === "materials" && <div className="stream">{materials.length ? materials.map((material) => <MaterialCard key={material.id} material={material} onRespond={() => setRespondingTo(material)} />) : <div className="empty compact"><p>还没有材料。</p></div>}</div>}
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
      <p className="eyebrow">当前问题</p><h2>{selectedQuestion?.title ?? "—"}</h2>
      <section><p className="section-label">初始判断</p><p>{selectedQuestion?.initialJudgment ?? "先写下你的起点。"}</p></section>
      <section><p className="section-label">当前临时立场</p><p className="muted">尚未确认。这里不会由材料或 AI 自动写入。</p></section>
      <section><p className="section-label">判断差分</p><div className="stat-row"><strong>{unanswered.length}</strong><span>待回应</span></div><div className="stat-row"><strong>{needsValidation.length}</strong><span>待真实场景验证</span></div></section>
      {deltas[0] && <section><p className="section-label">最新记录</p><p className="delta-copy">{deltas[0].responseText}</p></section>}
    </aside>
  </main>;
}

function MaterialCard({ material, onRespond }: { material: Material; onRespond: () => void }) {
  return <article className="card material-card"><div className="card-meta">{material.type === "source" ? "外部来源" : "思考卡"}</div><h2>{material.title}</h2><p><b>挑战：</b>{material.challenge}</p><p><b>关联：</b>{material.relevance}</p><button className="primary" onClick={onRespond}>回应这条材料</button></article>;
}

function DeltaCard({ delta, material }: { delta: JudgmentDelta; material?: Material }) {
  return <article className="card delta-card"><div className="card-meta"><span>{delta.status === "needs_validation" ? "待真实场景验证" : "回应已记录"}</span>{material ? ` · ${material.title}` : ""}</div><h2>{responseLabels[delta.responseType]}</h2><p>{delta.responseText}</p>{delta.validationScenario && <p><b>验证场景：</b>{delta.validationScenario}</p>}</article>;
}

function QuestionList({ questions, selectedId, onSelect }: { questions: Question[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return <div className="question-list">{questions.map((question) => <button key={question.id} className={question.id === selectedId ? "question-row selected" : "question-row"} onClick={() => onSelect(question.id)}><span>P{question.priority}</span><strong>{question.title}</strong><small>{question.initialJudgment}</small></button>)}</div>;
}
