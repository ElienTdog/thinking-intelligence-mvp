#!/usr/bin/env python3
"""Sync the online source inbox into the local Obsidian Wiki.

The local Markdown vault is the write authority. The online product only queues
links and receives a mirror after a local file was written or a clipping task
was created. Readable material is then handed to the DeepSeek Wiki maintainer.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import json
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as element_tree
from dataclasses import dataclass
from datetime import date
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


KEYCHAIN_SERVICE = "thinking-wiki-sync"
SITE_BYPASS_KEYCHAIN_SERVICE = "thinking-wiki-sites-bypass"
BRIDGE_KEYCHAIN_SERVICE = "thinking-wechat-capture-bridge"
DEFAULT_BRIDGE_URL = "http://127.0.0.1:8765"
USER_AGENT = "thinking-wiki-local-sync/0.1"
RESTRICTED_HOSTS = {"mp.weixin.qq.com", "xiaohongshu.com", "www.xiaohongshu.com"}
DEFAULT_CREATORS = ["数字生命卡兹克", "赛博禅心", "量子位", "Datawhale", "MacTalk"]
MAX_COVER_BYTES = 500_000


@dataclass
class InboxItem:
    item_id: str
    content: str
    source_url: str
    source_title: str
    publisher: str = ""
    published_at: str = ""
    processing_status: str = ""


class ArticleParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title = ""
        self._in_title = False
        self._skip_depth = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "noscript", "svg"}:
            self._skip_depth += 1
        if tag == "title":
            self._in_title = True
        if tag in {"p", "div", "h1", "h2", "h3", "li", "blockquote", "br"} and not self._skip_depth:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript", "svg"} and self._skip_depth:
            self._skip_depth -= 1
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
        if not self._skip_depth:
            self.parts.append(data)


def request_json(
    url: str,
    token: str | None = None,
    payload: dict[str, Any] | None = None,
    site_bypass_token: str | None = None,
) -> Any:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if site_bypass_token:
        headers["OAI-Sites-Authorization"] = f"Bearer {site_bypass_token}"
    if data:
        headers["Content-Type"] = "application/json"
    request = Request(url, data=data, headers=headers, method="POST" if data else "GET")
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def load_token(value: str, service: str = KEYCHAIN_SERVICE) -> str:
    if value:
        return value.strip()
    completed = subprocess.run(
        ["security", "find-generic-password", "-a", "wiki-sync", "-s", service, "-w"],
        capture_output=True,
        text=True,
        check=False,
    )
    return completed.stdout.strip() if completed.returncode == 0 else ""


def store_token(token: str, service: str = KEYCHAIN_SERVICE) -> None:
    subprocess.run(
        ["security", "add-generic-password", "-U", "-a", "wiki-sync", "-s", service, "-w", token],
        check=True,
    )


def safe_filename(value: str, fallback: str) -> str:
    compact = re.sub(r"[\\/:*?\"<>|]+", " ", value).strip()
    compact = re.sub(r"\s+", " ", compact).strip(" .")
    return compact[:100] or fallback


def clean_text(value: str) -> str:
    return re.sub(r"[ \t]+", " ", re.sub(r"\n{3,}", "\n\n", unescape(value))).strip()


def markdown_relative(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def creator_folder(root: Path, creator: str) -> Path:
    return root / "wiki" / "01 原始材料" / "公众号" / safe_filename(creator, "未命名作者")


def generic_folder(root: Path, url: str) -> Path:
    host = urlparse(url).hostname or "手动收录"
    return root / "wiki" / "01 原始材料" / "网页剪藏" / safe_filename(host.removeprefix("www."), "手动收录")


def task_folder(root: Path) -> Path:
    return root / "wiki" / "01 原始材料" / "待剪藏"


def is_restricted(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return host in RESTRICTED_HOSTS or host.endswith(".xiaohongshu.com")


def existing_source(root: Path, url: str, include_pending: bool = True) -> Path | None:
    if not url:
        return None
    marker = f"来源：{url}"
    for path in (root / "wiki" / "01 原始材料").rglob("*.md"):
        if not include_pending and "待剪藏" in path.parts:
            continue
        if marker in path.read_text(encoding="utf-8"):
            return path
    return None


def fetch_article(url: str) -> tuple[str, str]:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml,text/plain"})
    with urlopen(request, timeout=30) as response:
        content_type = response.headers.get_content_type()
        raw = response.read(1_500_000).decode(response.headers.get_content_charset() or "utf-8", errors="replace")
    if content_type.startswith("text/plain"):
        return "", clean_text(raw)
    parser = ArticleParser()
    parser.feed(raw)
    return clean_text(parser.title), clean_text("".join(parser.parts))


def file_version(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]


def source_filename(item: InboxItem, title: str, fallback: str) -> str:
    name = safe_filename(title, fallback)
    if not item.source_url:
        return f"{date.today().isoformat()} - {name}.md"
    suffix = hashlib.sha256(item.source_url.encode("utf-8")).hexdigest()[:10]
    return f"{date.today().isoformat()} - {name} - {suffix}.md"


def write_source(
    root: Path,
    item: InboxItem,
    title: str,
    body: str,
    creator: str = "",
    evidence: str = "自动抓取",
    local_images: list[str] | None = None,
) -> tuple[Path, str]:
    target = creator_folder(root, creator) if creator else generic_folder(root, item.source_url)
    target.mkdir(parents=True, exist_ok=True)
    captured = date.today().isoformat()
    filename = source_filename(item, title or item.source_title, "未命名来源")
    path = target / filename
    markdown = f"""# {title or item.source_title or '未命名来源'}

类型：原始材料

状态：已自动抓取正文；待我阅读

关联问题：待归类

作者/机构：{creator or item.publisher or '待补充'}

平台：{urlparse(item.source_url).hostname or '主动收录'}

发布时间：{item.published_at or '待补充'}

来源：{item.source_url or '无'}

剪藏时间：{captured}

同步任务：{item.item_id or '本地发现'}

采集证据：{evidence}

## 原文

{body}

{chr(10).join(local_images or [])}

## 核验与边界

- 这是自动抓取的原始材料；未经过我的复述或真实任务验证前，不更新“我的判断”。
"""
    path.write_text(markdown, encoding="utf-8")
    return path, markdown


def write_clipping_task(root: Path, item: InboxItem, reason: str, creator: str = "") -> tuple[Path, str]:
    target = task_folder(root)
    target.mkdir(parents=True, exist_ok=True)
    filename = source_filename(item, item.source_title, "待剪藏来源")
    path = target / filename
    markdown = f"""# 待剪藏：{item.source_title or item.source_url}

类型：待剪藏任务

状态：需要在浏览器打开

作者/机构：{creator or item.publisher or '待补充'}

来源：{item.source_url}

创建时间：{date.today().isoformat()}

同步任务：{item.item_id or '本地发现'}

## 为什么需要你完成这一步

{reason}

请在已经安装采集桥扩展的浏览器中打开原文并完成微信要求的正常验证，然后在收件箱点击“重试采集”。也可以用 Obsidian Web Clipper 手动保存作为补救。
"""
    path.write_text(markdown, encoding="utf-8")
    return path, markdown


def load_bridge_token(value: str) -> str:
    if value.strip():
        return value.strip()
    completed = subprocess.run(
        ["security", "find-generic-password", "-a", "wechat-capture", "-s", BRIDGE_KEYCHAIN_SERVICE, "-w"],
        capture_output=True,
        text=True,
        check=False,
    )
    return completed.stdout.strip() if completed.returncode == 0 else ""


def capture_from_bridge(item: InboxItem, bridge_url: str, bridge_token: str, timeout_seconds: float) -> dict[str, Any]:
    queued = request_json(
        f"{bridge_url.rstrip('/')}/v1/captures",
        bridge_token,
        {
            "itemId": item.item_id,
            "sourceUrl": item.source_url,
            "sourceTitle": item.source_title,
            "retry": item.processing_status == "queued",
        },
    )
    job = queued.get("job", {}) if isinstance(queued, dict) else {}
    job_id = str(job.get("jobId", ""))
    if not job_id:
        raise ValueError("本地采集桥没有返回任务编号")
    deadline = time.monotonic() + max(0, timeout_seconds)
    while True:
        payload = request_json(f"{bridge_url.rstrip('/')}/v1/captures/{job_id}", bridge_token)
        job = payload.get("job", {}) if isinstance(payload, dict) else {}
        if job.get("status") in {"captured", "needs_user_open", "failed"}:
            return job
        if time.monotonic() >= deadline:
            return job
        time.sleep(0.25)


def valid_image_bytes(mime_type: str, data: bytes) -> tuple[str, bool]:
    signatures = {
        "image/png": ("png", b"\x89PNG\r\n\x1a\n"),
        "image/jpeg": ("jpg", b"\xff\xd8\xff"),
        "image/gif": ("gif", b"GIF8"),
        "image/webp": ("webp", b"RIFF"),
    }
    extension, signature = signatures.get(mime_type.lower(), ("", b""))
    if not extension or len(data) > 5_000_000 or not data.startswith(signature):
        return "", False
    if mime_type.lower() == "image/webp" and data[8:12] != b"WEBP":
        return "", False
    return extension, True


def save_captured_images(root: Path, item: InboxItem, images: Any) -> list[str]:
    if not isinstance(images, list):
        return []
    target = root / "wiki" / "01 原始材料" / "_assets" / "wechat"
    links: list[str] = []
    source_hash = hashlib.sha256(item.source_url.encode("utf-8")).hexdigest()[:16]
    for index, image in enumerate(images[:8], start=1):
        if not isinstance(image, dict):
            continue
        try:
            data = base64.b64decode(str(image.get("dataBase64", "")), validate=True)
        except (ValueError, binascii.Error):
            continue
        extension, valid = valid_image_bytes(str(image.get("mimeType", "")), data)
        if not valid:
            continue
        target.mkdir(parents=True, exist_ok=True)
        path = target / f"{source_hash}-{index:02d}.{extension}"
        if not path.exists():
            path.write_bytes(data)
        links.append(f"![[{markdown_relative(root, path)}]]")
    return links


def process_item(
    root: Path,
    item: InboxItem,
    creator: str = "",
    bridge_url: str = "",
    bridge_token: str = "",
    bridge_timeout: float = 0,
) -> dict[str, str]:
    existing = existing_source(root, item.source_url, include_pending=False)
    if existing:
        content = existing.read_text(encoding="utf-8")
        record = mirror_record(
            root,
            item,
            existing,
            content,
            "captured",
            "verified",
            "",
        )
        record["alreadyPresent"] = "yes"
        return record
    if not item.source_url:
        path, content = write_source(root, item, item.source_title, item.content)
        return mirror_record(root, item, path, content, "captured", "verified", "")
    if is_restricted(item.source_url):
        pending = existing_source(root, item.source_url)
        if not bridge_url or not bridge_token:
            if pending:
                content = pending.read_text(encoding="utf-8")
                record = mirror_record(root, item, pending, content, "needs_user_open", "official_link", "本地采集桥尚未连接")
                record["alreadyPresent"] = "yes"
                return record
            path, content = write_clipping_task(root, item, "本地采集桥尚未连接；系统没有尝试绕过微信访问限制。", creator)
            return mirror_record(root, item, path, content, "needs_user_open", "official_link", "本地采集桥尚未连接")
        try:
            job = capture_from_bridge(item, bridge_url, bridge_token, bridge_timeout)
        except (HTTPError, URLError, TimeoutError, ValueError) as error:
            return mirror_record(root, item, None, "", "failed", "official_link", f"本地采集桥失败：{error}")
        if job.get("status") == "captured":
            result = job.get("result", {}) if isinstance(job.get("result"), dict) else {}
            body = clean_text(str(result.get("markdown", "")))
            if len(body) < 400:
                return mirror_record(root, item, None, "", "needs_user_open", "official_link", "正文不足，需要在浏览器打开后重试")
            author = clean_text(str(result.get("author", ""))) or creator or item.publisher
            captured_item = InboxItem(
                item.item_id,
                item.content,
                item.source_url,
                clean_text(str(result.get("title", ""))) or item.source_title,
                author,
                clean_text(str(result.get("publishedAt", ""))) or item.published_at,
                item.processing_status,
            )
            local_images = save_captured_images(root, captured_item, result.get("images"))
            path, content = write_source(
                root,
                captured_item,
                captured_item.source_title,
                body,
                author,
                clean_text(str(result.get("evidence", ""))) or "由已授权浏览器扩展提取可见正文",
                local_images,
            )
            return mirror_record(root, captured_item, path, content, "captured", "verified", "")
        if job.get("status") == "needs_user_open":
            if pending:
                content = pending.read_text(encoding="utf-8")
                return mirror_record(root, item, pending, content, "needs_user_open", "official_link", str(job.get("error", "需要在浏览器打开")))
            path, content = write_clipping_task(root, item, str(job.get("error", "页面需要在浏览器中打开后重试")), creator)
            return mirror_record(root, item, path, content, "needs_user_open", "official_link", str(job.get("error", "需要在浏览器打开")))
        if job.get("status") == "failed":
            return mirror_record(root, item, None, "", "failed", "official_link", str(job.get("error", "浏览器采集失败")))
        return mirror_record(root, item, None, "", "loading", "official_link", "浏览器正在加载文章")
    try:
        title, body = fetch_article(item.source_url)
    except (HTTPError, URLError, TimeoutError, ValueError) as error:
        path, content = write_clipping_task(root, item, f"自动抓取失败：{error}。请在浏览器中检查页面后剪藏。", creator)
        return mirror_record(root, item, path, content, "needs_user_open", "unknown", "自动抓取失败，需要在浏览器打开")
    if len(body) < 400:
        path, content = write_clipping_task(root, item, "自动抓到的文本不足以作为正文，可能是动态页面、登录墙或访问限制。", creator)
        return mirror_record(root, item, path, content, "needs_user_open", "unknown", "未获得足够正文，需要在浏览器打开")
    path, content = write_source(root, item, title or item.source_title, body, creator)
    return mirror_record(root, item, path, content, "captured", "verified", "")


def mirror_record(root: Path, item: InboxItem, path: Path | None, content: str, processing_status: str, verification_status: str, error: str) -> dict[str, str]:
    return {
        "id": item.item_id,
        "sourceUrl": item.source_url,
        "sourceTitle": item.source_title,
        "content": content,
        "rawExcerpt": clean_text(content)[:7000],
        "publisher": item.publisher,
        "publishedAt": item.published_at,
        "verificationStatus": verification_status,
        "processingStatus": processing_status,
        "processingError": error,
        "localPath": markdown_relative(root, path) if path else "",
        "mirrorVersion": file_version(content),
    }


def append_log(root: Path, records: list[dict[str, str]]) -> None:
    records = [record for record in records if record.get("alreadyPresent") != "yes"]
    if not records:
        return
    grouped: dict[str, list[str]] = {}
    for record in records:
        if not record.get("localPath"):
            continue
        grouped.setdefault(record["processingStatus"], []).append(record["localPath"])
    lines = [f"\n\n## [{date.today().isoformat()}] local_wiki_sync | 来源收件箱"]
    for status, paths in grouped.items():
        labels = "正文已获取" if status == "captured" else "需要在浏览器打开"
        links = ", ".join(f"[[{Path(path).with_suffix('').as_posix()}]]" for path in paths)
        lines.append(f"\n- {labels} {len(paths)} 条：{links}")
    lines.append("\n- 本次只处理原始材料；未更新主题、概念或我的判断。")
    with (root / "wiki" / "log.md").open("a", encoding="utf-8") as stream:
        stream.write("".join(lines))


def markdown_title(content: str) -> str:
    heading = next((line.removeprefix("# ").strip() for line in content.splitlines() if line.startswith("# ")), "")
    frontmatter = re.search(r"^title:\s*[\"']?(.+?)[\"']?\s*$", content, re.MULTILINE)
    return (frontmatter.group(1).strip() if frontmatter else heading).strip()


def markdown_value(content: str, label: str) -> str:
    match = re.search(rf"^{re.escape(label)}：\s*(.+)$", content, re.MULTILINE)
    return match.group(1).strip() if match else ""


def frontmatter_value(content: str, key: str) -> str:
    match = re.search(rf"^{re.escape(key)}:\s*[\"']?(.+?)[\"']?\s*$", content, re.MULTILINE)
    return match.group(1).strip() if match else ""


def markdown_section(content: str, heading: str) -> str:
    match = re.search(rf"^## {re.escape(heading)}\s*\n+(.*?)(?=^## |\Z)", content, re.MULTILINE | re.DOTALL)
    return clean_text(match.group(1)) if match else ""


def markdown_list(content: str, heading: str) -> list[str]:
    match = re.search(rf"^## {re.escape(heading)}\s*\n+(.*?)(?=^## |\Z)", content, re.MULTILINE | re.DOTALL)
    section = match.group(1) if match else ""
    return [clean_text(line.removeprefix("- ")) for line in section.splitlines() if line.startswith("- ")][:4]


def local_cover_data_url(root: Path, content: str) -> str:
    match = re.search(r"!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]", content)
    if not match:
        return ""
    assets_root = (root / "wiki" / "01 原始材料" / "_assets").resolve()
    image_path = (root / match.group(1).strip()).resolve()
    try:
        image_path.relative_to(assets_root)
    except ValueError:
        return ""
    if not image_path.is_file() or image_path.stat().st_size > MAX_COVER_BYTES:
        return ""
    mime_types = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
    }
    mime_type = mime_types.get(image_path.suffix.lower(), "")
    data = image_path.read_bytes()
    _, valid = valid_image_bytes(mime_type, data)
    if not valid:
        return ""
    encoded = base64.b64encode(data).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def first_markdown_image(content: str, root: Path | None = None) -> str:
    if root:
        local_cover = local_cover_data_url(root, content)
        if local_cover:
            return local_cover
    match = re.search(r"!\[[^\]]*\]\((https?://[^)\s]+)\)", content)
    if not match:
        return ""
    image_url = match.group(1).strip()
    host = urlparse(image_url).hostname or ""
    # WeChat article images are hotlinks, not locally captured assets. They often
    # degrade into placeholders outside WeChat, so the online reader stays text-first.
    return "" if host.lower().endswith("mmbiz.qpic.cn") else image_url


def source_author(content: str) -> str:
    author = markdown_value(content, "作者/机构")
    if author and author != "待补充":
        return author
    match = re.search(r"^author:\s*\n\s*-\s*[\"']?\[\[(.+?)\]\][\"']?\s*$", content, re.MULTILINE)
    return match.group(1).strip() if match else ""


def maintained_knowledge_items(root: Path) -> list[dict[str, Any]]:
    state_path = root / "wiki" / "00 系统" / "deepseek-maintenance-state.json"
    if not state_path.exists():
        return []
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    items: list[dict[str, Any]] = []
    for source_relative, record in state.get("sources", {}).items():
        source_path = root / str(source_relative)
        if not source_path.exists() or not isinstance(record, dict):
            continue
        source_content = source_path.read_text(encoding="utf-8")
        digest_path = next((root / str(path) for path in record.get("pages", []) if "来源解读" in str(path)), None)
        if not digest_path or not digest_path.exists():
            continue
        digest_content = digest_path.read_text(encoding="utf-8")
        method_pages = [root / str(path) for path in record.get("pages", []) if "来源解读" not in str(path)]
        source_url = frontmatter_value(source_content, "source") or markdown_value(source_content, "来源")
        items.append({
            "sourceLocalPath": str(source_relative),
            "sourceContent": source_content,
            "sourceTitle": markdown_title(source_content) or source_path.stem,
            "sourceUrl": source_url,
            "sourceName": source_author(source_content) or "本地 Wiki",
            "publishedAt": frontmatter_value(source_content, "published") or markdown_value(source_content, "发布时间"),
            "sourceCoverUrl": first_markdown_image(source_content, root),
            "digest": {
                "localPath": markdown_relative(root, digest_path),
                "title": markdown_title(digest_content) or digest_path.stem,
                "summary": markdown_section(digest_content, "这篇文章说了什么"),
                "keyPoints": markdown_list(digest_content, "关键点"),
                "relation": markdown_section(digest_content, "与现有 Wiki 的关系"),
                "relatedQuestions": re.findall(r"\[\[02 问题/(Q[12])", markdown_value(digest_content, "关联问题")),
                "transferPrompt": markdown_section(digest_content, "带入真实任务的问题"),
            },
            "methods": [
                {
                    "localPath": markdown_relative(root, path),
                    "title": markdown_title(path.read_text(encoding="utf-8")) or path.stem,
                    "summary": markdown_section(path.read_text(encoding="utf-8"), "一句话主张") or markdown_section(path.read_text(encoding="utf-8"), "核心概念"),
                    "transferPrompt": markdown_section(path.read_text(encoding="utf-8"), "下一次验证"),
                }
                for path in method_pages if path.exists()
            ],
        })
    return items[:12]


def sync_maintained_knowledge(root: Path, server: str, token: str, site_bypass_token: str) -> set[str]:
    items = maintained_knowledge_items(root)
    if not items:
        return set()
    response = request_json(f"{server.rstrip('/')}/api/local-sync/knowledge", token, {"items": items}, site_bypass_token)
    mirrored = response.get("mirrored", []) if isinstance(response, dict) else []
    return {
        str(item.get("sourceLocalPath", ""))
        for item in mirrored
        if isinstance(item, dict) and item.get("sourceLocalPath")
    }


def finalize_records(
    root: Path,
    records: list[dict[str, str]],
    mirror: Any,
    maintain_wiki: Any,
    mirror_knowledge: Any,
) -> list[dict[str, str]]:
    mirror(records)
    captured = [record for record in records if record.get("processingStatus") == "captured" and record.get("localPath")]
    if not captured:
        return records
    for record in captured:
        record["processingStatus"] = "maintaining"
        record["processingError"] = "DeepSeek 正在维护来源解读"
    mirror(captured)
    try:
        maintain_wiki()
    except RuntimeError as error:
        for record in captured:
            record["processingStatus"] = "failed"
            record["processingError"] = f"DeepSeek 维护失败：{error}"
        mirror(captured)
        return records
    try:
        mirrored_paths = set(mirror_knowledge())
    except (HTTPError, URLError, TimeoutError, ValueError, RuntimeError) as error:
        for record in captured:
            record["processingStatus"] = "failed"
            record["processingError"] = f"线上镜像失败：{error}"
        mirror(captured)
        return records
    maintained_paths = set(read_state_source_paths(root))
    for record in captured:
        local_path = record["localPath"]
        if local_path in mirrored_paths:
            record["processingStatus"] = "mirrored"
            record["processingError"] = ""
        elif local_path in maintained_paths:
            record["processingStatus"] = "failed"
            record["processingError"] = "DeepSeek 已维护，但线上知识镜像没有确认该来源"
        else:
            record["processingStatus"] = "captured"
            record["processingError"] = "正文已获取，等待下一轮 DeepSeek 维护"
    mirror(captured)
    return records


def read_state_source_paths(root: Path) -> list[str]:
    state_path = root / "wiki" / "00 系统" / "deepseek-maintenance-state.json"
    if not state_path.exists():
        return []
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    sources = state.get("sources", {}) if isinstance(state, dict) else {}
    return [str(path) for path in sources if isinstance(path, str)] if isinstance(sources, dict) else []


def creator_sources(root: Path) -> list[dict[str, str]]:
    path = root / "wiki" / "00 系统" / "creator-sources.json"
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    sources = payload.get("sources", []) if isinstance(payload, dict) else []
    return [source for source in sources if isinstance(source, dict) and source.get("name") and source.get("rss_url")]


def rss_items(url: str, creator: str) -> list[InboxItem]:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/rss+xml,application/atom+xml,text/xml"})
    with urlopen(request, timeout=30) as response:
        root = element_tree.fromstring(response.read())
    items: list[InboxItem] = []
    for node in root.findall(".//item") + root.findall(".//{http://www.w3.org/2005/Atom}entry"):
        title = (node.findtext("title") or node.findtext("{http://www.w3.org/2005/Atom}title") or "未命名文章").strip()
        link = (node.findtext("link") or "").strip()
        atom_link = node.find("{http://www.w3.org/2005/Atom}link")
        if atom_link is not None:
            link = atom_link.attrib.get("href", link)
        published = (node.findtext("pubDate") or node.findtext("published") or node.findtext("{http://www.w3.org/2005/Atom}published") or "").strip()
        if link:
            items.append(InboxItem("", "", link, title, creator, published))
    return items[:30]


def run(
    root: Path,
    server: str,
    token: str,
    site_bypass_token: str,
    dry_run: bool,
    bridge_url: str = DEFAULT_BRIDGE_URL,
    bridge_token: str = "",
    bridge_timeout: float = 15,
) -> tuple[int, int]:
    remote_items: list[InboxItem] = []
    if server and token:
        payload = request_json(f"{server.rstrip('/')}/api/local-sync/inbox", token, site_bypass_token=site_bypass_token)
        for raw in payload.get("items", []):
            remote_items.append(InboxItem(
                str(raw.get("id", "")), str(raw.get("content", "")), str(raw.get("sourceUrl", "")),
                str(raw.get("sourceTitle", "")), str(raw.get("publisher", "")), str(raw.get("publishedAt", "")),
                str(raw.get("processingStatus", "")),
            ))

    discovered: list[tuple[InboxItem, str]] = [(item, "") for item in remote_items]
    for source in creator_sources(root):
        try:
            discovered.extend((item, str(source["name"])) for item in rss_items(str(source["rss_url"]), str(source["name"])))
        except (HTTPError, URLError, element_tree.ParseError) as error:
            print(f"creator feed failed: {source['name']}: {error}", file=sys.stderr)

    records: list[dict[str, str]] = []
    bridge_captures = 0
    for item, creator in discovered:
        if dry_run:
            print(f"would process: {item.source_url or item.source_title}")
            continue
        use_bridge = is_restricted(item.source_url) and bridge_captures < 5
        if use_bridge:
            bridge_captures += 1
        records.append(process_item(
            root,
            item,
            creator,
            bridge_url if use_bridge else "",
            bridge_token if use_bridge else "",
            bridge_timeout,
        ))

    if records and not dry_run:
        append_log(root, records)
    if records and server and token and not dry_run:
        from wiki_deepseek_maintainer import DEFAULT_MODEL, load_api_key, maintain

        def mirror(items: list[dict[str, str]]) -> None:
            request_json(f"{server.rstrip('/')}/api/local-sync/mirror", token, {"items": items}, site_bypass_token)

        def maintain_wiki() -> None:
            processed, _ = maintain(root, load_api_key(), DEFAULT_MODEL)
            print(f"DeepSeek Wiki maintenance: processed={processed}")

        def mirror_knowledge() -> set[str]:
            paths = sync_maintained_knowledge(root, server, token, site_bypass_token)
            print(f"local Wiki knowledge mirrored online: {len(paths)}")
            return paths

        finalize_records(root, records, mirror, maintain_wiki, mirror_knowledge)
    return len(discovered), len(records)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Sync the online source inbox into the local Wiki.")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--server", default="", help="Private web product URL, e.g. https://example.com")
    parser.add_argument("--token", default="", help="One-time token from the online product")
    parser.add_argument("--site-bypass-token", default="", help="Private site access token; stored in macOS Keychain")
    parser.add_argument("--bridge-url", default=DEFAULT_BRIDGE_URL, help="Loopback browser capture bridge URL")
    parser.add_argument("--bridge-token", default="", help="Local bridge token; read from macOS Keychain by default")
    parser.add_argument("--bridge-timeout", type=float, default=15, help="Seconds to wait for each browser capture")
    parser.add_argument("--configure", action="store_true", help="Store --token in macOS Keychain")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    token = load_token(args.token)
    site_bypass_token = load_token(args.site_bypass_token, SITE_BYPASS_KEYCHAIN_SERVICE)
    bridge_token = load_bridge_token(args.bridge_token)
    if args.configure:
        if not token:
            parser.error("--configure requires --token")
        store_token(token)
        if args.site_bypass_token:
            store_token(args.site_bypass_token, SITE_BYPASS_KEYCHAIN_SERVICE)
        print(f"saved local sync token in Keychain service {KEYCHAIN_SERVICE}")
        return 0
    if not args.server or not token:
        parser.error("--server and a token (or Keychain entry) are required")
    if not site_bypass_token:
        parser.error("private site access token is not configured")
    scanned, written = run(
        args.root.resolve(), args.server, token, site_bypass_token, args.dry_run,
        args.bridge_url, bridge_token, args.bridge_timeout,
    )
    print(f"local wiki sync: scanned={scanned} written={written}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
