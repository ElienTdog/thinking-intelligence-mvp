#!/usr/bin/env python3
"""Compile readable raw sources into the AI-maintained Wiki with DeepSeek.

Raw sources remain immutable. DeepSeek owns only the synthesis layer: questions,
topics, concepts, people pages, the generated index block, and the change log.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"
DEFAULT_MODEL = "deepseek-v4-flash"
KEYCHAIN_SERVICE = "thinking-wiki-deepseek"
STATE_PATH = Path("wiki/00 系统/deepseek-maintenance-state.json")
RAW_DIR = Path("wiki/01 原始材料")
PROTECTED_DIRS = {"AI HOT 线索", "待剪藏"}
ALLOWED_NEW_DIRS = {
    "topic": Path("wiki/03 主题与主张"),
    "concept": Path("wiki/04 概念与方法"),
    "person": Path("wiki/05 来源与人物"),
}
QUESTION_PATHS = {
    "Q1": Path("wiki/02 问题/Q1 - 如何才叫 AI 用得深.md"),
    "Q2": Path("wiki/02 问题/Q2 - 如何训练产品判断和思考能力.md"),
}
INDEX_START = "<!-- deepseek-maintained:start -->"
INDEX_END = "<!-- deepseek-maintained:end -->"


def clean_text(value: object, limit: int = 0) -> str:
    text = " ".join(str(value or "").split())
    return text[:limit] if limit else text


def parse_json_object(content: str, error_message: str) -> dict[str, Any]:
    candidate = content.strip()
    if candidate.startswith("```"):
        candidate = re.sub(r"^```(?:json)?\s*", "", candidate, count=1, flags=re.IGNORECASE)
        candidate = re.sub(r"\s*```$", "", candidate, count=1)
    start, end = candidate.find("{"), candidate.rfind("}")
    if start >= 0 and end >= start:
        candidate = candidate[start:end + 1]
    try:
        result = json.loads(candidate)
    except json.JSONDecodeError as error:
        raise RuntimeError(error_message) from error
    if not isinstance(result, dict):
        raise RuntimeError(error_message)
    return result


def safe_filename(value: str) -> str:
    compact = re.sub(r"[\\/:*?\"<>|]+", " ", value).strip()
    compact = re.sub(r"\s+", " ", compact).strip(" .")
    return compact[:90] or "未命名页面"


def source_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def load_api_key(env_name: str = "DEEPSEEK_API_KEY") -> str:
    value = os.environ.get(env_name, "").strip()
    if value:
        return value
    result = subprocess.run(
        ["security", "find-generic-password", "-a", "deepseek", "-s", KEYCHAIN_SERVICE, "-w"],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode == 0 and result.stdout.strip():
        return result.stdout.strip()
    raise RuntimeError(
        "未读取到 DeepSeek API Key。请在钥匙串中确认通用密码名称为 "
        f"{KEYCHAIN_SERVICE}、账户为 deepseek；不会把密钥写进项目。"
    )


def post_json(payload: dict[str, Any], api_key: str) -> Any:
    request = Request(
        DEEPSEEK_URL,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "User-Agent": "thinking-wiki-maintainer/1.0",
        },
    )
    try:
        with urlopen(request, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        message = error.read().decode("utf-8", errors="replace")[:400]
        raise RuntimeError(f"DeepSeek 请求失败：{error.code} {message}") from error
    except URLError as error:
        raise RuntimeError(f"无法连接 DeepSeek：{error.reason}") from error


def read_state(root: Path) -> dict[str, Any]:
    path = root / STATE_PATH
    if not path.exists():
        return {"sources": {}}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"sources": {}}
    return value if isinstance(value, dict) and isinstance(value.get("sources"), dict) else {"sources": {}}


def write_state(root: Path, state: dict[str, Any]) -> None:
    path = root / STATE_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def raw_sources(root: Path) -> list[Path]:
    sources: list[Path] = []
    raw_root = root / RAW_DIR
    for path in raw_root.rglob("*.md"):
        relative = path.relative_to(raw_root)
        if any(part in PROTECTED_DIRS for part in relative.parts):
            continue
        content = path.read_text(encoding="utf-8")
        if "类型：待剪藏任务" in content or "正文待复核" in content or "原文待核验" in content:
            continue
        has_readable_body_marker = "## 原文" in content or re.search(r"^source:\s*\"?https?://", content, re.MULTILINE)
        if not has_readable_body_marker:
            continue
        if len(content) < 900:
            continue
        sources.append(path)
    return sorted(sources, key=lambda path: path.stat().st_mtime)


def candidate_pages(root: Path) -> list[dict[str, str]]:
    paths = list(QUESTION_PATHS.values())
    for directory in ("wiki/03 主题与主张", "wiki/04 概念与方法", "wiki/05 来源与人物"):
        paths.extend(sorted((root / directory).rglob("*.md")))
    pages: list[dict[str, str]] = []
    for path in paths:
        full_path = path if path.is_absolute() else root / path
        if not full_path.exists():
            continue
        content = full_path.read_text(encoding="utf-8")
        pages.append({
            "path": full_path.relative_to(root).as_posix(),
            "content": content[:6000],
        })
    return pages


def maintenance_plan(root: Path, source_path: Path, source_content: str, api_key: str, model: str) -> dict[str, Any]:
    source_relative = source_path.relative_to(root / "wiki").with_suffix("").as_posix()
    source_link = f"[[{source_relative}]]"
    pages = candidate_pages(root)
    prompt = f"""你是这个私有 Markdown Wiki 的维护者。请把一篇已验证、可读的原始文章编译进现有 Wiki。

绝对边界：
- 原文是证据，不能修改；不能把原文以外的信息写成事实。
- 绝不写入 `06 我的判断` 或 `07 练习与案例`。
- 最多更新 3 个页面；若没有实质增量，可以返回空 updates。
- 每一份输出页面必须包含来源链接 `{source_link}`，并明确是支持、挑战、收窄或未改变什么。
- 不要把文章作者的观点伪装成用户的立场。
- 可更新的既有页面只有下列 `existingPages` 的 path；也可新建一个 topic、concept 或 person 页面。

返回严格 JSON：
{{
  "sourceSummary":"不超过220字，说明文章说了什么及其边界",
  "keyPoints":["最多4条、每条不超过100字的来源内关键点"],
  "relation":"以 support、challenge、narrow 或 unchanged 开头，并用一句话说明它和现有 Wiki 的具体关系",
  "relatedQuestionIds":["Q1 或 Q2，最多两个"],
  "understandingQuestion":"一条能帮助用户把文章带入真实任务的小问题",
  "units":[{{
    "title":"可跨来源复用的知识点标题",
    "hook":"一句人话入口",
    "explanation":"只基于原文的解释",
    "topic":"可动态创造的主主题",
    "subtopics":["最多5个子主题"],
    "format":"观点|案例|反例|方法|解释",
    "difficulty":"入门|中等|进阶",
    "novelty":0.0,
    "reasoningMove":"原文使用的思考动作",
    "boundary":"适用边界",
    "whyItMatters":"为什么值得看",
    "sourceEvidence":"原文中的短证据或忠实定位"
  }}],
  "updates":[{{
    "kind":"question|topic|concept|person",
    "targetPath":"既有页面的完整 path；新建页面留空",
    "title":"新建页面标题；更新既有页可留空",
    "summary":"不超过100字的索引说明",
    "content":"完整 Markdown 页面内容"
  }}]
}}

原始文章路径：{source_relative}
原始文章：
{source_content[:18000]}

existingPages：
{json.dumps(pages, ensure_ascii=False)}"""
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": "你只输出有效 JSON。维护可追溯的知识，不臆测，不写用户立场。"},
            {"role": "user", "content": prompt},
        ],
        "response_format": {"type": "json_object"},
        "thinking": {"type": "disabled"},
        "stream": False,
        "max_tokens": 5000,
    }
    response = post_json(payload, api_key)
    content = response.get("choices", [{}])[0].get("message", {}).get("content", "") if isinstance(response, dict) else ""
    result = parse_json_object(content, "DeepSeek 没有返回可解析的维护计划")
    try:
        validate_knowledge_units(result)
    except RuntimeError:
        repair_payload = {
            **payload,
            "messages": [
                *payload["messages"],
                {"role": "assistant", "content": content},
                {"role": "user", "content": "上一份 JSON 的 units 不合格。请保留有依据的内容，将 units 修正为 3–6 个彼此不同的知识单元，并为每个单元补齐 title、hook、explanation、topic、subtopics、format、difficulty、novelty、reasoningMove、boundary、whyItMatters、sourceEvidence。只输出完整修正后的 JSON。"},
            ],
            "max_tokens": 6000,
        }
        repaired = post_json(repair_payload, api_key)
        repaired_content = repaired.get("choices", [{}])[0].get("message", {}).get("content", "") if isinstance(repaired, dict) else ""
        result = parse_json_object(repaired_content, "DeepSeek 修复后仍未返回可解析的维护计划")
        validate_knowledge_units(result)
    return result


def validate_knowledge_units(plan: dict[str, Any]) -> list[dict[str, Any]]:
    required = {
        "title", "hook", "explanation", "topic", "format", "difficulty",
        "reasoningMove", "boundary", "whyItMatters", "sourceEvidence",
    }
    units: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for raw in plan.get("units", [])[:6]:
        if not isinstance(raw, dict) or any(not clean_text(raw.get(key)) for key in required):
            continue
        identity = (clean_text(raw.get("title"), 160).lower(), clean_text(raw.get("topic"), 80).lower())
        if identity in seen:
            continue
        seen.add(identity)
        units.append(raw)
    if len(units) < 3:
        raise RuntimeError("DeepSeek 必须返回 3–6 个不同且可追溯的知识单元")
    return units


def target_for_update(root: Path, update: dict[str, Any], existing: set[str]) -> Path | None:
    kind = clean_text(update.get("kind"), 20)
    target = clean_text(update.get("targetPath"), 240).replace("\\", "/")
    if target:
        if target not in existing:
            return None
        path = root / target
        if path.is_relative_to(root / "wiki/06 我的判断") or path.is_relative_to(root / "wiki/07 练习与案例"):
            return None
        return path
    if kind not in ALLOWED_NEW_DIRS:
        return None
    title = clean_text(update.get("title"), 120)
    if not title:
        return None
    return root / ALLOWED_NEW_DIRS[kind] / f"{datetime.now().date().isoformat()} - {safe_filename(title)}.md"


def apply_plan(root: Path, source_path: Path, plan: dict[str, Any]) -> list[tuple[Path, str]]:
    source_link = f"[[{source_path.relative_to(root / 'wiki').with_suffix('').as_posix()}]]"
    existing = {page["path"] for page in candidate_pages(root)}
    written: list[tuple[Path, str]] = []
    for raw_update in plan.get("updates", [])[:3]:
        if not isinstance(raw_update, dict):
            continue
        target = target_for_update(root, raw_update, existing)
        content = str(raw_update.get("content", "")).strip()
        summary = clean_text(raw_update.get("summary"), 120)
        if not target or not content.startswith("# ") or source_link not in content:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content + "\n", encoding="utf-8")
        written.append((target, summary or "由 DeepSeek 维护"))
    return written


def write_source_digest(root: Path, source_path: Path, plan: dict[str, Any]) -> tuple[Path, str]:
    source_link = f"[[{source_path.relative_to(root / 'wiki').with_suffix('').as_posix()}]]"
    title = source_path.stem
    summary = clean_text(plan.get("sourceSummary"), 500) or "DeepSeek 未能给出摘要；请回到原文核对。"
    key_points = [clean_text(point, 180) for point in plan.get("keyPoints", []) if clean_text(point, 180)][:4]
    relation = clean_text(plan.get("relation"), 240) or "unchanged；暂未发现足以改写现有综合判断的证据。"
    question_ids = [clean_text(item, 10).upper() for item in plan.get("relatedQuestionIds", [])]
    question_ids = [item for item in question_ids if item in QUESTION_PATHS]
    questions = ", ".join(f"[[02 问题/{QUESTION_PATHS[item].stem}]]" for item in question_ids) or "待归类"
    question = clean_text(plan.get("understandingQuestion"), 280) or "这篇文章会改变我下一次任务中的哪一个具体取舍？"
    points = "\n".join(f"- {point}" for point in key_points) or "- 待在原文阅读中补充。"
    units = []
    try:
        if "units" in plan:
            units = validate_knowledge_units(plan)
    except RuntimeError:
        pass
    unit_sections = []
    for index, unit in enumerate(units, 1):
        subtopics = "、".join(clean_text(item, 60) for item in unit.get("subtopics", [])[:5] if clean_text(item, 60)) or "无"
        unit_sections.append(
            f"### {index}. {clean_text(unit.get('title'), 160)}\n\n"
            f"- 主题：{clean_text(unit.get('topic'), 80)}\n"
            f"- 子主题：{subtopics}\n"
            f"- 形式：{clean_text(unit.get('format'), 40)}；难度：{clean_text(unit.get('difficulty'), 20)}\n"
            f"- 人话入口：{clean_text(unit.get('hook'), 240)}\n"
            f"- 原文证据：{clean_text(unit.get('sourceEvidence'), 500)}\n"
            f"- 边界：{clean_text(unit.get('boundary'), 500)}"
        )
    unit_block = "\n\n".join(unit_sections) or "本次旧格式维护记录未包含独立知识单元。"
    unit_payload = json.dumps(units, ensure_ascii=False, separators=(",", ":"))
    target = root / "wiki/03 主题与主张/来源解读" / f"{datetime.now().date().isoformat()} - 来源解读：{safe_filename(title)}.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    markdown = f"""# 来源解读：{title}

类型：AI 维护的来源解读

状态：已由 DeepSeek 从可读原文提炼；不等于我的判断

原始来源：{source_link}

关联问题：{questions}

## 这篇文章说了什么

{summary}

## 关键点

{points}

## 可独立阅读的知识单元

{unit_block}

<!-- deepseek-knowledge-units
{unit_payload}
-->

## 与现有 Wiki 的关系

{relation}

## 带入真实任务的问题

{question}
"""
    target.write_text(markdown, encoding="utf-8")
    return target, summary[:120]


def update_index(root: Path, pages: list[tuple[Path, str]]) -> None:
    if not pages:
        return
    index = root / "wiki/index.md"
    content = index.read_text(encoding="utf-8")
    lines = [INDEX_START, "## 最近由 DeepSeek 维护"]
    for path, summary in pages:
        link = path.relative_to(root / "wiki").with_suffix("").as_posix()
        lines.append(f"- [[{link}]]：{summary}")
    lines.append(INDEX_END)
    block = "\n".join(lines)
    pattern = re.compile(rf"{re.escape(INDEX_START)}.*?{re.escape(INDEX_END)}", re.DOTALL)
    content = pattern.sub(block, content) if pattern.search(content) else content.rstrip() + "\n\n" + block + "\n"
    index.write_text(content, encoding="utf-8")


def index_pages_from_state(root: Path, state: dict[str, Any]) -> list[tuple[Path, str]]:
    records = sorted(state["sources"].values(), key=lambda record: str(record.get("maintained_at", "")), reverse=True)
    pages: list[tuple[Path, str]] = []
    seen: set[Path] = set()
    for record in records:
        for relative in record.get("pages", []):
            path = root / str(relative)
            if path in seen or not path.exists():
                continue
            seen.add(path)
            content = path.read_text(encoding="utf-8")
            match = re.search(r"## (?:这篇文章说了什么|一句话主张)\s*\n+([^\n]+)", content)
            pages.append((path, clean_text(match.group(1) if match else "由 DeepSeek 维护", 120)))
            if len(pages) >= 12:
                return pages
    return pages


def append_log(root: Path, source_path: Path, pages: list[tuple[Path, str]], question: str) -> None:
    source_link = f"[[{source_path.relative_to(root / 'wiki').with_suffix('').as_posix()}]]"
    changes = ", ".join(f"[[{path.relative_to(root / 'wiki').with_suffix('').as_posix()}]]" for path, _ in pages) or "未发现需要长期更新的页面"
    with (root / "wiki/log.md").open("a", encoding="utf-8") as stream:
        stream.write(
            f"\n\n## [{datetime.now().date().isoformat()}] deepseek_ingest | {source_path.stem}\n\n"
            f"- 处理来源：{source_link}\n- 更新：{changes}\n- 带入问题：{question or '待用户在真实任务中检验'}\n"
        )


def source_creator(content: str) -> str:
    match = re.search(r"^author:\s*\n\s*-\s*[\"']?\[\[(.+?)\]\][\"']?\s*$", content, re.MULTILINE)
    if match:
        return match.group(1).strip()
    match = re.search(r"^(?:-\s*)?作者/机构：\s*(.+?)\s*$", content, re.MULTILINE)
    return match.group(1).strip() if match else ""


def pending_sources(root: Path, state: dict[str, Any], force: bool = False, creators: set[str] | None = None) -> list[Path]:
    known = state["sources"]
    return [
        path for path in raw_sources(root)
        if (not creators or source_creator(path.read_text(encoding="utf-8")) in creators)
        and (force or known.get(path.relative_to(root).as_posix(), {}).get("hash") != source_hash(path.read_text(encoding="utf-8")))
    ]


def maintain(root: Path, api_key: str, model: str, limit: int = 3, force: bool = False, creators: set[str] | None = None) -> tuple[int, int]:
    state = read_state(root)
    known = state["sources"]
    pending = pending_sources(root, state, force, creators)
    if limit > 0:
        pending = pending[:limit]
    processed = 0
    for path in pending:
        source = path.read_text(encoding="utf-8")
        plan = maintenance_plan(root, path, source, api_key, model)
        digest = write_source_digest(root, path, plan)
        pages = [digest, *apply_plan(root, path, plan)]
        question = clean_text(plan.get("understandingQuestion"), 260)
        append_log(root, path, pages, question)
        known[path.relative_to(root).as_posix()] = {
            "hash": source_hash(source),
            "maintained_at": datetime.now().isoformat(timespec="seconds"),
            "model": model,
            "pages": [page.relative_to(root).as_posix() for page, _ in pages],
        }
        write_state(root, state)
        processed += 1
    if processed:
        update_index(root, index_pages_from_state(root, state))
    return processed, len(pending)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Use DeepSeek to maintain the Wiki from readable raw sources.")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--limit", type=int, default=3, help="每次最多维护几篇；0 表示全部")
    parser.add_argument("--force", action="store_true", help="重新维护已处理过的原文")
    parser.add_argument("--creator", action="append", default=[], help="只维护指定作者；可重复使用")
    parser.add_argument("--reindex", action="store_true", help="根据已有维护状态重建索引中的 DeepSeek 区块")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    root = args.root.resolve()
    if args.reindex:
        update_index(root, index_pages_from_state(root, read_state(root)))
        print("DeepSeek Wiki index refreshed")
        return 0
    creators = {creator.strip() for creator in args.creator if creator.strip()}
    pending = pending_sources(root, read_state(root), args.force, creators)
    if args.dry_run:
        for path in pending[:args.limit or None]:
            print(f"would maintain: {path.relative_to(root)}")
        return 0
    try:
        api_key = load_api_key()
        processed, _ = maintain(root, api_key, args.model, args.limit, args.force, creators)
    except RuntimeError as error:
        print(f"DeepSeek Wiki maintenance failed: {error}", file=sys.stderr)
        return 1
    print(f"DeepSeek Wiki maintenance: processed={processed}, pending_before_limit={len(pending)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
