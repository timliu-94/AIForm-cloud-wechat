import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from pdf_to_form.manual_rules import ManualRules
from pdf_to_form.pipeline import PipelineConfig, run_cleanup_pipeline


class CleanupLLMOrderTests(unittest.TestCase):
    def test_llm_runs_after_manual_acroforms_and_before_simple_json_export(self):
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            pdf_path = root / "commonforms" / "form.pdf"
            pdf_path.parent.mkdir()
            pdf_path.touch()
            parsed_path = root / "outputs" / "form.parsed.json"
            parsed_path.parent.mkdir()
            simple_path = root / "outputs" / "form.parsed.simple.json"
            llm_dir = root / "llm_outputs" / "Italy" / "form"
            parsed_path.write_text(
                json.dumps(
                    {
                        "schema_version": "1.0",
                        "summary": {"pages": 1, "total_leaves": 1, "total_acroforms": 0},
                        "pages": [
                            {
                                "page": 1,
                                "size": [100, 100],
                                "n_acroforms": 0,
                                "trees": [],
                                "acroforms": [],
                                "leaf_nodes": [
                                    {
                                        "leaf_id": "p001_l0001",
                                        "bbox": [0, 0, 100, 100],
                                        "text": "姓",
                                        "acroforms": [],
                                    }
                                ],
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            rules = ManualRules(
                acroforms=(
                    {
                        "page": 1,
                        "name": "added",
                        "rect": [10, 10, 20, 20],
                        "leaf_id": "p001_l0001",
                    },
                )
            )

            def infer_after_manual(pages, **kwargs):
                leaf = pages[0]["leaf_nodes"][0]
                self.assertEqual([form["name"] for form in leaf["acroforms"]], ["manual_added"])
                self.assertEqual(kwargs["infer_dir"], llm_dir)
                leaf["llm_ocr_fields"] = [
                    {
                        "field_name": "姓",
                        "input_type": "普通文本",
                    }
                ]
                leaf["llm_ocr_infer"] = {"source": "test"}
                return {"leaves_with_fields": 1}

            config = PipelineConfig(
                pdf_path=pdf_path,
                output_json=parsed_path,
                output_simple_json=simple_path,
                llm_infer_dir=llm_dir,
                detect_false_positive_acroforms=False,
            )
            with (
                patch("pdf_to_form.pipeline.get_manual_rules", return_value=rules),
                patch("pdf_to_form.pipeline.add_llm_fields_to_leaves", side_effect=infer_after_manual),
            ):
                payload, summaries = run_cleanup_pipeline(config)

            simple_payload = json.loads(simple_path.read_text(encoding="utf-8"))

        leaf_form = payload["pages"][0]["leaf_nodes"][0]["acroforms"][0]
        page_form = payload["pages"][0]["acroforms"][0]
        simple_form = simple_payload["pages"][0]["leaf_nodes"][0]["acroforms"][0]
        self.assertNotIn("trees", simple_payload["pages"][0])
        self.assertEqual(leaf_form["field_name"], "姓")
        self.assertEqual(page_form["field_name"], "姓")
        self.assertEqual(simple_form["field_name"], "姓")
        self.assertEqual(
            summaries["llm"],
            {"leaves_with_fields": 1, "cache_dir": str(llm_dir)},
        )
        self.assertEqual(summaries["fields"]["llm_named"], 1)
        self.assertEqual(summaries["fields"]["fallback"], 0)
        self.assertEqual(simple_payload["summary"]["llm_cache_dir"], str(llm_dir))
        self.assertEqual(simple_payload["summary"]["field_name_sources"]["llm"], 1)


if __name__ == "__main__":
    unittest.main()
