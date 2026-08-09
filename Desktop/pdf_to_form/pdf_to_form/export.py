from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from .acroforms import extract_acroforms_by_page
from .llm import sync_leaf_input_type_to_acroforms
from .manual_rules import EMPTY_MANUAL_RULES, ManualRules

PARSED_JSON_SCHEMA_VERSION = "1.0"
SIMPLIFIED_REMOVE_KEYS = {
    # ``trees`` is an extraction/debug representation. Cleanup and LLM field
    # assignment operate on ``pages[].leaf_nodes`` and synchronize the page
    # inventory in ``pages[].acroforms``; keeping trees in the downstream JSON
    # would expose a stale third copy of the AcroForm metadata.
    "trees",
    "ocr_nodes",
    "ocr_text",
    "ocr_image",
    "ocr_text_file",
    "llm_ocr_infer",
    "llm_ocr_fields",
}


def json_safe(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, tuple):
        return [json_safe(v) for v in value]
    if isinstance(value, list):
        return [json_safe(v) for v in value]
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    return str(value)


def apply_leaf_manual_overrides(leaf, manual_rules: ManualRules = EMPTY_MANUAL_RULES):
    leaf_id = leaf.get("leaf_id")
    if leaf_id in manual_rules.leaves_not_need_filled:
        leaf["is_need_filled"] = False
    if leaf_id in manual_rules.leaves_handwritten and leaf.get("is_need_filled_rule_reason") is None:
        leaf["is_need_filled"] = True
        leaf["is_handwritting"] = True
    is_need = leaf.get("is_need_filled", True)
    is_hand = leaf.get("is_handwritting", False)
    leaf["acroforms"] = [
        {**form, "is_acro_need_filled": is_need, "is_acro_handwritting": is_hand}
        for form in leaf.get("acroforms", [])
    ]
    return leaf


def flatten_leaf_nodes(trees, page_no, manual_rules: ManualRules = EMPTY_MANUAL_RULES):
    leaves = []

    def walk(node, path):
        if node.get("is_leaf"):
            leaf = dict(node)
            sync_leaf_input_type_to_acroforms(leaf)
            leaf["page"] = leaf.get("page", page_no)
            leaf["path"] = path
            leaf["leaf_id"] = f"p{page_no:03d}_l{len(leaves) + 1:04d}"
            apply_leaf_manual_overrides(leaf, manual_rules)
            leaves.append(leaf)
            return
        for child_index, child in enumerate(node.get("children", [])):
            walk(child, path + [child_index])

    for root_index, root in enumerate(trees):
        walk(root, [root_index])
    return leaves


def build_parsed_pdf_json(pdf_path, parsed_pages, manual_specs=None, removal_specs=None, manual_rules: ManualRules = EMPTY_MANUAL_RULES):
    pdf_path = Path(pdf_path)
    acroforms_by_page = extract_acroforms_by_page(str(pdf_path), manual_specs=manual_specs, removal_specs=removal_specs)
    pages_out = []

    for page_info in parsed_pages:
        page_no = page_info["page"]
        trees = json_safe(page_info.get("trees", []))
        leaf_nodes = json_safe(flatten_leaf_nodes(trees, page_no, manual_rules))
        page_acroforms = json_safe(acroforms_by_page.get(page_no, []))
        pages_out.append(
            {
                "page": page_no,
                "size": json_safe(page_info.get("size")),
                "n_frames": page_info.get("n_frames", 0),
                "n_leaves": len(leaf_nodes),
                "n_acroforms": len(page_acroforms),
                "trees": trees,
                "leaf_nodes": leaf_nodes,
                "acroforms": page_acroforms,
            }
        )

    return {
        "schema_version": PARSED_JSON_SCHEMA_VERSION,
        "source_pdf": str(pdf_path),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "pages": len(pages_out),
            "total_leaves": sum(p["n_leaves"] for p in pages_out),
            "total_acroforms": sum(p["n_acroforms"] for p in pages_out),
            "leaves_with_ocr": sum(
                1 for p in pages_out for leaf in p["leaf_nodes"] if leaf.get("ocr_text") or leaf.get("ocr_nodes")
            ),
            "leaves_with_llm_fields": sum(
                1 for p in pages_out for leaf in p["leaf_nodes"] if leaf.get("llm_ocr_fields")
            ),
        },
        "pages": pages_out,
    }


def save_parsed_pdf_json(pdf_path, parsed_pages, output_path=None, manual_specs=None, removal_specs=None, manual_rules: ManualRules = EMPTY_MANUAL_RULES):
    output_path = Path(output_path) if output_path else Path(pdf_path).with_suffix(".parsed.json")
    payload = build_parsed_pdf_json(pdf_path, parsed_pages, manual_specs=manual_specs, removal_specs=removal_specs, manual_rules=manual_rules)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return output_path, payload


def strip_keys_recursive(obj, keys_to_remove):
    if isinstance(obj, dict):
        return {k: strip_keys_recursive(v, keys_to_remove) for k, v in obj.items() if k not in keys_to_remove}
    if isinstance(obj, list):
        return [strip_keys_recursive(v, keys_to_remove) for v in obj]
    return obj


def _acroform_identity(page_number, form):
    return (
        int(page_number),
        str(form.get("name") or ""),
        str(form.get("field_type") or ""),
        tuple(round(float(value), 4) for value in form.get("rect", [])),
    )


def _base36(value):
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    if value == 0:
        return "0"
    encoded = ""
    while value:
        value, remainder = divmod(value, 36)
        encoded = digits[remainder] + encoded
    return encoded


def _stable_frontend_field_id(name, page_number, leaf_id, rect):
    """Mirror miniprogram ``assignUniqueFieldIds`` for duplicate schema names."""
    # JSON.stringify renders integer-valued JavaScript Numbers without ``.0``.
    normalized_rect = [
        int(value) if isinstance(value, float) and value.is_integer() else value
        for value in rect
    ]
    identity = json.dumps(
        [name, page_number, leaf_id, normalized_rect],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    hash_value = 2166136261
    encoded = identity.encode("utf-16-le", errors="surrogatepass")
    for index in range(0, len(encoded), 2):
        code_unit = encoded[index] | (encoded[index + 1] << 8)
        hash_value ^= code_unit
        hash_value = (hash_value * 16777619) & 0xFFFFFFFF
    return f"acroform_{_base36(hash_value)}"


def canonicalize_acroform_names(payload):
    """Give every downstream AcroForm one stable, document-unique name.

    Detector names are already unique. PDF-native radio widgets can share one
    logical field name, so duplicate names use the same stable ID that older
    miniprogram clients generated from page, leaf and rectangle metadata.
    """
    pages = payload.get("pages", [])
    page_forms = [
        (int(page["page"]), form)
        for page in pages
        for form in page.get("acroforms", [])
    ]
    name_counts = Counter(str(form.get("name") or "") for _, form in page_forms)
    leaf_ids = {}
    for page in pages:
        page_number = int(page["page"])
        for leaf in page.get("leaf_nodes", []):
            leaf_page = int(leaf.get("page", page_number))
            for form in leaf.get("acroforms", []):
                leaf_ids[_acroform_identity(leaf_page, form)] = str(leaf.get("leaf_id") or "")

    used_names = set()
    renamed_by_identity = {}
    renamed = 0
    for page_number, form in page_forms:
        original_name = str(form.get("name") or "")
        identity = _acroform_identity(page_number, form)
        if original_name and name_counts[original_name] == 1 and original_name not in used_names:
            canonical_name = original_name
        else:
            canonical_name = _stable_frontend_field_id(
                original_name,
                page_number,
                leaf_ids.get(identity, ""),
                form.get("rect", []),
            )
            base = canonical_name
            suffix = 1
            while canonical_name in used_names or canonical_name in name_counts:
                suffix += 1
                canonical_name = f"{base}_{suffix}"
        if identity in renamed_by_identity and renamed_by_identity[identity] != canonical_name:
            raise ValueError(f"duplicate AcroForm identity cannot be canonicalized: {identity}")
        renamed_by_identity[identity] = canonical_name
        used_names.add(canonical_name)
        if canonical_name != original_name:
            form["source_acroform_name"] = original_name
            form["name"] = canonical_name
            renamed += 1

    for page in pages:
        page_number = int(page["page"])
        for leaf in page.get("leaf_nodes", []):
            leaf_page = int(leaf.get("page", page_number))
            for form in leaf.get("acroforms", []):
                identity = _acroform_identity(leaf_page, form)
                canonical_name = renamed_by_identity.get(identity)
                if canonical_name is not None and canonical_name != form.get("name"):
                    form["source_acroform_name"] = str(form.get("name") or "")
                    form["name"] = canonical_name
    return renamed


def save_simplified_parsed_pdf_json(payload, output_path, remove_keys=SIMPLIFIED_REMOVE_KEYS):
    simplified = strip_keys_recursive(payload, set(remove_keys))
    canonicalize_acroform_names(simplified)
    output_path = Path(output_path)
    output_path.write_text(json.dumps(simplified, ensure_ascii=False, indent=2), encoding="utf-8")
    return output_path, simplified


def load_parsed_pdf_json(json_path):
    json_path = Path(json_path)
    payload = json.loads(json_path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != PARSED_JSON_SCHEMA_VERSION:
        raise ValueError(f"unsupported schema_version: {payload.get('schema_version')}")
    if "pages" not in payload or not isinstance(payload["pages"], list):
        raise ValueError("invalid parsed PDF JSON: missing pages list")
    return payload


def iter_json_leaf_nodes(payload):
    for page_info in payload.get("pages", []):
        for leaf in page_info.get("leaf_nodes", []):
            yield page_info, leaf
