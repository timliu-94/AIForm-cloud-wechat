from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Any

from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    ArrayObject,
    BooleanObject,
    DictionaryObject,
    FloatObject,
    NameObject,
    NumberObject,
    TextStringObject,
)

from .acroforms import extract_acroforms_by_page, resolve_pdf_obj
from .export import canonicalize_acroform_names


def _load_expected_acroforms(simple_json_path: Path) -> dict[int, list[dict]]:
    """Load the canonical, page-level AcroForm inventory from simple JSON."""
    payload = json.loads(simple_json_path.read_text(encoding="utf-8"))
    renamed = canonicalize_acroform_names(payload)
    if renamed:
        with tempfile.NamedTemporaryFile(
            prefix=f".{simple_json_path.stem}.",
            suffix=".json",
            dir=simple_json_path.parent,
            mode="w",
            encoding="utf-8",
            delete=False,
        ) as temporary_file:
            temporary_json_path = Path(temporary_file.name)
            json.dump(payload, temporary_file, ensure_ascii=False, indent=2)
        temporary_json_path.replace(simple_json_path)
    pages = payload.get("pages")
    if not isinstance(pages, list):
        raise ValueError(f"parsed simple JSON is missing a pages list: {simple_json_path}")

    forms_by_page: dict[int, list[dict]] = {}
    for page in pages:
        if not isinstance(page, dict) or "page" not in page:
            raise ValueError(f"parsed simple JSON contains an invalid page: {simple_json_path}")
        page_number = int(page["page"])
        if page_number < 1 or page_number in forms_by_page:
            raise ValueError(
                f"parsed simple JSON contains an invalid or duplicate page {page_number}: "
                f"{simple_json_path}"
            )
        forms = page.get("acroforms")
        if not isinstance(forms, list):
            raise ValueError(
                f"parsed simple JSON page {page_number} is missing an acroforms list: "
                f"{simple_json_path}"
            )
        for form in forms:
            if not isinstance(form, dict):
                raise ValueError(
                    f"parsed simple JSON page {page_number} contains a non-object AcroForm: "
                    f"{simple_json_path}"
                )
            rect = form.get("rect")
            if not isinstance(rect, list) or len(rect) != 4:
                raise ValueError(
                    f"AcroForm {form.get('name', '')!r} on page {page_number} has an invalid rect: "
                    f"{simple_json_path}"
                )
            try:
                [float(value) for value in rect]
            except (TypeError, ValueError) as exc:
                raise ValueError(
                    f"AcroForm {form.get('name', '')!r} on page {page_number} has a non-numeric rect: "
                    f"{simple_json_path}"
                ) from exc
        forms_by_page[page_number] = forms
    return forms_by_page


def _counts(forms_by_page: dict[int, list[dict]], page_count: int) -> dict[int, int]:
    return {page_number: len(forms_by_page.get(page_number, [])) for page_number in range(1, page_count + 1)}


def _pdf_name(value: Any, default: str) -> NameObject:
    text = str(value) if value not in (None, "") else default
    return NameObject(text if text.startswith("/") else f"/{text}")


def _field_value(value: Any, field_type: str):
    if value is None:
        return None
    if field_type == "/Btn":
        return _pdf_name(value, "/Off")
    if isinstance(value, bool):
        return BooleanObject(value)
    if isinstance(value, int):
        return NumberObject(value)
    if isinstance(value, float):
        return FloatObject(value)
    if isinstance(value, list):
        return ArrayObject(
            [converted for item in value if (converted := _field_value(item, field_type)) is not None]
        )
    return TextStringObject(str(value))


def _choice_options_value(options: Any) -> ArrayObject:
    pdf_options = ArrayObject()
    for option in options or []:
        if isinstance(option, dict):
            export_value = option.get("export_value", "")
            display_value = option.get("display_value", export_value)
            if option.get("is_export_display_pair") or display_value != export_value:
                pdf_options.append(
                    ArrayObject(
                        [TextStringObject(str(export_value)), TextStringObject(str(display_value))]
                    )
                )
            else:
                pdf_options.append(TextStringObject(str(export_value)))
        else:
            pdf_options.append(TextStringObject(str(option)))
    return pdf_options


def _widget_from_json(form: dict, page_number: int, form_index: int) -> DictionaryObject:
    field_type = str(form.get("field_type") or "/Tx")
    if field_type not in {"/Tx", "/Btn", "/Sig", "/Ch"}:
        raise ValueError(
            f"unsupported AcroForm field_type {field_type!r} on page {page_number}"
        )

    rect = [float(value) for value in form["rect"]]
    x0, y0, x1, y1 = rect
    widget = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Annot"),
            NameObject("/Subtype"): NameObject("/Widget"),
            NameObject("/FT"): NameObject(field_type),
            NameObject("/T"): TextStringObject(
                str(form.get("name") or f"field_{page_number}_{form_index}")
            ),
            NameObject("/Rect"): ArrayObject(
                [
                    FloatObject(min(x0, x1)),
                    FloatObject(min(y0, y1)),
                    FloatObject(max(x0, x1)),
                    FloatObject(max(y0, y1)),
                ]
            ),
            # PDF viewers draw a default red "SIGN" badge for appearance-less
            # signature widgets. Signature fields are hand-written in this
            # workflow, so keep the semantic field but hide its annotation from
            # both screen rendering and printing. Other widgets remain printable.
            NameObject("/F"): NumberObject(2 if field_type == "/Sig" else 4),
        }
    )
    source_value = {
        "original": "/Original",
        "commonforms": "/Detected",
        "manual": "/Manual",
        "merged": "/Merged",
    }.get(form.get("acroform_source"))
    if source_value:
        widget[NameObject("/CommonFormsSource")] = NameObject(source_value)
    if form.get("native_acroform_name") is not None:
        widget[NameObject("/CommonFormsOriginalName")] = TextStringObject(
            str(form.get("native_acroform_name") or "")
        )
    if form.get("algorithm_acroform_name") is not None:
        widget[NameObject("/CommonFormsDetectedName")] = TextStringObject(
            str(form.get("algorithm_acroform_name") or "")
        )
    if form.get("algorithm_field_type") is not None:
        widget[NameObject("/CommonFormsDetectedType")] = TextStringObject(
            str(form.get("algorithm_field_type") or "")
        )

    for json_key, pdf_key in (("value", "/V"), ("default_value", "/DV")):
        converted = _field_value(form.get(json_key), field_type)
        if converted is not None:
            widget[NameObject(pdf_key)] = converted

    field_flags = form.get("field_flags")
    if isinstance(field_flags, int):
        widget[NameObject("/Ff")] = NumberObject(field_flags)

    if field_type == "/Btn":
        widget[NameObject("/V")] = _field_value(form.get("value") or "/Off", field_type)
        widget[NameObject("/AS")] = _field_value(
            form.get("appearance_state") or form.get("value") or "/Off", field_type
        )
    elif field_type == "/Tx":
        widget.setdefault(NameObject("/V"), TextStringObject(""))
        widget.setdefault(NameObject("/DV"), TextStringObject(""))
        default_appearance = form.get("default_appearance") or "/Helv 10.5 Tf 0 0 0 rg"
        widget[NameObject("/DA")] = TextStringObject(str(default_appearance))
    elif field_type == "/Ch":
        widget[NameObject("/Opt")] = _choice_options_value(form.get("options"))
        selected_indices = form.get("selected_indices")
        if isinstance(selected_indices, list) and selected_indices:
            widget[NameObject("/I")] = ArrayObject(
                [NumberObject(int(index)) for index in selected_indices]
            )
        top_index = form.get("top_index")
        if isinstance(top_index, int):
            widget[NameObject("/TI")] = NumberObject(top_index)

    quadding = form.get("quadding")
    if isinstance(quadding, int) and quadding in (0, 1, 2):
        widget[NameObject("/Q")] = NumberObject(quadding)
    return widget


def _remove_existing_form_layer(writer: PdfWriter) -> None:
    """Remove every old Widget/XFA field while preserving page content.

    The final parsed JSON is the canonical AcroForm inventory. Keeping native
    fields here would leave two independent naming systems in the output PDF,
    especially for XFA-derived forms such as the Japanese visa application.
    """
    for page in writer.pages:
        annotations = page.get("/Annots", []) or []
        retained = ArrayObject()
        for annotation_ref in annotations:
            annotation = resolve_pdf_obj(annotation_ref)
            if annotation.get("/Subtype") != "/Widget":
                retained.append(annotation_ref)
        if retained:
            page[NameObject("/Annots")] = retained
        elif "/Annots" in page:
            del page["/Annots"]

    acroform = resolve_pdf_obj(writer.root_object.get("/AcroForm"))
    if acroform:
        acroform[NameObject("/Fields")] = ArrayObject()
        acroform[NameObject("/NeedAppearances")] = BooleanObject(False)
        if "/XFA" in acroform:
            del acroform["/XFA"]


def _form_identity(page_number: int, form: dict) -> tuple:
    return (
        page_number,
        str(form.get("name", "")),
        str(form.get("field_type", "")),
        tuple(round(float(value), 4) for value in form.get("rect", [])),
    )


def _rebuild_pdf_acroforms(
    source_pdf_path: Path,
    output_pdf_path: Path,
    forms_by_page: dict[int, list[dict]],
) -> None:
    reader = PdfReader(source_pdf_path)
    writer = PdfWriter(clone_from=reader)
    # ``PdfWriter`` defaults to PDF 1.3 even when cloning a newer document.
    # Preserve the source version so rebuilding only changes the form layer
    # and cannot silently downgrade page-content/printing capabilities.
    writer.pdf_header = reader.pdf_header
    try:
        if any(page_number > len(writer.pages) for page_number in forms_by_page):
            invalid_page = min(
                page_number for page_number in forms_by_page if page_number > len(writer.pages)
            )
            raise ValueError(
                f"parsed simple JSON references page {invalid_page}, but PDF has {len(writer.pages)} pages"
            )

        _remove_existing_form_layer(writer)
        for page_number, forms in sorted(forms_by_page.items()):
            for form_index, form in enumerate(forms, start=1):
                writer.add_annotation(
                    page_number=page_number - 1,
                    annotation=_widget_from_json(form, page_number, form_index),
                )
        writer.reattach_fields()

        with tempfile.NamedTemporaryFile(
            prefix=f".{output_pdf_path.stem}.",
            suffix=".pdf",
            dir=output_pdf_path.parent,
            delete=False,
        ) as temporary_file:
            temporary_path = Path(temporary_file.name)
            writer.write(temporary_file)
        temporary_path.replace(output_pdf_path)
    finally:
        writer.close()
        reader.close()
        if "temporary_path" in locals():
            temporary_path.unlink(missing_ok=True)


def _validate_unique_field_names(forms_by_page: dict[int, list[dict]], simple_json_path: Path) -> None:
    names: dict[str, list[int]] = {}
    for page_number, forms in forms_by_page.items():
        for form in forms:
            name = str(form.get("name") or "")
            if not name:
                raise ValueError(
                    f"parsed simple JSON contains an unnamed AcroForm on page {page_number}: "
                    f"{simple_json_path}"
                )
            names.setdefault(name, []).append(page_number)
    duplicates = {name: pages for name, pages in names.items() if len(pages) > 1}
    if duplicates:
        sample = ", ".join(
            f"{name} (pages {pages})" for name, pages in list(duplicates.items())[:5]
        )
        raise ValueError(
            f"parsed simple JSON contains duplicate AcroForm names: {sample}: {simple_json_path}"
        )


def _inventory(forms_by_page: dict[int, list[dict]]) -> list[tuple]:
    return sorted(
        _form_identity(page_number, form)
        for page_number, forms in forms_by_page.items()
        for form in forms
    )


def rebuild_pdf_acroforms(
    source_pdf_path: Path,
    output_pdf_path: Path,
    simple_json_path: Path,
) -> dict:
    """Build a canonical AcroForm layer on top of the source PDF pages."""
    source_pdf_path = Path(source_pdf_path)
    output_pdf_path = Path(output_pdf_path)
    simple_json_path = Path(simple_json_path)
    expected_by_page = _load_expected_acroforms(simple_json_path)
    _validate_unique_field_names(expected_by_page, simple_json_path)

    reader = PdfReader(source_pdf_path)
    try:
        page_count = len(reader.pages)
    finally:
        reader.close()
    if any(page_number > page_count for page_number in expected_by_page):
        invalid_page = min(page_number for page_number in expected_by_page if page_number > page_count)
        raise ValueError(
            f"parsed simple JSON references page {invalid_page}, but PDF has {page_count} pages: "
            f"{simple_json_path}"
        )

    before_by_page = extract_acroforms_by_page(str(source_pdf_path))
    before_counts = _counts(before_by_page, page_count)
    expected_counts = _counts(expected_by_page, page_count)
    output_pdf_path.parent.mkdir(parents=True, exist_ok=True)
    _rebuild_pdf_acroforms(source_pdf_path, output_pdf_path, expected_by_page)

    verified_by_page = extract_acroforms_by_page(str(output_pdf_path))
    after_counts = _counts(verified_by_page, page_count)
    if _inventory(verified_by_page) != _inventory(expected_by_page):
        raise RuntimeError(
            f"AcroForm synchronization verification failed: pdf={output_pdf_path}, "
            f"expected={_inventory(expected_by_page)}, actual={_inventory(verified_by_page)}"
        )

    return {
        "pdf": str(output_pdf_path),
        "source_pdf": str(source_pdf_path),
        "adjusted": _inventory(before_by_page) != _inventory(expected_by_page)
        or source_pdf_path.resolve() != output_pdf_path.resolve(),
        "before": sum(before_counts.values()),
        "expected": sum(expected_counts.values()),
        "after": sum(after_counts.values()),
        "before_by_page": before_counts,
        "expected_by_page": expected_counts,
        "after_by_page": after_counts,
        "removed_existing_fields": sum(before_counts.values()),
    }


def synchronize_pdf_acroforms(pdf_path: Path, simple_json_path: Path) -> dict:
    """Replace a PDF's form layer with the canonical parsed.simple.json inventory."""
    pdf_path = Path(pdf_path)
    simple_json_path = Path(simple_json_path)
    expected_by_page = _load_expected_acroforms(simple_json_path)
    _validate_unique_field_names(expected_by_page, simple_json_path)
    actual_by_page = extract_acroforms_by_page(str(pdf_path))
    reader = PdfReader(pdf_path)
    try:
        page_count = len(reader.pages)
        acroform = resolve_pdf_obj(reader.trailer["/Root"].get("/AcroForm"))
        has_xfa = bool(acroform and acroform.get("/XFA") is not None)
    finally:
        reader.close()

    if _inventory(actual_by_page) == _inventory(expected_by_page) and not has_xfa:
        counts = _counts(actual_by_page, page_count)
        return {
            "pdf": str(pdf_path),
            "source_pdf": str(pdf_path),
            "adjusted": False,
            "before": sum(counts.values()),
            "expected": sum(counts.values()),
            "after": sum(counts.values()),
            "before_by_page": counts,
            "expected_by_page": counts,
            "after_by_page": counts,
            "removed_existing_fields": 0,
        }
    return rebuild_pdf_acroforms(pdf_path, pdf_path, simple_json_path)
