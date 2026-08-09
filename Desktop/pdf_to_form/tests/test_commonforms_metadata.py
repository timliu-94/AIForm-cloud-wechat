import importlib.util
import json
import sys
import types
from pathlib import Path

import pdfplumber
from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    ArrayObject,
    DictionaryObject,
    FloatObject,
    IndirectObject,
    NameObject,
    NumberObject,
    TextStringObject,
)

from pdf_to_form.acroforms import extract_acroforms_by_page
from pdf_to_form.export import build_parsed_pdf_json, save_simplified_parsed_pdf_json


def load_form_creator_modules():
    package_root = Path(__file__).resolve().parents[1] / "commonforms" / "commonforms"
    module_names = ("commonforms", "commonforms.utils", "commonforms.form_creator")
    previous_modules = {name: sys.modules.get(name) for name in module_names}
    try:
        package = types.ModuleType("commonforms")
        package.__path__ = [str(package_root)]
        sys.modules["commonforms"] = package
        for name in ("utils", "form_creator"):
            module_name = f"commonforms.{name}"
            spec = importlib.util.spec_from_file_location(module_name, package_root / f"{name}.py")
            module = importlib.util.module_from_spec(spec)
            sys.modules[module_name] = module
            spec.loader.exec_module(module)
        return sys.modules["commonforms.form_creator"], sys.modules["commonforms.utils"]
    finally:
        for name, previous in previous_modules.items():
            if previous is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = previous


def test_indirect_metadata_is_materialized_before_widgets_are_added(tmp_path):
    form_creator, utils = load_form_creator_modules()
    source_path = tmp_path / "indirect-metadata.pdf"
    output_path = tmp_path / "output.pdf"

    writer = PdfWriter()
    for _ in range(4):
        writer.add_blank_page(width=595, height=842)
    indirect_title = writer._add_object(TextStringObject("Indirect title"))
    writer._info.get_object()[NameObject("/Title")] = indirect_title
    with source_path.open("wb") as output:
        writer.write(output)

    creator = form_creator.PyPdfFormCreator(str(source_path))
    creator.add_checkbox(
        "checkbox",
        0,
        utils.BoundingBox(x0=0.1, y0=0.1, x1=0.2, y1=0.2),
    )
    creator.save(str(output_path))
    creator.close()

    output_reader = PdfReader(output_path)
    assert output_reader.metadata["/Title"] == "Indirect title"
    assert not isinstance(output_reader.metadata.raw_get("/Title"), IndirectObject)
    with pdfplumber.open(output_path) as output_pdf:
        assert len(output_pdf.pages) == 4


def test_source_widget_keeps_native_geometry_and_type_but_uses_algorithm_name(tmp_path):
    form_creator, utils = load_form_creator_modules()
    blank_path = tmp_path / "blank.pdf"
    source_path = tmp_path / "source-with-form.pdf"
    output_path = tmp_path / "output.pdf"

    writer = PdfWriter()
    writer.add_blank_page(width=600, height=800)
    with blank_path.open("wb") as output:
        writer.write(output)

    source_box = utils.BoundingBox(x0=0.1, y0=0.1, x1=0.4, y1=0.2)
    source_creator = form_creator.PyPdfFormCreator(str(blank_path))
    source_creator.add_text_box("native_name", 0, source_box)
    source_annotation = source_creator.writer.pages[0]["/Annots"][0].get_object()
    source_annotation[form_creator.COMMONFORMS_SOURCE_KEY] = (
        form_creator.COMMONFORMS_SOURCE_ORIGINAL
    )
    source_creator.save(str(source_path))
    source_creator.close()

    creator = form_creator.PyPdfFormCreator(str(source_path))
    assert creator.overlaps_source_widget(
        0, utils.BoundingBox(x0=0.2, y0=0.12, x1=0.5, y1=0.18)
    )
    assert not creator.overlaps_source_widget(
        0, utils.BoundingBox(x0=0.5, y0=0.3, x1=0.8, y1=0.4)
    )

    overlapping_box = utils.BoundingBox(x0=0.2, y0=0.12, x1=0.5, y1=0.18)
    assert creator.merge_detected_widget(
        "auto_overlap", 0, overlapping_box, "TextBox"
    )
    creator.add_text_box(
        "auto_distinct", 0, utils.BoundingBox(x0=0.5, y0=0.3, x1=0.8, y1=0.4)
    )
    creator.save(str(output_path))
    creator.close()

    fields = PdfReader(output_path).get_fields()
    assert set(fields) == {"auto_overlap", "auto_distinct"}
    forms = extract_acroforms_by_page(str(output_path))[1]
    assert {form["name"]: form["acroform_source"] for form in forms} == {
        "auto_overlap": "merged",
        "auto_distinct": "commonforms",
    }
    merged = next(form for form in forms if form["name"] == "auto_overlap")
    assert merged["field_type"] == "/Tx"
    assert merged["rect"] == [60.0, 640.0, 240.0, 720.0]
    assert merged["native_acroform_name"] == "native_name"
    assert merged["algorithm_acroform_name"] == "auto_overlap"
    assert merged["algorithm_field_type"] == "TextBox"
    assert merged["merge_strategy"] == {
        "field_type": "pdf_native",
        "rect": "pdf_native",
        "other_properties": "algorithm",
        "choice_details": "pdf_native",
    }


def test_native_choice_widget_wins_overlap_and_exports_option_details(tmp_path):
    form_creator, utils = load_form_creator_modules()
    source_path = tmp_path / "source-choice.pdf"
    output_path = tmp_path / "output.pdf"
    simple_json_path = tmp_path / "output.parsed.simple.json"

    writer = PdfWriter()
    writer.add_blank_page(width=600, height=800)
    native_rect = [60, 640, 240, 720]
    writer.add_annotation(
        page_number=0,
        annotation=DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Annot"),
                NameObject("/Subtype"): NameObject("/Widget"),
                NameObject("/FT"): NameObject("/Ch"),
                NameObject("/T"): TextStringObject("native_country"),
                NameObject("/Rect"): ArrayObject([FloatObject(v) for v in native_rect]),
                NameObject("/Opt"): ArrayObject(
                    [
                        ArrayObject(
                            [TextStringObject("CN"), TextStringObject("中国")]
                        ),
                        TextStringObject("日本"),
                    ]
                ),
                NameObject("/V"): TextStringObject("CN"),
                NameObject("/DV"): TextStringObject("日本"),
                NameObject("/I"): ArrayObject([NumberObject(0)]),
                NameObject("/Ff"): NumberObject(1 << 17),
                NameObject("/F"): NumberObject(4),
            }
        ),
    )
    writer.reattach_fields()
    with source_path.open("wb") as output:
        writer.write(output)
    writer.close()

    creator = form_creator.PyPdfFormCreator(str(source_path))
    overlapping_detection = utils.BoundingBox(x0=0.1, y0=0.1, x1=0.4, y1=0.2)
    assert creator.overlaps_source_widget(0, overlapping_detection)
    assert creator.merge_detected_widget(
        "detected_overlap", 0, overlapping_detection, "TextBox"
    )
    creator.add_text_box(
        "detected_distinct", 0, utils.BoundingBox(x0=0.5, y0=0.3, x1=0.8, y1=0.4)
    )
    creator.save(str(output_path))
    creator.close()

    forms = extract_acroforms_by_page(str(output_path))[1]
    native = next(form for form in forms if form["name"] == "detected_overlap")
    assert "native_country" not in {form["name"] for form in forms}
    assert native["acroform_source"] == "merged"
    assert native["native_acroform_name"] == "native_country"
    assert native["algorithm_acroform_name"] == "detected_overlap"
    assert native["algorithm_field_type"] == "TextBox"
    assert native["field_type"] == "/Ch"
    assert native["rect"] == native_rect
    assert native["value"] == "CN"
    assert native["default_value"] == "日本"
    assert native["selected_indices"] == [0]
    assert native["choice_properties"]["combo"] is True
    assert native["options"] == [
        {
            "index": 0,
            "export_value": "CN",
            "display_value": "中国",
            "is_export_display_pair": True,
        },
        {
            "index": 1,
            "export_value": "日本",
            "display_value": "日本",
            "is_export_display_pair": False,
        },
    ]

    payload = build_parsed_pdf_json(
        output_path,
        [{"page": 1, "size": [600, 800], "n_frames": 0, "trees": []}],
    )
    save_simplified_parsed_pdf_json(payload, simple_json_path)
    simple_payload = json.loads(simple_json_path.read_text(encoding="utf-8"))
    simple_native = next(
        form
        for form in simple_payload["pages"][0]["acroforms"]
        if form["name"] == "detected_overlap"
    )
    assert simple_native["field_type"] == "/Ch"
    assert simple_native["rect"] == native_rect
    assert simple_native["options"] == native["options"]


def test_existing_detected_widget_keeps_provenance_and_blocks_duplicate_detection(tmp_path):
    form_creator, utils = load_form_creator_modules()
    blank_path = tmp_path / "blank.pdf"
    detected_path = tmp_path / "detected.pdf"
    output_path = tmp_path / "output.pdf"

    writer = PdfWriter()
    writer.add_blank_page(width=600, height=800)
    with blank_path.open("wb") as output:
        writer.write(output)
    writer.close()

    box = utils.BoundingBox(x0=0.1, y0=0.1, x1=0.4, y1=0.2)
    first_creator = form_creator.PyPdfFormCreator(str(blank_path))
    first_creator.add_text_box("existing_detected", 0, box)
    first_creator.save(str(detected_path))
    first_creator.close()

    second_creator = form_creator.PyPdfFormCreator(str(detected_path))
    assert second_creator.overlaps_source_widget(0, box) is True
    assert second_creator.merge_detected_widget(
        "new_detection", 0, box, "TextBox"
    ) is True
    annotation = second_creator.writer.pages[0]["/Annots"][0].get_object()
    assert str(annotation[form_creator.COMMONFORMS_SOURCE_KEY]) == "/Detected"
    assert str(annotation["/T"]) == "existing_detected"
    second_creator.save(str(output_path))
    second_creator.close()

    forms = extract_acroforms_by_page(str(output_path))[1]
    assert [(form["name"], form["acroform_source"]) for form in forms] == [
        ("existing_detected", "commonforms")
    ]


def test_same_widget_reference_is_exported_once_from_multiple_field_paths(tmp_path):
    pdf_path = tmp_path / "shared-widget.pdf"
    writer = PdfWriter()
    writer.add_blank_page(width=600, height=800)
    writer.add_annotation(
        page_number=0,
        annotation=DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Annot"),
                NameObject("/Subtype"): NameObject("/Widget"),
                NameObject("/FT"): NameObject("/Ch"),
                NameObject("/T"): TextStringObject("country"),
                NameObject("/Rect"): ArrayObject(
                    [FloatObject(v) for v in [60, 640, 240, 720]]
                ),
                NameObject("/Opt"): ArrayObject(
                    [TextStringObject("中国"), TextStringObject("日本")]
                ),
                NameObject("/F"): NumberObject(4),
            }
        ),
    )
    writer.reattach_fields()
    widget_ref = writer.pages[0]["/Annots"][0]
    parent_ref = writer._add_object(
        DictionaryObject(
            {
                NameObject("/T"): TextStringObject("application"),
                NameObject("/Kids"): ArrayObject([widget_ref]),
            }
        )
    )
    acroform = writer.root_object["/AcroForm"].get_object()
    acroform[NameObject("/Fields")] = ArrayObject([parent_ref, widget_ref])
    with pdf_path.open("wb") as output:
        writer.write(output)
    writer.close()

    forms = extract_acroforms_by_page(str(pdf_path))[1]

    assert len(forms) == 1
    assert forms[0]["name"] == "application.country"
    assert forms[0]["field_type"] == "/Ch"
    assert [option["display_value"] for option in forms[0]["options"]] == [
        "中国",
        "日本",
    ]
