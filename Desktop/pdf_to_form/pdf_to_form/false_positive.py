from __future__ import annotations

from pathlib import Path
import re

import pdfplumber

from .acroforms import is_protected_original_acroform
from .manual import remove_acroform_from_page_leaves
from .traversal import iter_page_leaf_nodes


MEANINGFUL_TEXT_RE = re.compile(r"[A-Za-z0-9\u4e00-\u9fff]")


def meaningful_text(text):
    return "".join(MEANINGFUL_TEXT_RE.findall(text or ""))


def char_text_in_pdf_rect(page, rect, pad=1.0, min_text_len=1):
    """Return native PDF text whose character centers fall inside an AcroForm rect."""
    x0, y0, x1, y1 = [float(v) for v in rect]
    x0 += pad
    y0 += pad
    x1 -= pad
    y1 -= pad
    if x0 >= x1 or y0 >= y1:
        return ""

    chars = []
    for char in page.chars:
        text = char.get("text", "")
        if not text or not text.strip():
            continue
        cx = (float(char["x0"]) + float(char["x1"])) / 2
        cy = page.height - ((float(char["top"]) + float(char["bottom"])) / 2)
        if x0 <= cx <= x1 and y0 <= cy <= y1:
            chars.append(text)

    joined = "".join(chars).strip()
    return joined if len(meaningful_text(joined)) >= min_text_len else ""


def detection_key(detection):
    return (int(detection["page"]), str(detection["name"]))


def iter_leaf_acroforms(parsed_pages):
    for page_info, leaf in iter_page_leaf_nodes(parsed_pages):
        for acroform in leaf.get("acroforms", []) or []:
            yield page_info, leaf, acroform


def mark_detection_on_parsed_pages(parsed_pages, detection):
    key = detection_key(detection)
    for _, _, acroform in iter_leaf_acroforms(parsed_pages):
        if (int(acroform.get("page", 0)), str(acroform.get("name"))) == key:
            acroform["suspected_false_positive"] = True
            acroform["false_positive_reason"] = detection["reason"]
            acroform["overlap_text"] = detection["overlap_text"]


def detect_acroform_text_overlap(pdf_path, parsed_pages, pad=1.0, min_text_len=1, log=True):
    """Detect likely false-positive AcroForms whose widget rect covers native PDF text."""
    pdf_path = Path(pdf_path)
    detections = []
    seen = set()

    with pdfplumber.open(str(pdf_path)) as pdf:
        pages_by_no = {i + 1: page for i, page in enumerate(pdf.pages)}
        for page_info, leaf, acroform in iter_leaf_acroforms(parsed_pages):
            if is_protected_original_acroform(acroform):
                continue
            page_no = int(acroform.get("page") or page_info["page"])
            rect = acroform.get("rect")
            name = acroform.get("name")
            if not rect or not name or page_no not in pages_by_no:
                continue

            overlap_text = char_text_in_pdf_rect(pages_by_no[page_no], rect, pad=pad, min_text_len=min_text_len)
            if not overlap_text:
                continue

            key = (page_no, str(name))
            if key in seen:
                continue
            seen.add(key)
            detection = {
                "page": page_no,
                "name": str(name),
                "field_type": acroform.get("field_type"),
                "rect": list(rect),
                "leaf_bbox": leaf.get("bbox"),
                "overlap_text": overlap_text,
                "meaningful_text": meaningful_text(overlap_text),
                "reason": "acroform_rect_contains_native_pdf_text",
                "confidence": "high" if acroform.get("field_type") == "/Tx" else "medium",
            }
            detections.append(detection)
            mark_detection_on_parsed_pages(parsed_pages, detection)
            if log:
                print(
                    "[false-positive-acroform] "
                    f"page={page_no} name={name} field_type={acroform.get('field_type')} "
                    f"rect={list(rect)} overlap_text={overlap_text!r}"
                )

    return detections


def detect_acroform_text_overlap_in_payload(pdf_path, payload, pad=1.0, min_text_len=1, log=True):
    """Detect false positives in an exported ``parsed.json`` payload."""
    pdf_path = Path(pdf_path)
    detections = []
    seen = set()
    with pdfplumber.open(str(pdf_path)) as pdf:
        pages_by_no = {i + 1: page for i, page in enumerate(pdf.pages)}
        for page_info in payload.get("pages", []):
            for leaf in page_info.get("leaf_nodes", []):
                for acroform in leaf.get("acroforms", []) or []:
                    if is_protected_original_acroform(acroform):
                        continue
                    page_no = int(acroform.get("page") or page_info["page"])
                    rect, name = acroform.get("rect"), acroform.get("name")
                    if not rect or not name or page_no not in pages_by_no:
                        continue
                    overlap_text = char_text_in_pdf_rect(
                        pages_by_no[page_no], rect, pad=pad, min_text_len=min_text_len
                    )
                    if not overlap_text or (page_no, str(name)) in seen:
                        continue
                    seen.add((page_no, str(name)))
                    detection = {
                        "page": page_no,
                        "name": str(name),
                        "field_type": acroform.get("field_type"),
                        "rect": list(rect),
                        "leaf_bbox": leaf.get("bbox"),
                        "overlap_text": overlap_text,
                        "meaningful_text": meaningful_text(overlap_text),
                        "reason": "acroform_rect_contains_native_pdf_text",
                        "confidence": "high" if acroform.get("field_type") == "/Tx" else "medium",
                    }
                    detections.append(detection)
                    acroform["suspected_false_positive"] = True
                    acroform["false_positive_reason"] = detection["reason"]
                    acroform["overlap_text"] = overlap_text
                    if log:
                        print(
                            "[false-positive-acroform] "
                            f"page={page_no} name={name} field_type={acroform.get('field_type')} "
                            f"rect={list(rect)} overlap_text={overlap_text!r}"
                        )
    return detections


def remove_detected_false_positive_acroforms_from_payload(payload, detections):
    """Remove detected generated forms while preserving all possible originals."""
    removed = 0
    for detection in detections:
        for page in payload.get("pages", []):
            if page.get("page") != detection["page"]:
                continue
            forms = page.get("acroforms", [])
            page["acroforms"] = [
                form
                for form in forms
                if (
                    form.get("name") != detection["name"]
                    or is_protected_original_acroform(form)
                )
            ]
            removed += len(forms) - len(page["acroforms"])
            for leaf in page.get("leaf_nodes", []):
                leaf["acroforms"] = [
                    form
                    for form in leaf.get("acroforms", [])
                    if (
                        form.get("name") != detection["name"]
                        or is_protected_original_acroform(form)
                    )
                ]
            page["n_acroforms"] = len(page["acroforms"])
    payload.setdefault("summary", {})["total_acroforms"] = sum(
        len(page.get("acroforms", [])) for page in payload.get("pages", [])
    )
    return removed


def remove_detected_false_positive_acroforms(parsed_pages, detections):
    removed = 0
    for detection in detections:
        for page_info in parsed_pages:
            if page_info["page"] != detection["page"]:
                continue
            removed += remove_acroform_from_page_leaves(page_info, detection["name"])
    return removed


def detections_to_removal_specs(detections):
    return [
        {
            "page": detection["page"],
            "name": detection["name"],
            "note": f"自动检测误召回：{detection['reason']} overlap_text={detection['overlap_text']!r}",
        }
        for detection in detections
    ]
