import unittest
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace

from main import build_parser
from pdf_to_form.llm import (
    LLMBatchInferenceError,
    LLM_INFER_DIR,
    LLM_SYSTEM_PROMPT,
    add_llm_fields_to_leaves,
)
from pdf_to_form.pipeline import PipelineConfig


class FakeCompletions:
    def __init__(self, responses=None):
        self.calls = []
        self.responses = list(responses or [])

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.responses:
            content = self.responses.pop(0)
        else:
            content = json.dumps(
                {"field_name": ["姓"], "input_type": ["普通文本"]},
                ensure_ascii=False,
            )
        message = SimpleNamespace(content=content)
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])


class FakeLLMClient:
    def __init__(self, responses=None):
        self.completions = FakeCompletions(responses=responses)
        self.chat = SimpleNamespace(completions=self.completions)


def make_pages(text, ocr_text=""):
    return [
        {
            "page": 1,
            "size": [100, 100],
            "trees": [
                {
                    "is_leaf": True,
                    "bbox": [10.0, 20.0, 30.0, 40.0],
                    "text": text,
                    "ocr_text": ocr_text,
                    "ocr_nodes": [{"text": ocr_text}] if ocr_text else [],
                    "acroforms": [
                        {
                            "name": "textbox_0_0",
                            "field_type": "/Tx",
                            "rect": [11, 21, 29, 39],
                        }
                    ],
                }
            ],
        }
    ]


class LLMNativeTextTests(unittest.TestCase):
    def test_prompt_requires_chinese_for_multilingual_field_names(self):
        self.assertIn("它们只能对应一个 field_name", LLM_SYSTEM_PROMPT)
        self.assertIn("field_name 就必须选择简洁中文", LLM_SYSTEM_PROMPT)
        self.assertIn("不得选择外文", LLM_SYSTEM_PROMPT)
        self.assertIn("不得输出“中文/English/Italiano”", LLM_SYSTEM_PROMPT)
        self.assertIn("“Cognome / Surname / 姓”只输出“姓”", LLM_SYSTEM_PROMPT)

    def test_main_enables_llm_by_default_and_allows_disabling_it(self):
        parser = build_parser()

        self.assertTrue(parser.parse_args(["rawdata"]).run_llm)
        self.assertFalse(parser.parse_args(["rawdata", "--no-run-llm"]).run_llm)
        self.assertTrue(PipelineConfig(pdf_path=Path("form.pdf")).run_llm)

    def test_default_cache_directory_is_llm_outputs(self):
        self.assertEqual(LLM_INFER_DIR, Path("llm_outputs"))

    def test_llm_uses_native_pdf_text_and_caches_result(self):
        pages = make_pages("1. Cognome / Surname / 姓:", ocr_text="错误的 OCR 文本")
        client = FakeLLMClient()

        with TemporaryDirectory() as temp_dir:
            summary = add_llm_fields_to_leaves(pages, llm_client=client, infer_dir=temp_dir)
            cache_files = list(Path(temp_dir).glob("*.json"))
            cache_payload = json.loads(cache_files[0].read_text(encoding="utf-8"))
            cached_pages = make_pages("1. Cognome / Surname / 姓:", ocr_text="另一份错误 OCR 文本")
            cached_client = FakeLLMClient()
            cached_summary = add_llm_fields_to_leaves(
                cached_pages,
                llm_client=cached_client,
                infer_dir=temp_dir,
            )

        sent_content = client.completions.calls[0]["messages"][1]["content"]
        self.assertIn("1. Cognome / Surname / 姓:", sent_content)
        self.assertIn("共有 1 个 AcroForm", sent_content)
        self.assertIn("textbox_0_0", sent_content)
        self.assertEqual(
            client.completions.calls[0]["extra_body"],
            {"thinking": {"type": "disabled"}},
        )
        llm_field = pages[0]["trees"][0]["llm_ocr_fields"][0]
        self.assertEqual(llm_field["field_name"], "姓")
        self.assertEqual(cache_payload["field_name"], ["姓"])
        self.assertEqual(cache_payload["input_type"], ["普通文本"])
        self.assertNotIn("acroform_name", cache_payload)
        self.assertEqual(summary["remote_calls"], 1)
        self.assertEqual(len(cache_files), 1)
        self.assertEqual(cached_client.completions.calls, [])
        self.assertEqual(cached_summary["cache_hits"], 1)

    def test_changed_native_text_does_not_reuse_cache(self):
        client = FakeLLMClient()

        with TemporaryDirectory() as temp_dir:
            add_llm_fields_to_leaves(make_pages("姓"), llm_client=client, infer_dir=temp_dir)
            add_llm_fields_to_leaves(make_pages("名"), llm_client=client, infer_dir=temp_dir)
            cache_files = list(Path(temp_dir).glob("*.json"))

        self.assertEqual(len(client.completions.calls), 2)
        self.assertEqual(len(cache_files), 2)

    def test_identical_leaf_does_not_share_cache_between_pdf_directories(self):
        client = FakeLLMClient()

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            shanghai_dir = root / "Italy" / "上海版"
            beijing_dir = root / "Italy" / "北京版"
            add_llm_fields_to_leaves(
                make_pages("姓"), llm_client=client, infer_dir=shanghai_dir
            )
            add_llm_fields_to_leaves(
                make_pages("姓"), llm_client=client, infer_dir=beijing_dir
            )
            shanghai_cache = list(shanghai_dir.glob("*.json"))
            beijing_cache = list(beijing_dir.glob("*.json"))

        self.assertEqual(len(client.completions.calls), 2)
        self.assertEqual(len(shanghai_cache), 1)
        self.assertEqual(len(beijing_cache), 1)

    def test_changed_acroforms_do_not_reuse_cache(self):
        two_fields = json.dumps(
            {
                "field_name": ["姓", "名"],
                "input_type": ["普通文本", "普通文本"],
            },
            ensure_ascii=False,
        )
        one_field = json.dumps(
            {"field_name": ["姓"], "input_type": ["普通文本"]},
            ensure_ascii=False,
        )
        client = FakeLLMClient(responses=[one_field, two_fields])
        first_pages = make_pages("姓")
        second_pages = make_pages("姓")
        second_pages[0]["trees"][0]["acroforms"].append(
            {"name": "manual_textbox", "field_type": "/Tx", "rect": [11, 21, 29, 39], "manual": True}
        )

        with TemporaryDirectory() as temp_dir:
            add_llm_fields_to_leaves(first_pages, llm_client=client, infer_dir=temp_dir)
            add_llm_fields_to_leaves(second_pages, llm_client=client, infer_dir=temp_dir)
            cache_files = list(Path(temp_dir).glob("*.json"))

        self.assertEqual(len(client.completions.calls), 2)
        self.assertEqual(len(cache_files), 2)

    def test_ocr_text_is_not_used_when_native_text_is_empty(self):
        pages = make_pages("", ocr_text="OCR 中存在但不应使用的文本")
        client = FakeLLMClient()

        with TemporaryDirectory() as temp_dir:
            summary = add_llm_fields_to_leaves(
                pages,
                llm_client=client,
                infer_dir=temp_dir,
                retry_base_delay=0,
            )

        self.assertEqual(client.completions.calls, [])
        self.assertEqual(summary["skipped_empty_text"], 1)
        self.assertEqual(pages[0]["trees"][0]["llm_ocr_infer"]["source"], "empty_text")

    def test_invalid_json_is_retried_then_succeeds(self):
        pages = make_pages("姓")
        valid = json.dumps(
            {
                "field_name": ["姓"],
                "input_type": ["普通文本"],
            },
            ensure_ascii=False,
        )
        client = FakeLLMClient(responses=["", valid])

        with TemporaryDirectory() as temp_dir:
            summary = add_llm_fields_to_leaves(
                pages,
                llm_client=client,
                infer_dir=temp_dir,
                retry_base_delay=0,
            )

        self.assertEqual(len(client.completions.calls), 2)
        self.assertEqual(summary["api_attempts"], 2)
        self.assertEqual(summary["remote_failed"], 0)

    def test_shorter_list_is_accepted_without_retry(self):
        pages = make_pages("姓")
        incomplete = '{"field_name":[],"input_type":[]}'
        client = FakeLLMClient(responses=[incomplete])

        with TemporaryDirectory() as temp_dir:
            summary = add_llm_fields_to_leaves(
                pages,
                llm_client=client,
                infer_dir=temp_dir,
                retry_base_delay=0,
            )
            error_files = list(Path(temp_dir).glob("*.error.json"))

        self.assertEqual(summary["remote_failed"], 0)
        self.assertEqual(summary["api_attempts"], 1)
        self.assertEqual(len(client.completions.calls), 1)
        self.assertEqual(error_files, [])

    def test_more_llm_fields_than_acroforms_is_retried(self):
        pages = make_pages("姓名 电话")
        too_many = json.dumps(
            {
                "field_name": ["姓名", "电话"],
                "input_type": ["普通文本", "电话"],
            },
            ensure_ascii=False,
        )
        valid = json.dumps(
            {"field_name": ["姓名"], "input_type": ["普通文本"]},
            ensure_ascii=False,
        )
        client = FakeLLMClient(responses=[too_many, valid])

        with TemporaryDirectory() as temp_dir:
            summary = add_llm_fields_to_leaves(
                pages,
                llm_client=client,
                infer_dir=temp_dir,
                retry_base_delay=0,
            )

        self.assertEqual(len(client.completions.calls), 2)
        self.assertEqual(summary["api_attempts"], 2)
        self.assertEqual(pages[0]["trees"][0]["llm_ocr_fields"][0]["field_name"], "姓名")

    def test_mismatched_name_and_type_lists_retry_and_fail_the_batch(self):
        pages = make_pages("姓")
        malformed = '{"field_name":["姓"],"input_type":[]}'
        client = FakeLLMClient(responses=[malformed] * 5)

        with TemporaryDirectory() as temp_dir:
            with self.assertRaises(LLMBatchInferenceError) as context:
                add_llm_fields_to_leaves(
                    pages,
                    llm_client=client,
                    infer_dir=temp_dir,
                    retry_base_delay=0,
                )
            error_files = list(Path(temp_dir).glob("*.error.json"))

        self.assertEqual(context.exception.summary["remote_failed"], 1)
        self.assertEqual(context.exception.summary["api_attempts"], 5)
        self.assertEqual(len(error_files), 1)


if __name__ == "__main__":
    unittest.main()
