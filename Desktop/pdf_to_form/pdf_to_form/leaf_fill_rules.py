from __future__ import annotations

import re

from .traversal import iter_page_leaf_nodes

TEXT_LETTER_RE = re.compile(r"[A-Za-z\u4e00-\u9fff]")
NOT_NEED_FILLED_KEYWORDS = ("照片", "签证机关专用")


def leaf_text_for_fill_rule(leaf):
    """Use the text block content available on the leaf; OCR text is a fallback."""
    return "\n".join(
        text
        for text in (leaf.get("text", ""), leaf.get("ocr_text", ""))
        if isinstance(text, str) and text.strip()
    )


def detect_not_need_filled_reason(text):
    if any(keyword in text for keyword in NOT_NEED_FILLED_KEYWORDS):
        return "text_contains_not_need_filled_keyword"
    if not TEXT_LETTER_RE.search(text or ""):
        return "text_contains_no_chinese_or_english_letters"
    return ""


def set_leaf_need_filled(leaf, is_need_filled, reason=""):
    leaf["is_need_filled"] = bool(is_need_filled)
    if reason:
        leaf["is_need_filled_rule_reason"] = reason
    for acroform in leaf.get("acroforms", []) or []:
        acroform["is_acro_need_filled"] = bool(is_need_filled)
        if reason:
            acroform["is_acro_need_filled_rule_reason"] = reason
    return leaf


def apply_text_block_fill_rules(parsed_pages, log=False):
    """Mark leaves and their AcroForms as not needing filling based on leaf text."""
    updated = 0
    reasons = {}
    for page_info, leaf in iter_page_leaf_nodes(parsed_pages):
        text = leaf_text_for_fill_rule(leaf)
        reason = detect_not_need_filled_reason(text)
        if not reason:
            continue
        set_leaf_need_filled(leaf, False, reason=reason)
        updated += 1
        reasons[reason] = reasons.get(reason, 0) + 1
        if log:
            print(
                "[leaf-fill-rule] "
                f"page={page_info['page']} bbox={leaf.get('bbox')} "
                f"is_need_filled=false reason={reason} text={text[:80]!r}"
            )
    return {"updated_leaves": updated, "reasons": reasons}

