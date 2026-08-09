import json
from pathlib import Path

from pypdf import PdfReader, PdfWriter

from pdf_to_form.acroforms import extract_acroforms_by_page
from pdf_to_form.export import canonicalize_acroform_names
from pdf_to_form.upload_acroforms import synchronize_pdf_acroforms


def write_blank_pdf(path: Path, pages: int = 2) -> None:
    writer = PdfWriter()
    writer.pdf_header = "%PDF-1.7"
    for _ in range(pages):
        writer.add_blank_page(width=595, height=842)
    with path.open("wb") as output:
        writer.write(output)
    writer.close()


def write_simple_json(path: Path, pages: list[dict]) -> None:
    path.write_text(json.dumps({"pages": pages}), encoding="utf-8")


def test_duplicate_names_reuse_stable_miniprogram_ids():
    forms = [
        {"name": "Estado", "field_type": "/Btn", "rect": [10.0, 20.0, 20.0, 30.0]},
        {"name": "Estado", "field_type": "/Btn", "rect": [30.0, 20.0, 40.0, 30.0]},
    ]
    payload = {
        "pages": [
            {
                "page": 1,
                "acroforms": [dict(form) for form in forms],
                "leaf_nodes": [
                    {
                        "page": 1,
                        "leaf_id": "p001_l0001",
                        "acroforms": [dict(form) for form in forms],
                    }
                ],
            }
        ]
    }

    assert canonicalize_acroform_names(payload) == 2

    expected_names = ["acroform_1kcbvj1", "acroform_g4ha1"]
    assert [form["name"] for form in payload["pages"][0]["acroforms"]] == expected_names
    assert [
        form["name"] for form in payload["pages"][0]["leaf_nodes"][0]["acroforms"]
    ] == expected_names
    assert canonicalize_acroform_names(payload) == 0


def test_rebuilds_pdf_widgets_from_page_acroform_inventory(tmp_path):
    pdf_path = tmp_path / "form.pdf"
    json_path = tmp_path / "form.parsed.simple.json"
    write_blank_pdf(pdf_path)
    write_simple_json(
        json_path,
        [
            {
                "page": 1,
                "acroforms": [
                    {
                        "name": "given_name",
                        "field_type": "/Tx",
                        "value": "",
                        "default_value": "",
                        "quadding": 1,
                        "rect": [10.25, 20.5, 110.75, 40.5],
                    },
                    {
                        "name": "accept_terms",
                        "field_type": "/Btn",
                        "value": "/Off",
                        "appearance_state": "/Off",
                        "rect": [120, 20, 130, 30],
                    },
                ],
            },
            {
                "page": 2,
                "acroforms": [
                    {
                        "name": "signature",
                        "field_type": "/Sig",
                        "rect": [15, 25, 200, 65],
                    }
                ],
            },
        ],
    )

    result = synchronize_pdf_acroforms(pdf_path, json_path)

    assert result["adjusted"] is True
    assert result["before"] == 0
    assert result["expected"] == result["after"] == 3
    assert result["after_by_page"] == {1: 2, 2: 1}
    reader = PdfReader(pdf_path)
    assert reader.pdf_header == "%PDF-1.7"
    reader.close()
    forms = extract_acroforms_by_page(str(pdf_path))
    assert {form["name"] for form in forms[1]} == {"given_name", "accept_terms"}
    assert forms[2][0]["name"] == "signature"
    assert next(form for form in forms[1] if form["name"] == "given_name")["rect"] == [
        10.25,
        20.5,
        110.75,
        40.5,
    ]
    reader = PdfReader(pdf_path)
    signature_widget = next(
        annotation.get_object()
        for annotation in reader.pages[1]["/Annots"]
        if annotation.get_object().get("/T") == "signature"
    )
    assert int(signature_widget["/F"]) == 2
    reader.close()


def test_removes_widgets_when_json_inventory_is_empty(tmp_path):
    pdf_path = tmp_path / "form.pdf"
    populated_json_path = tmp_path / "populated.parsed.simple.json"
    empty_json_path = tmp_path / "empty.parsed.simple.json"
    write_blank_pdf(pdf_path, pages=1)
    write_simple_json(
        populated_json_path,
        [
            {
                "page": 1,
                "acroforms": [
                    {
                        "name": "remove_me",
                        "field_type": "/Tx",
                        "rect": [10, 20, 30, 40],
                        "acroform_source": "commonforms",
                    }
                ],
            }
        ],
    )
    synchronize_pdf_acroforms(pdf_path, populated_json_path)
    write_simple_json(empty_json_path, [{"page": 1, "acroforms": []}])

    result = synchronize_pdf_acroforms(pdf_path, empty_json_path)

    assert result["adjusted"] is True
    assert result["before"] == 1
    assert result["after"] == 0
    assert extract_acroforms_by_page(str(pdf_path)) == {}


def test_removes_original_widget_missing_from_json_inventory(tmp_path):
    pdf_path = tmp_path / "form.pdf"
    populated_json_path = tmp_path / "populated.parsed.simple.json"
    empty_json_path = tmp_path / "empty.parsed.simple.json"
    write_blank_pdf(pdf_path, pages=1)
    write_simple_json(
        populated_json_path,
        [
            {
                "page": 1,
                "acroforms": [
                    {
                        "name": "native",
                        "field_type": "/Tx",
                        "rect": [10, 20, 30, 40],
                        "acroform_source": "original",
                    }
                ],
            }
        ],
    )
    synchronize_pdf_acroforms(pdf_path, populated_json_path)
    write_simple_json(empty_json_path, [{"page": 1, "acroforms": []}])

    result = synchronize_pdf_acroforms(pdf_path, empty_json_path)

    assert result["adjusted"] is True
    assert result["removed_existing_fields"] == 1
    assert extract_acroforms_by_page(str(pdf_path)) == {}


def test_rebuilds_when_count_matches_but_field_identity_differs(tmp_path):
    pdf_path = tmp_path / "form.pdf"
    old_json_path = tmp_path / "old.parsed.simple.json"
    new_json_path = tmp_path / "new.parsed.simple.json"
    write_blank_pdf(pdf_path, pages=1)
    write_simple_json(
        old_json_path,
        [{"page": 1, "acroforms": [{"name": "old_name", "field_type": "/Tx", "rect": [10, 20, 30, 40]}]}],
    )
    write_simple_json(
        new_json_path,
        [{"page": 1, "acroforms": [{"name": "json_name", "field_type": "/Tx", "rect": [10, 20, 30, 40]}]}],
    )
    synchronize_pdf_acroforms(pdf_path, old_json_path)

    result = synchronize_pdf_acroforms(pdf_path, new_json_path)

    assert result["adjusted"] is True
    forms = extract_acroforms_by_page(str(pdf_path))
    assert [form["name"] for form in forms[1]] == ["json_name"]


def test_does_not_rewrite_pdf_when_counts_already_match(tmp_path):
    pdf_path = tmp_path / "form.pdf"
    json_path = tmp_path / "form.parsed.simple.json"
    write_blank_pdf(pdf_path, pages=1)
    write_simple_json(json_path, [{"page": 1, "acroforms": []}])
    before = pdf_path.read_bytes()

    result = synchronize_pdf_acroforms(pdf_path, json_path)

    assert result["adjusted"] is False
    assert pdf_path.read_bytes() == before


def test_rebuild_preserves_choice_field_options_and_selection_details(tmp_path):
    pdf_path = tmp_path / "choice.pdf"
    json_path = tmp_path / "choice.parsed.simple.json"
    write_blank_pdf(pdf_path, pages=1)
    write_simple_json(
        json_path,
        [
            {
                "page": 1,
                "acroforms": [
                    {
                        "name": "countries",
                        "field_type": "/Ch",
                        "field_flags": 1 << 21,
                        "value": ["CN", "JP"],
                        "default_value": "CN",
                        "selected_indices": [0, 2],
                        "top_index": 1,
                        "options": [
                            {
                                "index": 0,
                                "export_value": "CN",
                                "display_value": "中国",
                                "is_export_display_pair": True,
                            },
                            {
                                "index": 1,
                                "export_value": "US",
                                "display_value": "美国",
                                "is_export_display_pair": True,
                            },
                            {
                                "index": 2,
                                "export_value": "JP",
                                "display_value": "JP",
                                "is_export_display_pair": False,
                            },
                        ],
                        "rect": [20, 30, 220, 80],
                        "acroform_source": "commonforms",
                    }
                ],
            }
        ],
    )

    result = synchronize_pdf_acroforms(pdf_path, json_path)

    assert result["adjusted"] is True
    rebuilt = extract_acroforms_by_page(str(pdf_path))[1][0]
    assert rebuilt["field_type"] == "/Ch"
    assert rebuilt["rect"] == [20.0, 30.0, 220.0, 80.0]
    assert rebuilt["field_flags"] == 1 << 21
    assert rebuilt["choice_properties"]["multi_select"] is True
    assert rebuilt["selected_indices"] == [0, 2]
    assert rebuilt["top_index"] == 1
    assert rebuilt["options"] == [
        {
            "index": 0,
            "export_value": "CN",
            "display_value": "中国",
            "is_export_display_pair": True,
        },
        {
            "index": 1,
            "export_value": "US",
            "display_value": "美国",
            "is_export_display_pair": True,
        },
        {
            "index": 2,
            "export_value": "JP",
            "display_value": "JP",
            "is_export_display_pair": False,
        },
    ]


def test_rebuild_preserves_merged_native_and_algorithm_provenance(tmp_path):
    pdf_path = tmp_path / "merged.pdf"
    json_path = tmp_path / "merged.parsed.simple.json"
    write_blank_pdf(pdf_path, pages=1)
    write_simple_json(
        json_path,
        [
            {
                "page": 1,
                "acroforms": [
                    {
                        "name": "textbox_0_0",
                        "field_type": "/Ch",
                        "rect": [20, 30, 220, 80],
                        "acroform_source": "merged",
                        "native_acroform_name": "native_country",
                        "algorithm_acroform_name": "textbox_0_0",
                        "algorithm_field_type": "TextBox",
                        "options": [
                            {
                                "index": 0,
                                "export_value": "JP",
                                "display_value": "日本",
                                "is_export_display_pair": True,
                            }
                        ],
                    }
                ],
            }
        ],
    )

    synchronize_pdf_acroforms(pdf_path, json_path)

    rebuilt = extract_acroforms_by_page(str(pdf_path))[1][0]
    assert rebuilt["name"] == "textbox_0_0"
    assert rebuilt["field_type"] == "/Ch"
    assert rebuilt["rect"] == [20.0, 30.0, 220.0, 80.0]
    assert rebuilt["acroform_source"] == "merged"
    assert rebuilt["native_acroform_name"] == "native_country"
    assert rebuilt["algorithm_acroform_name"] == "textbox_0_0"
    assert rebuilt["algorithm_field_type"] == "TextBox"
    assert rebuilt["options"][0]["display_value"] == "日本"
