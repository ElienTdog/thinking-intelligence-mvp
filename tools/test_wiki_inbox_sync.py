import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("wiki_inbox_sync.py")
SPEC = importlib.util.spec_from_file_location("wiki_inbox_sync", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)

MAINTAINER_PATH = Path(__file__).with_name("wiki_deepseek_maintainer.py")
MAINTAINER_SPEC = importlib.util.spec_from_file_location("wiki_deepseek_maintainer_integration", MAINTAINER_PATH)
assert MAINTAINER_SPEC and MAINTAINER_SPEC.loader
MAINTAINER = importlib.util.module_from_spec(MAINTAINER_SPEC)
sys.modules[MAINTAINER_SPEC.name] = MAINTAINER
MAINTAINER_SPEC.loader.exec_module(MAINTAINER)


class WikiInboxSyncTests(unittest.TestCase):
    def make_root(self) -> Path:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        (root / "wiki" / "01 原始材料").mkdir(parents=True)
        (root / "wiki" / "log.md").write_text("# Log\n", encoding="utf-8")
        return root

    def prepare_maintainer_root(self, root: Path) -> None:
        for directory in (
            "wiki/02 问题", "wiki/03 主题与主张", "wiki/04 概念与方法",
            "wiki/05 来源与人物", "wiki/06 我的判断", "wiki/07 练习与案例",
        ):
            (root / directory).mkdir(parents=True, exist_ok=True)
        (root / "wiki/index.md").write_text("# 索引\n", encoding="utf-8")
        for qid, path in MAINTAINER.QUESTION_PATHS.items():
            (root / path).write_text(f"# {qid}\n", encoding="utf-8")

    def test_restricted_link_becomes_a_clipping_task(self):
        root = self.make_root()
        item = MODULE.InboxItem("task-1", "", "https://mp.weixin.qq.com/s/example", "公众号文章", "数字生命卡兹克")
        record = MODULE.process_item(root, item)
        self.assertEqual(record["processingStatus"], "needs_user_open")
        path = root / record["localPath"]
        self.assertTrue(path.exists())
        self.assertIn("需要在浏览器打开", path.read_text(encoding="utf-8"))

    def test_manual_text_is_saved_as_a_local_source(self):
        root = self.make_root()
        item = MODULE.InboxItem("task-2", "一段我希望保留的原始文字", "", "手动记录")
        record = MODULE.process_item(root, item)
        self.assertEqual(record["processingStatus"], "captured")
        self.assertIn("一段我希望保留的原始文字", (root / record["localPath"]).read_text(encoding="utf-8"))

    def test_existing_url_is_not_written_twice(self):
        root = self.make_root()
        item = MODULE.InboxItem("task-3", "", "https://mp.weixin.qq.com/s/example", "公众号文章")
        first = MODULE.process_item(root, item)
        second = MODULE.process_item(root, item)
        self.assertEqual(first["localPath"], second["localPath"])
        self.assertEqual(second["alreadyPresent"], "yes")

    def test_same_titled_restricted_links_keep_separate_clipping_tasks(self):
        root = self.make_root()
        first = MODULE.process_item(root, MODULE.InboxItem("task-4", "", "https://mp.weixin.qq.com/s/first", "mp.weixin.qq.com"))
        second = MODULE.process_item(root, MODULE.InboxItem("task-5", "", "https://mp.weixin.qq.com/s/second", "mp.weixin.qq.com"))
        self.assertNotEqual(first["localPath"], second["localPath"])
        self.assertTrue((root / first["localPath"]).exists())
        self.assertTrue((root / second["localPath"]).exists())

    def test_maintained_sources_are_prepared_for_online_mirror(self):
        root = self.make_root()
        raw = root / "wiki/01 原始材料/网页剪藏/卡兹克.md"
        raw.parent.mkdir(parents=True)
        raw.write_text('---\ntitle: "卡兹克文章"\nsource: "https://example.com"\nauthor:\n  - "[[数字生命卡兹克]]"\n---\n\n正文', encoding="utf-8")
        digest = root / "wiki/03 主题与主张/来源解读/卡兹克解读.md"
        digest.parent.mkdir(parents=True)
        digest.write_text("# 来源解读：卡兹克文章\n\n关联问题：[[02 问题/Q1 - 如何才叫 AI 用得深]]\n\n## 这篇文章说了什么\n\n总结。\n\n## 关键点\n\n- 要点。\n\n## 与现有 Wiki 的关系\n\n支持。\n\n## 带入真实任务的问题\n\n怎么验证？\n", encoding="utf-8")
        state = {"sources": {"wiki/01 原始材料/网页剪藏/卡兹克.md": {"pages": ["wiki/03 主题与主张/来源解读/卡兹克解读.md"]}}}
        state_path = root / "wiki/00 系统/deepseek-maintenance-state.json"
        state_path.parent.mkdir(parents=True)
        state_path.write_text(MODULE.json.dumps(state), encoding="utf-8")
        items = MODULE.maintained_knowledge_items(root)
        self.assertEqual(items[0]["sourceName"], "数字生命卡兹克")
        self.assertEqual(items[0]["digest"]["keyPoints"], ["要点。"]) 

    def test_wechat_hotlink_is_not_used_as_an_online_cover(self):
        hotlink = "![图片](https://mmbiz.qpic.cn/mmbiz_png/example/640?wx_fmt=png)"
        safe_image = "![图片](https://images.example.com/cover.png)"
        self.assertEqual(MODULE.first_markdown_image(hotlink), "")
        self.assertEqual(MODULE.first_markdown_image(safe_image), "https://images.example.com/cover.png")

    def test_local_obsidian_image_becomes_a_private_inline_cover(self):
        root = self.make_root()
        image = root / "wiki/01 原始材料/_assets/wechat/cover.png"
        image.parent.mkdir(parents=True)
        image.write_bytes(b"\x89PNG\r\n\x1a\n" + b"cover-bytes")
        cover = MODULE.first_markdown_image("![[wiki/01 原始材料/_assets/wechat/cover.png]]", root)
        self.assertTrue(cover.startswith("data:image/png;base64,"))
        self.assertEqual(MODULE.base64.b64decode(cover.split(",", 1)[1]), image.read_bytes())

    def test_local_cover_cannot_escape_the_assets_directory(self):
        root = self.make_root()
        private = root / "private.png"
        private.write_bytes(b"\x89PNG\r\n\x1a\n" + b"private")
        self.assertEqual(MODULE.first_markdown_image("![[private.png]]", root), "")

    def test_captured_source_flows_through_deepseek_input_and_mirror_payload(self):
        root = self.make_root()
        self.prepare_maintainer_root(root)
        judgment = root / "wiki/06 我的判断/我的判断.md"
        judgment.write_text("# 我的判断\n\n只能由我修改。\n", encoding="utf-8")
        body = "这是一段来自已授权浏览器的真实文章正文。" * 80
        item = MODULE.InboxItem("clip-flow", "", "https://mp.weixin.qq.com/s?__biz=test&mid=flow", "真实文章", "数字生命卡兹克", "2026-08-09")
        path, content = MODULE.write_source(root, item, item.source_title, body, item.publisher, "浏览器 fixture")
        record = MODULE.mirror_record(root, item, path, content, "captured", "verified", "")
        prompts = []
        original_post = MAINTAINER.post_json

        def fake_post(payload, _api_key):
            prompts.append(payload["messages"][1]["content"])
            plan = {
                "sourceSummary": "文章讨论真实任务、验证和人的取舍。",
                "keyPoints": ["先获得可追溯原文", "再由 DeepSeek 维护来源解读"],
                "relation": "support；补充了从采集到验证的完整证据链。",
                "relatedQuestionIds": ["Q1"],
                "understandingQuestion": "这会改变你下一次使用 AI 的哪项验证？",
                "updates": [],
            }
            return {"choices": [{"message": {"content": json.dumps(plan, ensure_ascii=False)}}]}

        snapshots = []
        payloads = []
        try:
            MAINTAINER.post_json = fake_post

            def mirror(records):
                snapshots.append(json.loads(json.dumps(records, ensure_ascii=False)))

            def maintain_wiki():
                processed, _ = MAINTAINER.maintain(root, "test-key", "deepseek-test", limit=1)
                self.assertEqual(processed, 1)

            def mirror_knowledge():
                items = MODULE.maintained_knowledge_items(root)
                payloads.extend(items)
                return {entry["sourceLocalPath"] for entry in items}

            MODULE.finalize_records(root, [record], mirror, maintain_wiki, mirror_knowledge)
        finally:
            MAINTAINER.post_json = original_post

        self.assertIn(body[:200], prompts[0])
        self.assertEqual([batch[0]["processingStatus"] for batch in snapshots], ["captured", "maintaining", "mirrored"])
        self.assertEqual(payloads[0]["sourceLocalPath"], record["localPath"])
        self.assertEqual(payloads[0]["digest"]["keyPoints"], ["先获得可追溯原文", "再由 DeepSeek 维护来源解读"])
        self.assertEqual(judgment.read_text(encoding="utf-8"), "# 我的判断\n\n只能由我修改。\n")

    def test_needs_user_open_never_calls_deepseek_or_knowledge_mirror(self):
        root = self.make_root()
        item = MODULE.InboxItem("clip-limited", "", "https://mp.weixin.qq.com/s?__biz=test&mid=limited", "受限文章")
        record = MODULE.process_item(root, item)
        called = []

        def unexpected(*_args):
            called.append(True)
            raise AssertionError("unverified source must not enter maintenance")

        snapshots = []
        MODULE.finalize_records(root, [record], lambda records: snapshots.append(records), unexpected, unexpected)
        self.assertEqual(record["processingStatus"], "needs_user_open")
        self.assertFalse(called)
        self.assertFalse((root / "wiki/03 主题与主张/来源解读").exists())
