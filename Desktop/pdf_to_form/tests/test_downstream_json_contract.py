import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from main import load_acroform_annotations
from pdf_convert_to_png import load_acroforms_by_page
from pdf_to_form.export import save_simplified_parsed_pdf_json


class DownstreamJsonContractTests(unittest.TestCase):
    def test_simple_json_exposes_leaf_and_page_acroforms_without_trees(self):
        leaf_form = {
            "name": "textbox_0_0",
            "rect": [1, 2, 3, 4],
            "field_name": "姓",
            "field_name_source": "llm",
        }
        page_form = dict(leaf_form)
        stale_tree_form = {
            **leaf_form,
            "field_name": "textbox_0_0",
            "field_name_source": "fallback",
        }
        payload = {
            "schema_version": "1.0",
            "pages": [
                {
                    "page": 1,
                    "size": [100, 100],
                    "trees": [
                        {
                            "is_leaf": True,
                            "bbox": [0, 0, 10, 10],
                            "acroforms": [stale_tree_form],
                        }
                    ],
                    "leaf_nodes": [
                        {
                            "leaf_id": "p001_l0001",
                            "bbox": [0, 0, 10, 10],
                            "acroforms": [leaf_form],
                        }
                    ],
                    "acroforms": [page_form],
                }
            ],
        }

        with TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "form.parsed.simple.json"
            save_simplified_parsed_pdf_json(payload, output_path)
            written = json.loads(output_path.read_text(encoding="utf-8"))

            annotations = load_acroform_annotations(output_path)
            page_acroforms = load_acroforms_by_page(output_path)

        page = written["pages"][0]
        self.assertNotIn("trees", page)
        self.assertEqual(
            page["leaf_nodes"][0]["acroforms"][0]["field_name"],
            "姓",
        )
        self.assertEqual(page["acroforms"][0]["field_name"], "姓")
        self.assertEqual(annotations[1][0]["acroforms"][0]["name"], "textbox_0_0")
        self.assertEqual(page_acroforms[1][0]["field_name"], "姓")


if __name__ == "__main__":
    unittest.main()
