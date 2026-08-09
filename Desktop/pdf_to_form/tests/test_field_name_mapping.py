import unittest

from pdf_to_form.fields import (
    assign_field_names_to_leaf_acroforms,
    find_unresolved_required_acroforms,
)


class FieldNameMappingTests(unittest.TestCase):
    def test_applicant_name_examples_use_biao_xiaoqian(self):
        leaf = {
            "acroforms": [
                {"name": "surname", "field_type": "/Tx", "rect": [0, 20, 10, 30]},
                {"name": "given_name", "field_type": "/Tx", "rect": [0, 10, 10, 20]},
            ],
            "llm_ocr_fields": [
                {"field_name": "姓", "input_type": "普通文本"},
                {"field_name": "名", "input_type": "普通文本"},
            ],
        }

        assign_field_names_to_leaf_acroforms(leaf, page_height=100)

        by_name = {form["name"]: form for form in leaf["acroforms"]}
        self.assertEqual(by_name["surname"]["field_example"], "表 BIAO")
        self.assertEqual(by_name["given_name"]["field_example"], "小签 XIAOQIAN")

    def test_name_example_overrides_preserve_japan_examples(self):
        leaf = {
            "acroforms": [
                {"name": "surname", "field_type": "/Tx", "rect": [0, 0, 10, 10]},
            ],
            "llm_ocr_fields": [{"field_name": "姓", "input_type": "普通文本"}],
        }

        assign_field_names_to_leaf_acroforms(
            leaf,
            page_height=100,
            field_example_overrides={"姓": "刘 LIU"},
        )

        self.assertEqual(leaf["acroforms"][0]["field_example"], "刘 LIU")

    def test_text_options_are_assigned_by_reading_order(self):
        leaf = {
            "acroforms": [
                {"name": "button_female", "field_type": "/Btn", "rect": [0, 10, 5, 15]},
                {"name": "button_male", "field_type": "/Btn", "rect": [0, 20, 5, 25]},
            ],
            "llm_ocr_fields": [
                {"field_name": "女", "input_type": "单选"},
                {"field_name": "男", "input_type": "单选"},
            ],
        }

        assign_field_names_to_leaf_acroforms(leaf, page_height=100)

        by_name = {form["name"]: form for form in leaf["acroforms"]}
        self.assertEqual(by_name["button_male"]["field_name"], "男")
        self.assertEqual(by_name["button_female"]["field_name"], "女")
        self.assertEqual(by_name["button_male"]["field_name_source"], "llm")

    def test_blank_manual_field_name_does_not_override_llm(self):
        leaf = {
            "acroforms": [
                {
                    "name": "manual_textbox",
                    "manual": True,
                    "field_name": "",
                    "input_type": "",
                    "field_type": "/Tx",
                    "rect": [0, 0, 10, 10],
                }
            ],
            "llm_ocr_fields": [
                {
                    "field_name": "其他说明",
                    "input_type": "普通文本",
                }
            ],
        }

        assign_field_names_to_leaf_acroforms(leaf, page_height=100)

        form = leaf["acroforms"][0]
        self.assertEqual(form["field_name"], "其他说明")
        self.assertEqual(form["input_type"], "普通文本")
        self.assertEqual(form["field_name_source"], "llm")

    def test_remaining_acroforms_keep_default_values_when_llm_list_is_shorter(self):
        leaf = {
            "acroforms": [
                {"name": "first", "field_type": "/Tx", "rect": [0, 20, 10, 30]},
                {
                    "name": "second",
                    "field_name": "默认字段",
                    "input_type": "普通文本",
                    "field_type": "/Tx",
                    "rect": [0, 10, 10, 20],
                },
            ],
            "llm_ocr_fields": [
                {"field_name": "模型字段", "input_type": "普通文本"},
            ],
        }

        assign_field_names_to_leaf_acroforms(leaf, page_height=100)

        by_name = {form["name"]: form for form in leaf["acroforms"]}
        self.assertEqual(by_name["first"]["field_name"], "模型字段")
        self.assertEqual(by_name["first"]["field_name_source"], "llm")
        self.assertEqual(by_name["second"]["field_name"], "默认字段")
        self.assertEqual(by_name["second"]["field_name_source"], "fallback")

    def test_explicit_manual_field_name_has_priority(self):
        leaf = {
            "acroforms": [
                {
                    "name": "manual_textbox",
                    "field_name": "人工字段",
                    "field_name_source": "manual",
                    "field_type": "/Tx",
                    "rect": [0, 0, 10, 10],
                }
            ],
            "llm_ocr_fields": [
                {
                    "field_name": "模型字段",
                    "input_type": "普通文本",
                }
            ],
        }

        assign_field_names_to_leaf_acroforms(leaf, page_height=100)

        self.assertEqual(leaf["acroforms"][0]["field_name"], "人工字段")
        self.assertEqual(leaf["acroforms"][0]["field_name_source"], "manual")

    def test_unresolved_validation_ignores_non_fillable_leaf(self):
        pages = [
            {
                "page": 1,
                "leaf_nodes": [
                    {
                        "leaf_id": "required",
                        "acroforms": [{"name": "missing", "field_name_source": "fallback"}],
                    },
                    {
                        "leaf_id": "official",
                        "is_need_filled": False,
                        "acroforms": [{"name": "ignored", "field_name_source": "fallback"}],
                    },
                ],
            }
        ]

        unresolved = find_unresolved_required_acroforms(pages)

        self.assertEqual([item["acroform_name"] for item in unresolved], ["missing"])


if __name__ == "__main__":
    unittest.main()
