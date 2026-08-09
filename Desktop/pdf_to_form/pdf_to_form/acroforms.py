from __future__ import annotations

import re
from typing import Any

from pypdf import PdfReader

LINE_THICKNESS = 2.0
MERGE_TOL = 1.5
EXTEND_TOL = 1.5

TEXTBOX_DEFAULT_FONT_RESOURCE = "/Helv"
TEXTBOX_DEFAULT_FONT_BASE = "/Helvetica"
TEXTBOX_DEFAULT_FONT_SIZE = 10.5
TEXTBOX_DEFAULT_QUADDING = 1
TEXTBOX_DEFAULT_TEXT_COLOR_RGB = [0.0, 0.0, 0.0]
ACROFORM_SOURCE_PDF_KEY = "/CommonFormsSource"
ACROFORM_SOURCE_VALUES = {
    "/Original": "original",
    "/Detected": "commonforms",
    "/Manual": "manual",
    "/Merged": "merged",
}
ACROFORM_ORIGINAL_NAME_PDF_KEY = "/CommonFormsOriginalName"
ACROFORM_DETECTED_NAME_PDF_KEY = "/CommonFormsDetectedName"
ACROFORM_DETECTED_TYPE_PDF_KEY = "/CommonFormsDetectedType"

CHOICE_FIELD_FLAG_COMBO = 1 << 17
CHOICE_FIELD_FLAG_EDIT = 1 << 18
CHOICE_FIELD_FLAG_SORT = 1 << 19
CHOICE_FIELD_FLAG_MULTI_SELECT = 1 << 21
CHOICE_FIELD_FLAG_DO_NOT_SPELL_CHECK = 1 << 22
CHOICE_FIELD_FLAG_COMMIT_ON_SEL_CHANGE = 1 << 26


def is_protected_original_acroform(form):
    """Treat every field not proven generated/manual as PDF-native and immutable."""
    return form.get("acroform_source") not in {"commonforms", "manual"}


def ref_key(obj: Any):
    ref = getattr(obj, "indirect_reference", obj)
    if hasattr(ref, "idnum") and hasattr(ref, "generation"):
        return (ref.idnum, ref.generation)
    return None


def resolve_pdf_obj(obj: Any):
    try:
        return obj.get_object()
    except AttributeError:
        return obj


def plain_pdf_value(value: Any):
    if value is None:
        return None
    value = resolve_pdf_obj(value)
    if isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (list, tuple)):
        return [plain_pdf_value(v) for v in value]
    return str(value)


def normalize_choice_options(raw_options: Any) -> list[dict[str, Any]]:
    """Return PDF ``/Opt`` entries without losing export/display pairs."""
    raw_options = resolve_pdf_obj(raw_options)
    if not isinstance(raw_options, (list, tuple)):
        return []

    options = []
    for index, raw_option in enumerate(raw_options):
        option = resolve_pdf_obj(raw_option)
        is_pair = isinstance(option, (list, tuple))
        if is_pair:
            export_value = plain_pdf_value(option[0]) if option else ""
            display_value = plain_pdf_value(option[1]) if len(option) > 1 else export_value
        else:
            export_value = plain_pdf_value(option)
            display_value = export_value
        options.append(
            {
                "index": index,
                "export_value": export_value,
                "display_value": display_value,
                "is_export_display_pair": is_pair,
            }
        )
    return options


def choice_field_details(inherited: dict[str, Any]) -> dict[str, Any]:
    """Extract choice-specific flags and selection metadata for JSON export."""
    field_flags = int(inherited.get("/Ff") or 0)
    selected_indices = plain_pdf_value(inherited.get("/I"))
    if selected_indices is None:
        selected_indices = []
    elif not isinstance(selected_indices, list):
        selected_indices = [selected_indices]

    details = {
        "field_flags": field_flags,
        "options": normalize_choice_options(inherited.get("/Opt")),
        "selected_indices": selected_indices,
        "choice_properties": {
            "combo": bool(field_flags & CHOICE_FIELD_FLAG_COMBO),
            "editable": bool(field_flags & CHOICE_FIELD_FLAG_EDIT),
            "sorted": bool(field_flags & CHOICE_FIELD_FLAG_SORT),
            "multi_select": bool(field_flags & CHOICE_FIELD_FLAG_MULTI_SELECT),
            "do_not_spell_check": bool(field_flags & CHOICE_FIELD_FLAG_DO_NOT_SPELL_CHECK),
            "commit_on_selection_change": bool(
                field_flags & CHOICE_FIELD_FLAG_COMMIT_ON_SEL_CHANGE
            ),
        },
    }
    top_index = plain_pdf_value(inherited.get("/TI"))
    if top_index is not None:
        details["top_index"] = top_index
    return details


def normalize_rect(rect):
    x0, y0, x1, y1 = [float(v) for v in rect]
    return (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))


def rects_overlap(first, second) -> bool:
    """Return whether two PDF rectangles share a positive-area region."""
    try:
        ax0, ay0, ax1, ay1 = normalize_rect(first)
        bx0, by0, bx1, by1 = normalize_rect(second)
    except (TypeError, ValueError):
        return False
    return min(ax1, bx1) > max(ax0, bx0) and min(ay1, by1) > max(ay0, by0)


def prefer_pdf_native_over_detected(forms: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Drop detected widgets that overlap a protected PDF-native widget."""
    native_forms = [form for form in forms if is_protected_original_acroform(form)]
    return [
        form
        for form in forms
        if form.get("acroform_source") != "commonforms"
        or not any(rects_overlap(form.get("rect"), native.get("rect")) for native in native_forms)
    ]


def rect_is_within_bbox(rect, bbox, tol=1.0):
    """Return whether the complete widget rectangle belongs to a leaf box."""
    try:
        rx0, ry0, rx1, ry1 = normalize_rect(rect)
        bx0, by0, bx1, by1 = normalize_rect(bbox)
    except (TypeError, ValueError):
        return False
    return bx0 - tol <= rx0 and ry0 >= by0 - tol and rx1 <= bx1 + tol and ry1 <= by1 + tol


def manual_acroform_name(source_name, forms):
    """Allocate a page-unique name for a manually added AcroForm.

    A manual prefix separates annotation corrections from native PDF fields,
    even when the annotator copied a detector-generated name.  The numeric
    suffix also makes multiple corrections with the same source name safe.
    """
    existing_names = {str(form.get("name", "")) for form in forms}
    base = source_name if str(source_name).startswith("manual_") else f"manual_{source_name}"
    name = base
    index = 2
    while name in existing_names:
        name = f"{base}_{index}"
        index += 1
    return name


def parse_default_appearance(da):
    if not da:
        return {}
    text = str(da)
    parsed = {"default_appearance": text}

    tf_matches = re.findall(r"(/\S+)\s+([-+]?\d*\.?\d+)\s+Tf\b", text)
    if tf_matches:
        font_resource, font_size = tf_matches[-1]
        font_size = float(font_size)
        parsed["font_resource"] = font_resource
        parsed["font_size"] = font_size
        parsed["font_size_auto"] = font_size == 0

    rgb_matches = re.findall(
        r"([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+rg\b",
        text,
    )
    gray_matches = re.findall(r"([-+]?\d*\.?\d+)\s+g\b", text)
    if rgb_matches:
        parsed["text_color_rgb"] = [float(v) for v in rgb_matches[-1]]
    elif gray_matches:
        gray = float(gray_matches[-1])
        parsed["text_color_rgb"] = [gray, gray, gray]
    return parsed


def font_info_from_resources(font_resource, resources):
    standard_font_aliases = {
        "/Helv": "/Helvetica",
        "/ZaDb": "/ZapfDingbats",
        "/Cour": "/Courier",
        "/TiRo": "/Times-Roman",
        "/Symb": "/Symbol",
    }
    out = {}
    if font_resource in standard_font_aliases:
        out["font_base"] = standard_font_aliases[font_resource]
        out["font_source"] = "standard_alias"
    if not font_resource or not resources:
        return out
    fonts = resolve_pdf_obj(resources.get("/Font")) if hasattr(resources, "get") else None
    if not fonts:
        return out
    font = fonts.get(font_resource)
    if font is None:
        return out
    font = resolve_pdf_obj(font)
    for src, dst in (("/BaseFont", "font_base"), ("/Subtype", "font_subtype"), ("/Encoding", "font_encoding")):
        if src in font:
            out[dst] = plain_pdf_value(font.get(src))
            out["font_source"] = "resource"
    return out


def format_default_appearance(font_resource, font_size, text_color_rgb):
    r, g, b = text_color_rgb
    return f"{font_resource} {font_size:g} Tf {r:g} {g:g} {b:g} rg"


def apply_textbox_defaults(item):
    if item.get("field_type") != "/Tx":
        return item
    item["raw_default_appearance"] = item.get("default_appearance")
    item["raw_font_size"] = item.get("font_size")
    item["raw_quadding"] = item.get("quadding")
    item["font_resource"] = item.get("font_resource") or TEXTBOX_DEFAULT_FONT_RESOURCE
    item["font_base"] = item.get("font_base") or TEXTBOX_DEFAULT_FONT_BASE
    item["font_source"] = item.get("font_source") or "textbox_default"
    item["font_size"] = TEXTBOX_DEFAULT_FONT_SIZE
    item["font_size_auto"] = False
    item["font_size_defaulted"] = True
    item["quadding"] = TEXTBOX_DEFAULT_QUADDING
    item["text_alignment"] = "center"
    item["quadding_defaulted"] = True
    item["text_color_rgb"] = item.get("text_color_rgb") or list(TEXTBOX_DEFAULT_TEXT_COLOR_RGB)
    item["default_appearance"] = format_default_appearance(
        item["font_resource"], item["font_size"], item["text_color_rgb"]
    )
    return item


def extract_acroforms_by_page(path, manual_specs=None, removal_specs=None):
    reader = PdfReader(path)
    page_by_ref = {}
    annot_page_by_ref = {}
    for page_no, pdf_page in enumerate(reader.pages, start=1):
        page_key = ref_key(pdf_page)
        if page_key is not None:
            page_by_ref[page_key] = page_no
        for annot_ref in pdf_page.get("/Annots", []) or []:
            annot_key = ref_key(annot_ref)
            if annot_key is not None:
                annot_page_by_ref[annot_key] = page_no

    acroform = resolve_pdf_obj(reader.trailer["/Root"].get("/AcroForm"))
    if not acroform:
        by_page = {}
    else:
        acroform_resources = resolve_pdf_obj(acroform.get("/DR")) if acroform.get("/DR") else None
        acroform_da = acroform.get("/DA")
        by_page = {}
        emitted_widget_refs = set()

        def walk(field_ref, parent_name="", inherited=None):
            field = resolve_pdf_obj(field_ref)
            current = dict(inherited or {})
            for key in (
                "/FT",
                "/V",
                "/DV",
                "/Ff",
                "/Opt",
                "/I",
                "/TI",
                "/DA",
                "/Q",
                "/MK",
                "/DR",
            ):
                if key in field:
                    current[key] = field.get(key)

            raw_name = field.get("/T")
            name = str(raw_name) if raw_name is not None else ""
            full_name = ".".join(p for p in (parent_name, name) if p)

            if field.get("/Subtype") == "/Widget" and "/Rect" in field:
                # ``PdfWriter.reattach_fields()`` may expose the same Widget
                # through both its original hierarchical field and a new
                # top-level /Fields entry.  The object reference identifies
                # the physical widget; emit it only on the first traversal.
                widget_ref = ref_key(field_ref) or ("direct", id(field))
                if widget_ref in emitted_widget_refs:
                    return
                emitted_widget_refs.add(widget_ref)
                page_no = None
                page_ref = field.get("/P")
                page_key = ref_key(page_ref) if page_ref is not None else None
                if page_key is not None:
                    page_no = page_by_ref.get(page_key)
                if page_no is None:
                    page_no = annot_page_by_ref.get(ref_key(field_ref))

                if page_no is not None:
                    appearance = parse_default_appearance(current.get("/DA") or acroform_da)
                    field_resources = resolve_pdf_obj(current.get("/DR")) if current.get("/DR") else acroform_resources
                    appearance.update(font_info_from_resources(appearance.get("font_resource"), field_resources))
                    acroform_source = ACROFORM_SOURCE_VALUES.get(
                        str(field.get(ACROFORM_SOURCE_PDF_KEY, "")), "unknown"
                    )
                    algorithm_name = plain_pdf_value(
                        field.get(ACROFORM_DETECTED_NAME_PDF_KEY)
                    )
                    item = {
                        "name": algorithm_name if acroform_source == "merged" and algorithm_name else full_name,
                        "acroform_source": acroform_source,
                        "field_type": str(current.get("/FT", "")),
                        "value": plain_pdf_value(current.get("/V")),
                        "default_value": plain_pdf_value(current.get("/DV")),
                        "appearance_state": plain_pdf_value(field.get("/AS")),
                        "quadding": plain_pdf_value(current.get("/Q")),
                        "appearance_characteristics": plain_pdf_value(current.get("/MK")),
                        **appearance,
                        "rect": [round(v, 2) for v in normalize_rect(field["/Rect"])],
                        "page": page_no,
                    }
                    if acroform_source == "merged":
                        item.update(
                            {
                                "native_acroform_name": plain_pdf_value(
                                    field.get(ACROFORM_ORIGINAL_NAME_PDF_KEY)
                                ),
                                "algorithm_acroform_name": algorithm_name,
                                "algorithm_field_type": plain_pdf_value(
                                    field.get(ACROFORM_DETECTED_TYPE_PDF_KEY)
                                ),
                                "merge_strategy": {
                                    "field_type": "pdf_native",
                                    "rect": "pdf_native",
                                    "other_properties": "algorithm",
                                    "choice_details": "pdf_native",
                                },
                            }
                        )
                    if item["field_type"] == "/Ch":
                        item.update(choice_field_details(current))
                    by_page.setdefault(page_no, []).append(apply_textbox_defaults(item))

            for kid in field.get("/Kids", []) or []:
                walk(kid, full_name, current)

        for field in acroform.get("/Fields", []) or []:
            walk(field)

    # CommonForms normally suppresses these overlaps before writing the PDF.
    # Deduplicate again while reading because malformed/re-attached field trees
    # can still expose both records. The native record remains untouched, so
    # its field type, rectangle, values, and choice metadata are authoritative.
    for page_no, forms in tuple(by_page.items()):
        by_page[page_no] = prefer_pdf_native_over_detected(forms)

    for spec in removal_specs or []:
        forms = by_page.get(spec["page"])
        if forms:
            by_page[spec["page"]] = [
                form
                for form in forms
                if form.get("name") != spec["name"] or is_protected_original_acroform(form)
            ]
    for spec in manual_specs or []:
        forms = by_page.setdefault(spec["page"], [])
        source_name = str(spec["name"])
        forms[:] = [
            form
            for form in forms
            if not (form.get("manual") and form.get("manual_source_name") == source_name)
        ]
        forms.append(build_manual_acroform_item(spec, name=manual_acroform_name(source_name, forms)))
    for forms in by_page.values():
        forms.sort(key=lambda f: (-f["rect"][3], f["rect"][0], f["name"]))
    return by_page


def extract_acroforms_in_box(acroforms, box, tol=1.0):
    x0, y0, x1, y1 = box
    out = []
    for item in acroforms:
        rx0, ry0, rx1, ry1 = item["rect"]
        cx = (rx0 + rx1) / 2
        cy = (ry0 + ry1) / 2
        if x0 - tol <= cx <= x1 + tol and y0 - tol <= cy <= y1 + tol:
            out.append(item)
    return out


def build_manual_acroform_item(spec, name=None):
    rect = normalize_rect(spec["rect"])
    item = {
        "name": name if name is not None else spec["name"],
        "field_type": spec.get("field_type", "/Tx"),
        "value": spec.get("value", ""),
        "default_value": spec.get("default_value", ""),
        "appearance_state": None,
        "quadding": None,
        "appearance_characteristics": None,
        "default_appearance": spec.get("default_appearance"),
        "font_resource": spec.get("font_resource"),
        "font_base": spec.get("font_base"),
        "font_source": spec.get("font_source"),
        "font_size": spec.get("font_size"),
        "font_size_auto": spec.get("font_size_auto"),
        "text_color_rgb": spec.get("text_color_rgb"),
        "rect": [round(v, 2) for v in rect],
        "page": spec["page"],
        "manual": True,
        "acroform_source": "manual",
        "manual_source_name": str(spec["name"]),
    }
    for key in ("leaf_id", "input_type", "field_name", "field_example"):
        if key in spec:
            item[key] = spec[key]
    if spec.get("field_name"):
        item["field_name_source"] = "manual"
    if spec.get("note"):
        item["manual_note"] = spec["note"]
    return apply_textbox_defaults(item)
