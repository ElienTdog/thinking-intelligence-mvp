import importlib.util
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("wiki_deepseek_maintainer.py")
SPEC = importlib.util.spec_from_file_location("wiki_deepseek_maintainer", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class WikiDeepSeekMaintainerTests(unittest.TestCase):
    def make_root(self) -> Path:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        for directory in (
            "wiki/01 原始材料",
            "wiki/02 问题",
            "wiki/03 主题与主张",
            "wiki/04 概念与方法",
            "wiki/05 来源与人物",
            "wiki/06 我的判断",
        ):
            (root / directory).mkdir(parents=True, exist_ok=True)
        (root / "wiki/index.md").write_text("# 知识索引\n", encoding="utf-8")
        (root / "wiki/log.md").write_text("# 日志\n", encoding="utf-8")
        for qid, path in MODULE.QUESTION_PATHS.items():
            (root / path).write_text(f"# {qid}\n\n旧综合判断。\n", encoding="utf-8")
        return root

    def test_raw_sources_exclude_unverified_leads_and_clipping_tasks(self):
        root = self.make_root()
        source = root / "wiki/01 原始材料/文章.md"
        source.write_text('---\nsource: "https://example.com/article"\n---\n\n' + "正文" * 500, encoding="utf-8")
        lead = root / "wiki/01 原始材料/AI HOT 线索/线索.md"
        lead.parent.mkdir(parents=True)
        lead.write_text('---\nsource: "https://example.com/lead"\n---\n\n' + "摘要" * 500, encoding="utf-8")
        task = root / "wiki/01 原始材料/待剪藏/任务.md"
        task.parent.mkdir(parents=True)
        task.write_text("类型：待剪藏任务\n\n## 原文\n\n" + "内容" * 500, encoding="utf-8")
        self.assertEqual(MODULE.raw_sources(root), [source])

    def test_apply_plan_updates_only_allowed_wiki_layer_and_keeps_source_link(self):
        root = self.make_root()
        source = root / "wiki/01 原始材料/文章.md"
        source.write_text('---\nsource: "https://example.com/article"\n---\n\n' + "正文" * 500, encoding="utf-8")
        source_link = "[[01 原始材料/文章]]"
        plan = {
            "updates": [
                {
                    "kind": "question",
                    "targetPath": "wiki/02 问题/Q1 - 如何才叫 AI 用得深.md",
                    "content": f"# Q1\n\n## 当前综合判断\n\n更新。{source_link}",
                    "summary": "补充了验证维度",
                },
                {
                    "kind": "topic",
                    "targetPath": "wiki/06 我的判断/不应写入.md",
                    "content": f"# 错误\n\n{source_link}",
                },
            ]
        }
        pages = MODULE.apply_plan(root, source, plan)
        self.assertEqual(len(pages), 1)
        self.assertIn(source_link, (root / MODULE.QUESTION_PATHS["Q1"]).read_text(encoding="utf-8"))
        self.assertFalse((root / "wiki/06 我的判断/不应写入.md").exists())

    def test_index_block_is_replaced_instead_of_accumulated(self):
        root = self.make_root()
        page = root / "wiki/03 主题与主张/主题.md"
        page.write_text("# 主题\n", encoding="utf-8")
        MODULE.update_index(root, [(page, "第一次")])
        MODULE.update_index(root, [(page, "第二次")])
        content = (root / "wiki/index.md").read_text(encoding="utf-8")
        self.assertEqual(content.count(MODULE.INDEX_START), 1)
        self.assertIn("第二次", content)

    def test_candidate_pages_keep_the_prompt_budget_bounded(self):
        root = self.make_root()
        for index in range(20):
            page = root / f"wiki/03 主题与主张/主题-{index}.md"
            page.write_text("内容" * 4000, encoding="utf-8")
        pages = MODULE.candidate_pages(root)
        self.assertLessEqual(len(pages), MODULE.MAX_EXISTING_PAGES)
        self.assertTrue(all(len(page["content"]) <= MODULE.MAX_EXISTING_PAGE_CHARS for page in pages))

    def test_every_processed_source_gets_a_digest_page(self):
        root = self.make_root()
        source = root / "wiki/01 原始材料/文章.md"
        source.write_text('---\nsource: "https://example.com/article"\n---\n\n' + "正文" * 500, encoding="utf-8")
        digest, summary = MODULE.write_source_digest(root, source, {
            "sourceSummary": "文章强调先理解真实约束，再验证 AI 产出。",
            "keyPoints": ["上下文比漂亮提示词更关键。"],
            "relation": "support；补充了 Q1 的验证维度。",
            "relatedQuestionIds": ["Q1"],
            "understandingQuestion": "我会怎样验证下一次 AI 输出？",
        })
        content = digest.read_text(encoding="utf-8")
        self.assertEqual(summary, "文章强调先理解真实约束，再验证 AI 产出。")
        self.assertIn("[[01 原始材料/文章]]", content)
        self.assertIn("上下文比漂亮提示词更关键", content)

    def test_deepseek_plan_requires_three_distinct_traceable_units(self):
        unit = {
            "title": "验证比提示词长度重要",
            "hook": "先决定怎么知道 AI 做对了。",
            "explanation": "原文比较了提示词与验证条件。",
            "topic": "AI 验证",
            "subtopics": ["停止条件"],
            "format": "方法",
            "difficulty": "中等",
            "novelty": 0.7,
            "reasoningMove": "从结果倒推验证",
            "boundary": "不适用于无可观察结果的任务",
            "whyItMatters": "避免只优化输入形式",
            "sourceEvidence": "原文的验证条件段落",
        }
        plan = {"units": [dict(unit, title=f"知识点 {index}") for index in range(3)]}
        self.assertEqual(len(MODULE.validate_knowledge_units(plan)), 3)
        with self.assertRaisesRegex(RuntimeError, "3–6"):
            MODULE.validate_knowledge_units({"units": plan["units"][:2]})

    def test_digest_keeps_deepseek_units_and_source_evidence(self):
        root = self.make_root()
        source = root / "wiki/01 原始材料/文章.md"
        source.write_text('---\nsource: "https://example.com/article"\n---\n\n' + "正文" * 500, encoding="utf-8")
        base = {
            "hook": "一句人话入口", "explanation": "解释", "topic": "动态主题", "subtopics": ["边界"],
            "format": "案例", "difficulty": "中等", "novelty": 0.5, "reasoningMove": "对照",
            "boundary": "只在来源范围内", "whyItMatters": "可迁移", "sourceEvidence": "原文第二段",
        }
        digest, _ = MODULE.write_source_digest(root, source, {
            "sourceSummary": "摘要",
            "units": [dict(base, title=f"知识点 {index}") for index in range(3)],
        })
        content = digest.read_text(encoding="utf-8")
        self.assertIn("## 可独立阅读的知识单元", content)
        self.assertEqual(content.count("原文证据：原文第二段"), 3)
        marker = re.search(r"<!-- deepseek-knowledge-units\s*\n(.*?)\n-->", content, re.DOTALL)
        self.assertIsNotNone(marker)
        self.assertEqual(len(json.loads(marker.group(1))), 3)

    def test_pending_sources_can_be_limited_to_followed_creator(self):
        root = self.make_root()
        first = root / "wiki/01 原始材料/卡兹克.md"
        second = root / "wiki/01 原始材料/其他.md"
        first.write_text('---\nsource: "https://example.com/a"\nauthor:\n  - "[[数字生命卡兹克]]"\n---\n\n## 原文\n\n' + "正文" * 500, encoding="utf-8")
        second.write_text('---\nsource: "https://example.com/b"\nauthor:\n  - "[[其他作者]]"\n---\n\n## 原文\n\n' + "正文" * 500, encoding="utf-8")
        pending = MODULE.pending_sources(root, {"sources": {}}, creators={"数字生命卡兹克"})
        self.assertEqual(pending, [first])

    def test_maintenance_plan_asks_deepseek_once_to_repair_invalid_units(self):
        root = self.make_root()
        source = root / "wiki/01 原始材料/文章.md"
        source.write_text('---\nsource: "https://example.com"\n---\n\n## 原文\n\n' + "正文" * 500, encoding="utf-8")
        base = {"hook": "入口", "explanation": "解释", "topic": "主题", "subtopics": [], "format": "方法", "difficulty": "中等", "novelty": 0.5, "reasoningMove": "对照", "boundary": "边界", "whyItMatters": "重要", "sourceEvidence": "原文段落"}
        responses = [
            {"units": [{"title": "不完整"}]},
            {"units": [dict(base, title=f"知识点 {index}") for index in range(3)]},
        ]
        calls = []
        original_post = MODULE.post_json
        try:
            def fake_post(payload, _key):
                calls.append(payload)
                return {"choices": [{"message": {"content": json.dumps(responses.pop(0), ensure_ascii=False)}}]}
            MODULE.post_json = fake_post
            plan = MODULE.maintenance_plan(root, source, source.read_text(encoding="utf-8"), "key", "model")
        finally:
            MODULE.post_json = original_post
        self.assertEqual(len(calls), 2)
        self.assertEqual(len(plan["units"]), 3)

    def test_maintain_targets_ten_units_and_records_real_api_usage(self):
        root = self.make_root()
        for index in range(5):
            source = root / f"wiki/01 原始材料/文章-{index}.md"
            source.write_text(
                f'---\nsource: "https://example.com/{index}"\n---\n\n## 原文\n\n' + "正文" * 500,
                encoding="utf-8",
            )
        base = {
            "hook": "入口", "explanation": "解释", "topic": "主题", "subtopics": ["边界"],
            "format": "方法", "difficulty": "中等", "novelty": 0.5, "reasoningMove": "对照",
            "boundary": "边界", "whyItMatters": "重要", "sourceEvidence": "原文段落",
        }
        original_plan = MODULE.maintenance_plan
        try:
            def fake_plan(_root, source, _content, _key, model):
                return {
                    "sourceSummary": f"{source.stem} 的摘要",
                    "keyPoints": ["关键点"],
                    "relation": "补充现有理解。",
                    "relatedQuestionIds": [],
                    "understandingQuestion": "这会改变什么判断？",
                    "units": [dict(base, title=f"{source.stem} 知识点 {unit}") for unit in range(4)],
                    "updates": [],
                    "_deepseek_api": {
                        "provider": "DeepSeek API", "model": model, "api_calls": 1,
                        "prompt_tokens": 80, "completion_tokens": 20, "total_tokens": 100,
                    },
                }
            MODULE.maintenance_plan = fake_plan
            processed, pending = MODULE.maintain(
                root, "key", "deepseek-test", limit=10, target_units=10,
            )
        finally:
            MODULE.maintenance_plan = original_plan

        self.assertEqual(processed, 3)
        self.assertEqual(pending, 5)
        state = MODULE.read_state(root)
        self.assertEqual(state["last_run"]["knowledge_units"], 12)
        self.assertEqual(state["last_run"]["unit_shortfall"], 0)
        self.assertEqual(state["last_run"]["api_calls"], 3)
        self.assertEqual(state["last_run"]["total_tokens"], 300)
        self.assertTrue(all(item["provider"] == "DeepSeek API" for item in state["sources"].values()))

    def test_one_deepseek_failure_does_not_abort_the_daily_batch(self):
        root = self.make_root()
        for index in range(2):
            source = root / f"wiki/01 原始材料/文章-{index}.md"
            source.write_text(
                f'---\nsource: "https://example.com/{index}"\n---\n\n## 原文\n\n' + "正文" * 500,
                encoding="utf-8",
            )
        base = {
            "hook": "入口", "explanation": "解释", "topic": "主题", "subtopics": [],
            "format": "方法", "difficulty": "中等", "novelty": 0.5, "reasoningMove": "对照",
            "boundary": "边界", "whyItMatters": "重要", "sourceEvidence": "原文段落",
        }
        original_plan = MODULE.maintenance_plan
        try:
            def fake_plan(_root, source, _content, _key, model):
                if source.stem == "文章-0":
                    raise RuntimeError("temporary DeepSeek error")
                return {
                    "sourceSummary": "摘要", "units": [dict(base, title=f"知识点 {unit}") for unit in range(3)],
                    "updates": [], "_deepseek_api": {"provider": "DeepSeek API", "model": model, "api_calls": 1},
                }
            MODULE.maintenance_plan = fake_plan
            processed, _ = MODULE.maintain(root, "key", "deepseek-test", limit=10, target_units=10)
        finally:
            MODULE.maintenance_plan = original_plan
        state = MODULE.read_state(root)
        self.assertEqual(processed, 1)
        self.assertEqual(state["last_run"]["unit_shortfall"], 7)
        self.assertEqual(len(state["last_run"]["failures"]), 1)

    def test_json_parser_accepts_deepseek_code_fence(self):
        parsed = MODULE.parse_json_object('```json\n{"units": []}\n```', "bad json")
        self.assertEqual(parsed, {"units": []})
