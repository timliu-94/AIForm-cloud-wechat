from __future__ import annotations

from pypdf import PdfWriter
from pypdf.generic import BooleanObject, DictionaryObject, NameObject, NumberObject, TextStringObject

from .acroforms import (
    TEXTBOX_DEFAULT_FONT_BASE,
    TEXTBOX_DEFAULT_FONT_RESOURCE,
    TEXTBOX_DEFAULT_FONT_SIZE,
    TEXTBOX_DEFAULT_QUADDING,
    TEXTBOX_DEFAULT_TEXT_COLOR_RGB,
    format_default_appearance,
    resolve_pdf_obj,
)


def save_pdf_with_textbox_defaults(input_path, output_path):
    writer = PdfWriter(clone_from=input_path)
    acroform = resolve_pdf_obj(writer.root_object.get("/AcroForm"))
    if not acroform:
        writer.write(output_path)
        return 0

    updated = 0
    default_da = format_default_appearance(
        TEXTBOX_DEFAULT_FONT_RESOURCE,
        TEXTBOX_DEFAULT_FONT_SIZE,
        TEXTBOX_DEFAULT_TEXT_COLOR_RGB,
    )
    dr = resolve_pdf_obj(acroform.get("/DR")) if acroform.get("/DR") else DictionaryObject()
    fonts = resolve_pdf_obj(dr.get("/Font")) if dr.get("/Font") else DictionaryObject()
    if NameObject(TEXTBOX_DEFAULT_FONT_RESOURCE) not in fonts:
        fonts[NameObject(TEXTBOX_DEFAULT_FONT_RESOURCE)] = DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Font"),
                NameObject("/Subtype"): NameObject("/Type1"),
                NameObject("/BaseFont"): NameObject(TEXTBOX_DEFAULT_FONT_BASE),
            }
        )
    dr[NameObject("/Font")] = fonts
    acroform[NameObject("/DR")] = dr
    acroform[NameObject("/DA")] = TextStringObject(default_da)

    def walk(field_ref, inherited_ft=None):
        nonlocal updated
        field = resolve_pdf_obj(field_ref)
        field_type = field.get("/FT", inherited_ft)
        if field.get("/Subtype") == "/Widget" and str(field_type) == "/Tx":
            field[NameObject("/DA")] = TextStringObject(default_da)
            field[NameObject("/Q")] = NumberObject(TEXTBOX_DEFAULT_QUADDING)
            if "/AP" in field:
                del field["/AP"]
            updated += 1
        for kid in field.get("/Kids", []) or []:
            walk(kid, field_type)

    for field in acroform.get("/Fields", []) or []:
        walk(field)

    acroform[NameObject("/NeedAppearances")] = BooleanObject(True)
    writer.write(output_path)
    return updated

