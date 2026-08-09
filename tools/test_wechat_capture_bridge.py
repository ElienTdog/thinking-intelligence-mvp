import base64
import importlib.util
import json
import re
import sys
import tempfile
import threading
import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


BRIDGE_PATH = Path(__file__).with_name("wechat_capture_bridge.py")
BRIDGE_SPEC = importlib.util.spec_from_file_location("wechat_capture_bridge", BRIDGE_PATH)
assert BRIDGE_SPEC and BRIDGE_SPEC.loader
BRIDGE = importlib.util.module_from_spec(BRIDGE_SPEC)
sys.modules[BRIDGE_SPEC.name] = BRIDGE
BRIDGE_SPEC.loader.exec_module(BRIDGE)

SYNC_PATH = Path(__file__).with_name("wiki_inbox_sync.py")
SYNC_SPEC = importlib.util.spec_from_file_location("wiki_inbox_sync_bridge_test", SYNC_PATH)
assert SYNC_SPEC and SYNC_SPEC.loader
SYNC = importlib.util.module_from_spec(SYNC_SPEC)
sys.modules[SYNC_SPEC.name] = SYNC
SYNC_SPEC.loader.exec_module(SYNC)


class FixtureText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.article_depth = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if values.get("id") == "js_content":
            self.article_depth = 1
        elif self.article_depth:
            self.article_depth += 1

    def handle_endtag(self, tag):
        if self.article_depth:
            self.article_depth -= 1

    def handle_data(self, data):
        if self.article_depth:
            self.parts.append(data.strip())


def fixture_payload(source_url):
    html = Path(__file__).with_name("fixtures").joinpath("wechat_article.html").read_text(encoding="utf-8")
    parser = FixtureText()
    parser.feed(html)
    image = re.search(r"data:image/png;base64,([A-Za-z0-9+/=]+)", html)
    return {
        "status": "captured",
        "sourceUrl": source_url,
        "title": "一次真实的 AI 产品判断",
        "author": "数字生命卡兹克",
        "publishedAt": "2026-08-09",
        "markdown": "\n\n".join(part for part in parser.parts if part),
        "html": html,
        "images": [{"mimeType": "image/png", "dataBase64": image.group(1)}],
        "evidence": "本地 HTML fixture 的 #js_content",
    }


class WechatCaptureBridgeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "wiki/01 原始材料").mkdir(parents=True)
        (self.root / "wiki/log.md").write_text("# Log\n", encoding="utf-8")
        self.token = "local-test-token"
        self.server = BRIDGE.create_server(self.root / "bridge.sqlite3", self.token, 0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def request(self, path, token, payload=None):
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = Request(
            self.base_url + path,
            data=data,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            method="POST" if data is not None else "GET",
        )
        with urlopen(request, timeout=3) as response:
            return json.loads(response.read().decode("utf-8"))

    def queue_and_complete(self, source_url, payload):
        queued = self.request("/v1/captures", self.token, {"itemId": "clip-1", "sourceUrl": source_url, "sourceTitle": "同名文章"})
        job_id = queued["job"]["jobId"]
        next_job = self.request("/v1/extension/jobs/next", self.token)["job"]
        self.assertEqual(next_job["jobId"], job_id)
        return self.request(f"/v1/extension/jobs/{job_id}/result", self.token, payload)["job"]

    def test_wrong_token_is_rejected_without_writing_then_valid_token_recovers(self):
        source_url = "https://mp.weixin.qq.com/s?__biz=test&mid=1"
        with self.assertRaises(HTTPError) as caught:
            self.request("/v1/captures", "wrong-token", {"itemId": "clip-1", "sourceUrl": source_url, "sourceTitle": "文章"})
        self.assertEqual(caught.exception.code, 401)
        self.assertEqual(self.server.capture_store.count(), 0)
        result = self.queue_and_complete(source_url, fixture_payload(source_url))
        self.assertEqual(result["status"], "captured")

    def test_fixture_capture_writes_one_source_and_one_valid_local_image(self):
        source_url = "https://mp.weixin.qq.com/s?__biz=test&mid=2"
        self.queue_and_complete(source_url, fixture_payload(source_url))
        item = SYNC.InboxItem("clip-2", "", source_url, "同名文章", "数字生命卡兹克")
        first = SYNC.process_item(self.root, item, bridge_url=self.base_url, bridge_token=self.token, bridge_timeout=1)
        second = SYNC.process_item(self.root, item, bridge_url=self.base_url, bridge_token=self.token, bridge_timeout=1)
        self.assertEqual(first["processingStatus"], "captured")
        self.assertEqual(first["localPath"], second["localPath"])
        self.assertEqual(second["alreadyPresent"], "yes")
        sources = list((self.root / "wiki/01 原始材料/公众号").rglob("*.md"))
        images = list((self.root / "wiki/01 原始材料/_assets/wechat").glob("*.png"))
        self.assertEqual(len(sources), 1)
        self.assertEqual(len(images), 1)
        self.assertTrue(images[0].read_bytes().startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertIn("采集证据：本地 HTML fixture", sources[0].read_text(encoding="utf-8"))

    def test_short_body_requires_user_open_and_creates_no_raw_source(self):
        source_url = "https://mp.weixin.qq.com/s?__biz=test&mid=3"
        payload = fixture_payload(source_url)
        payload["markdown"] = "太短"
        result = self.queue_and_complete(source_url, payload)
        self.assertEqual(result["status"], "needs_user_open")
        item = SYNC.InboxItem("clip-3", "", source_url, "短文章")
        record = SYNC.process_item(self.root, item, bridge_url=self.base_url, bridge_token=self.token, bridge_timeout=1)
        self.assertEqual(record["processingStatus"], "needs_user_open")
        self.assertFalse(list((self.root / "wiki/01 原始材料/公众号").rglob("*.md")))

    def test_url_hash_is_idempotent_and_same_title_different_urls_do_not_collide(self):
        first_url = "https://mp.weixin.qq.com/s?__biz=test&mid=4"
        second_url = "https://mp.weixin.qq.com/s?__biz=test&mid=5"
        first = self.request("/v1/captures", self.token, {"itemId": "a", "sourceUrl": first_url, "sourceTitle": "同名文章"})
        duplicate = self.request("/v1/captures", self.token, {"itemId": "a", "sourceUrl": first_url, "sourceTitle": "同名文章"})
        second = self.request("/v1/captures", self.token, {"itemId": "b", "sourceUrl": second_url, "sourceTitle": "同名文章"})
        self.assertEqual(first["job"]["jobId"], duplicate["job"]["jobId"])
        self.assertNotEqual(first["job"]["jobId"], second["job"]["jobId"])
        self.assertEqual(self.server.capture_store.count(), 2)

    def test_same_title_different_captured_urls_write_distinct_sources(self):
        first_url = "https://mp.weixin.qq.com/s?__biz=test&mid=6"
        second_url = "https://mp.weixin.qq.com/s?__biz=test&mid=7"
        self.queue_and_complete(first_url, fixture_payload(first_url))
        first = SYNC.process_item(
            self.root,
            SYNC.InboxItem("clip-6", "", first_url, "同名文章", "数字生命卡兹克"),
            bridge_url=self.base_url,
            bridge_token=self.token,
            bridge_timeout=1,
        )
        self.queue_and_complete(second_url, fixture_payload(second_url))
        second = SYNC.process_item(
            self.root,
            SYNC.InboxItem("clip-7", "", second_url, "同名文章", "数字生命卡兹克"),
            bridge_url=self.base_url,
            bridge_token=self.token,
            bridge_timeout=1,
        )
        self.assertNotEqual(first["localPath"], second["localPath"])
        self.assertEqual(len(list((self.root / "wiki/01 原始材料/公众号").rglob("*.md"))), 2)

    def test_loading_job_expires_to_needs_user_open(self):
        store = BRIDGE.CaptureStore(self.root / "timeout.sqlite3", timeout_seconds=0)
        source_url = "https://mp.weixin.qq.com/s?__biz=test&mid=8"
        queued = store.queue("clip-8", source_url, "超时文章")
        store.next_job()
        expired = store.get(queued["job_id"])
        self.assertEqual(expired["status"], "needs_user_open")
        self.assertIn("超时", expired["error"])


if __name__ == "__main__":
    unittest.main()
