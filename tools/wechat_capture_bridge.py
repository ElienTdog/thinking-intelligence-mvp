#!/usr/bin/env python3
"""Loopback-only bridge between the local Wiki sync and a browser extension."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import subprocess
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
DEFAULT_TIMEOUT_SECONDS = 90
KEYCHAIN_SERVICE = "thinking-wechat-capture-bridge"
ALLOWED_HOSTS = {"mp.weixin.qq.com"}
MAX_REQUEST_BYTES = 12_000_000
MIN_ARTICLE_CHARS = 400


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_url(value: str) -> str:
    parsed = urlsplit(value.strip())
    host = (parsed.hostname or "").lower()
    path = parsed.path.rstrip("/") or "/"
    is_article_path = path == "/s" or re.fullmatch(r"/s/[A-Za-z0-9_-]+", path) is not None
    if parsed.scheme != "https" or host not in ALLOWED_HOSTS or not is_article_path:
        raise ValueError("only normal https://mp.weixin.qq.com/s article URLs are allowed")
    netloc = host if parsed.port is None else f"{host}:{parsed.port}"
    return urlunsplit(("https", netloc, path, parsed.query, ""))


def url_hash(value: str) -> str:
    return hashlib.sha256(normalize_url(value).encode("utf-8")).hexdigest()


def load_or_create_token(value: str = "") -> str:
    if value.strip():
        return value.strip()
    completed = subprocess.run(
        ["security", "find-generic-password", "-a", "wechat-capture", "-s", KEYCHAIN_SERVICE, "-w"],
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode == 0 and completed.stdout.strip():
        return completed.stdout.strip()
    token = secrets.token_urlsafe(32)
    subprocess.run(
        ["security", "add-generic-password", "-U", "-a", "wechat-capture", "-s", KEYCHAIN_SERVICE, "-w", token],
        check=True,
    )
    return token


class CaptureStore:
    def __init__(self, db_path: Path, timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS) -> None:
        self.db_path = db_path
        self.timeout_seconds = timeout_seconds
        self._lock = threading.Lock()
        db_path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("""
                CREATE TABLE IF NOT EXISTS captures (
                    job_id TEXT PRIMARY KEY,
                    item_id TEXT NOT NULL,
                    source_url TEXT NOT NULL UNIQUE,
                    source_title TEXT NOT NULL,
                    status TEXT NOT NULL,
                    result_json TEXT NOT NULL DEFAULT '{}',
                    error TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(str(self.db_path), timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    def queue(self, item_id: str, source_url: str, source_title: str, retry: bool = False) -> dict[str, Any]:
        normalized = normalize_url(source_url)
        job_id = url_hash(normalized)
        stamp = now_iso()
        with self._lock, self.connect() as db:
            existing = db.execute("SELECT * FROM captures WHERE job_id = ?", (job_id,)).fetchone()
            if existing:
                if retry and existing["status"] in {"needs_user_open", "failed"}:
                    db.execute(
                        "UPDATE captures SET item_id = ?, source_title = ?, status = 'queued', result_json = '{}', error = '', updated_at = ? WHERE job_id = ?",
                        (item_id, source_title, stamp, job_id),
                    )
                    existing = db.execute("SELECT * FROM captures WHERE job_id = ?", (job_id,)).fetchone()
                return dict(existing)
            db.execute(
                "INSERT INTO captures (job_id, item_id, source_url, source_title, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, ?)",
                (job_id, item_id, normalized, source_title, stamp, stamp),
            )
            return dict(db.execute("SELECT * FROM captures WHERE job_id = ?", (job_id,)).fetchone())

    def next_job(self) -> dict[str, Any] | None:
        with self._lock, self.connect() as db:
            self._expire(db)
            row = db.execute("SELECT * FROM captures WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1").fetchone()
            if not row:
                return None
            db.execute("UPDATE captures SET status = 'loading', updated_at = ? WHERE job_id = ?", (now_iso(), row["job_id"]))
            return dict(db.execute("SELECT * FROM captures WHERE job_id = ?", (row["job_id"],)).fetchone())

    def get(self, job_id: str) -> dict[str, Any] | None:
        with self._lock, self.connect() as db:
            self._expire(db)
            row = db.execute("SELECT * FROM captures WHERE job_id = ?", (job_id,)).fetchone()
        if not row:
            return None
        result = dict(row)
        try:
            result["result"] = json.loads(result.pop("result_json"))
        except json.JSONDecodeError:
            result["result"] = {}
        return result

    def _expire(self, db: sqlite3.Connection) -> None:
        cutoff = (datetime.now(timezone.utc) - timedelta(seconds=self.timeout_seconds)).isoformat()
        db.execute(
            "UPDATE captures SET status = 'needs_user_open', error = '浏览器加载超时，需要打开页面后重试', updated_at = ? WHERE status = 'loading' AND updated_at < ?",
            (now_iso(), cutoff),
        )

    def complete(self, job_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
        current = self.get(job_id)
        if not current:
            return None
        incoming_url = normalize_url(str(payload.get("sourceUrl", "")))
        if incoming_url != current["source_url"]:
            raise ValueError("captured URL does not match queued URL")
        requested_status = str(payload.get("status", "captured"))
        markdown = str(payload.get("markdown", "")).strip()
        if requested_status == "captured" and len(markdown) < MIN_ARTICLE_CHARS:
            requested_status = "needs_user_open"
            payload = {**payload, "markdown": ""}
            error = "页面正文不足，需在授权浏览器中打开后重试"
        elif requested_status in {"needs_user_open", "failed"}:
            error = str(payload.get("error", ""))[:1000] or ("需要用户打开页面" if requested_status == "needs_user_open" else "浏览器采集失败")
        elif requested_status == "captured":
            error = ""
        else:
            raise ValueError("invalid capture status")
        safe_payload = {
            "sourceUrl": incoming_url,
            "title": str(payload.get("title", ""))[:500],
            "author": str(payload.get("author", ""))[:300],
            "publishedAt": str(payload.get("publishedAt", ""))[:100],
            "markdown": markdown[:500_000] if requested_status == "captured" else "",
            "html": str(payload.get("html", ""))[:1_000_000] if requested_status == "captured" else "",
            "images": payload.get("images", [])[:8] if isinstance(payload.get("images"), list) else [],
            "evidence": str(payload.get("evidence", ""))[:1000],
        }
        with self._lock, self.connect() as db:
            db.execute(
                "UPDATE captures SET status = ?, result_json = ?, error = ?, updated_at = ? WHERE job_id = ?",
                (requested_status, json.dumps(safe_payload, ensure_ascii=False), error, now_iso(), job_id),
            )
        return self.get(job_id)

    def count(self) -> int:
        with self.connect() as db:
            return int(db.execute("SELECT COUNT(*) FROM captures").fetchone()[0])


def public_job(record: dict[str, Any] | None) -> dict[str, Any] | None:
    if not record:
        return None
    return {
        "jobId": record["job_id"],
        "itemId": record["item_id"],
        "sourceUrl": record["source_url"],
        "sourceTitle": record["source_title"],
        "status": record["status"],
        "result": record.get("result", {}),
        "error": record.get("error", ""),
        "updatedAt": record["updated_at"],
    }


def handler_class(store: CaptureStore, token: str) -> type[BaseHTTPRequestHandler]:
    class CaptureHandler(BaseHTTPRequestHandler):
        server_version = "ThinkingWechatCapture/0.1"

        def log_message(self, format: str, *args: Any) -> None:
            return

        def send_json(self, status: int, payload: Any) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.end_headers()
            self.wfile.write(body)

        def authorized(self) -> bool:
            supplied = self.headers.get("Authorization", "").removeprefix("Bearer ").strip()
            if supplied and hmac.compare_digest(supplied, token):
                return True
            self.send_json(401, {"error": "invalid local bridge token"})
            return False

        def read_json(self) -> dict[str, Any]:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_REQUEST_BYTES:
                raise ValueError("invalid request size")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("JSON object required")
            return payload

        def do_OPTIONS(self) -> None:
            self.send_json(204, {})

        def do_GET(self) -> None:
            if not self.authorized():
                return
            if self.path == "/v1/extension/jobs/next":
                self.send_json(200, {"job": public_job(store.next_job())})
                return
            prefix = "/v1/captures/"
            if self.path.startswith(prefix):
                record = store.get(self.path[len(prefix):])
                self.send_json(200 if record else 404, {"job": public_job(record)} if record else {"error": "capture not found"})
                return
            self.send_json(404, {"error": "not found"})

        def do_POST(self) -> None:
            if not self.authorized():
                return
            try:
                payload = self.read_json()
                if self.path == "/v1/captures":
                    record = store.queue(
                        str(payload.get("itemId", ""))[:100],
                        str(payload.get("sourceUrl", "")),
                        str(payload.get("sourceTitle", ""))[:500],
                        bool(payload.get("retry")),
                    )
                    self.send_json(202, {"job": public_job(record)})
                    return
                prefix = "/v1/extension/jobs/"
                if self.path.startswith(prefix) and self.path.endswith("/result"):
                    job_id = self.path[len(prefix):-len("/result")]
                    record = store.complete(job_id, payload)
                    self.send_json(200 if record else 404, {"job": public_job(record)} if record else {"error": "capture not found"})
                    return
                self.send_json(404, {"error": "not found"})
            except (json.JSONDecodeError, ValueError) as error:
                self.send_json(400, {"error": str(error)})

    return CaptureHandler


def create_server(db_path: Path, token: str, port: int = DEFAULT_PORT) -> ThreadingHTTPServer:
    store = CaptureStore(db_path)
    server = ThreadingHTTPServer((DEFAULT_HOST, port), handler_class(store, token))
    server.capture_store = store  # type: ignore[attr-defined]
    return server


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the loopback WeChat browser capture bridge.")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--token", default="")
    parser.add_argument("--show-token", action="store_true", help="Print the extension pairing token, then exit")
    parser.add_argument("--ensure-token", action="store_true", help="Create the Keychain token when missing, then exit silently")
    args = parser.parse_args(argv)
    token = load_or_create_token(args.token)
    if args.ensure_token:
        return 0
    if args.show_token:
        print(token)
        return 0
    db_path = args.root.resolve() / ".logs" / "wechat-capture-bridge.sqlite3"
    server = create_server(db_path, token, args.port)
    print(f"WeChat capture bridge listening on http://{DEFAULT_HOST}:{server.server_port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
