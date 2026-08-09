import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from pdf_to_form.manual_rules import EMPTY_MANUAL_RULES, ManualRules, apply_manual_rules_to_payload, get_manual_rules


class ManualRulesPostMergeTests(unittest.TestCase):
    def test_manual_rules_merge_page_and_leaf_acroforms(self):
        payload = {
            "summary": {},
            "pages": [
                {
                    "page": 1,
                    "n_acroforms": 1,
                    "acroforms": [
                        {
                            "name": "remove-me",
                            "rect": [0, 0, 1, 1],
                            "acroform_source": "commonforms",
                        }
                    ],
                    "leaf_nodes": [
                        {
                            "leaf_id": "p001_l0001",
                            "bbox": [0, 0, 100, 100],
                            "acroforms": [
                                {
                                    "name": "remove-me",
                                    "rect": [0, 0, 1, 1],
                                    "acroform_source": "commonforms",
                                }
                            ],
                        }
                    ],
                }
            ],
        }
        rules = ManualRules(
            acroforms=(
                {"page": 1, "name": "add-me", "rect": [10, 10, 20, 20], "leaf_id": "p001_l0001"},
            ),
            acroform_removals=({"page": 1, "name": "remove-me"},),
            leaves_not_need_filled=frozenset({"p001_l0001"}),
        )

        summary = apply_manual_rules_to_payload(payload, rules)

        self.assertEqual(summary, {"removed": 2, "injected": 1, "unmatched": 0})
        page = payload["pages"][0]
        self.assertEqual([form["name"] for form in page["acroforms"]], ["manual_add-me"])
        leaf = page["leaf_nodes"][0]
        self.assertFalse(leaf["is_need_filled"])
        self.assertFalse(leaf["acroforms"][0]["is_acro_need_filled"])
        self.assertNotIn("field_name", leaf["acroforms"][0])

    def test_manual_field_is_renamed_without_removing_native_name_collision(self):
        payload = {
            "summary": {},
            "pages": [
                {
                    "page": 1,
                    "acroforms": [{"name": "shared", "rect": [40, 40, 50, 50]}],
                    "leaf_nodes": [
                        {"leaf_id": "p001_l0001", "bbox": [0, 0, 100, 100], "acroforms": [{"name": "shared", "rect": [40, 40, 50, 50]}]}
                    ],
                }
            ],
        }

        summary = apply_manual_rules_to_payload(
            payload,
            ManualRules(acroforms=({"page": 1, "name": "shared", "rect": [10, 10, 20, 20], "leaf_id": "p001_l0001"},)),
        )

        self.assertEqual(summary, {"removed": 0, "injected": 1, "unmatched": 0})
        self.assertEqual([form["name"] for form in payload["pages"][0]["acroforms"]], ["shared", "manual_shared"])

    def test_manual_removal_cannot_delete_original_acroform(self):
        native = {
            "name": "native",
            "rect": [10, 10, 20, 20],
            "acroform_source": "original",
        }
        payload = {
            "summary": {},
            "pages": [
                {
                    "page": 1,
                    "acroforms": [dict(native)],
                    "leaf_nodes": [
                        {
                            "leaf_id": "p001_l0001",
                            "bbox": [0, 0, 100, 100],
                            "acroforms": [dict(native)],
                        }
                    ],
                }
            ],
        }

        summary = apply_manual_rules_to_payload(
            payload,
            ManualRules(acroform_removals=({"page": 1, "name": "native"},)),
        )

        self.assertEqual(summary["removed"], 0)
        self.assertEqual(payload["pages"][0]["acroforms"], [native])
        leaf_native = payload["pages"][0]["leaf_nodes"][0]["acroforms"]
        self.assertEqual(len(leaf_native), 1)
        self.assertEqual(leaf_native[0]["name"], "native")
        self.assertEqual(leaf_native[0]["acroform_source"], "original")

    def test_manual_field_with_wrong_leaf_id_is_not_injected(self):
        payload = {
            "summary": {},
            "pages": [
                {
                    "page": 1,
                    "acroforms": [],
                    "leaf_nodes": [
                        {"leaf_id": "p001_l0001", "bbox": [0, 0, 100, 100], "acroforms": []},
                        {"leaf_id": "p001_l0002", "bbox": [100, 0, 200, 100], "acroforms": []},
                    ],
                }
            ],
        }

        summary = apply_manual_rules_to_payload(
            payload,
            ManualRules(acroforms=({"page": 1, "name": "bad-leaf", "rect": [120, 10, 130, 20], "leaf_id": "p001_l0001"},)),
        )

        self.assertEqual(summary, {"removed": 0, "injected": 0, "unmatched": 1})
        self.assertEqual(payload["pages"][0]["acroforms"], [])

    def test_empty_rules_leave_payload_unchanged(self):
        payload = {"summary": {}, "pages": []}
        self.assertEqual(apply_manual_rules_to_payload(payload, EMPTY_MANUAL_RULES), {"removed": 0, "injected": 0, "unmatched": 0})
        self.assertEqual(payload, {"summary": {"total_acroforms": 0}, "pages": []})

    def test_default_rules_are_loaded_from_this_pdfs_outputs_directory(self):
        with TemporaryDirectory() as temp_dir:
            version_dir = Path(temp_dir) / "Italy" / "Beijing-form"
            prepared_pdf = version_dir / "commonforms" / "Beijing-form.pdf"
            prepared_pdf.parent.mkdir(parents=True)
            prepared_pdf.touch()
            rules_path = version_dir / "outputs" / "annotated.manual_rules.json"
            rules_path.parent.mkdir()
            rules_path.write_text(
                '{"version": 1, "cities": {"Beijing": {"pdfs": {'
                '"Beijing-form.pdf": {"acroforms": []}}}}}',
                encoding="utf-8",
            )

            rules = get_manual_rules(prepared_pdf)

        self.assertEqual(rules.city, "Beijing")
        self.assertEqual(rules.pdf_filename, "Beijing-form.pdf")

    def test_per_pdf_rules_file_is_scoped_by_its_document_directory(self):
        with TemporaryDirectory() as temp_dir:
            version_dir = Path(temp_dir) / "Italy" / "Guangzhou-form"
            prepared_pdf = version_dir / "commonforms" / "Guangzhou-form.pdf"
            prepared_pdf.parent.mkdir(parents=True)
            prepared_pdf.touch()
            rules_path = version_dir / "outputs" / "annotated.manual_rules.json"
            rules_path.parent.mkdir()
            rules_path.write_text(
                '{"version": 1, "cities": {"Guangzhou": {"pdfs": {'
                '"stale-copy-name.pdf": {"acroforms": [{"page": 1, "name": "manual", '
                '"rect": [1, 2, 3, 4]}]}}}}}',
                encoding="utf-8",
            )

            rules = get_manual_rules(prepared_pdf)

        self.assertEqual(rules.city, "Guangzhou")
        self.assertEqual(rules.pdf_filename, "Guangzhou-form.pdf")
        self.assertEqual([rule["name"] for rule in rules.acroforms], ["manual"])

    def test_explicit_shared_rules_file_keeps_strict_pdf_name_matching(self):
        with TemporaryDirectory() as temp_dir:
            prepared_pdf = Path(temp_dir) / "Guangzhou-form.pdf"
            prepared_pdf.touch()
            rules_path = Path(temp_dir) / "shared.manual_rules.json"
            rules_path.write_text(
                '{"version": 1, "cities": {"Beijing": {"pdfs": {'
                '"Beijing-form.pdf": {"acroforms": [{"page": 1, "name": "wrong-pdf", '
                '"rect": [1, 2, 3, 4]}]}}}}}',
                encoding="utf-8",
            )

            rules = get_manual_rules(prepared_pdf, rules_path)

        self.assertEqual(rules, EMPTY_MANUAL_RULES)


if __name__ == "__main__":
    unittest.main()
