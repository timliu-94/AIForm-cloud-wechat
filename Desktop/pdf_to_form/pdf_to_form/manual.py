from __future__ import annotations

from .acroforms import (
    build_manual_acroform_item,
    is_protected_original_acroform,
    manual_acroform_name,
    rect_is_within_bbox,
)


def bbox_contains_point(bbox, cx, cy, tol=1.0):
    x0, y0, x1, y1 = bbox
    return x0 - tol <= cx <= x1 + tol and y0 - tol <= cy <= y1 + tol


def iter_page_leaves_with_ids(page_info):
    page_no = page_info["page"]
    index = 0

    def walk(node):
        nonlocal index
        if node.get("is_leaf"):
            index += 1
            yield f"p{page_no:03d}_l{index:04d}", node
            return
        for child in node.get("children", []):
            yield from walk(child)

    for root in page_info.get("trees", []):
        yield from walk(root)


def find_leaf_by_manual_spec(page_info, spec):
    leaf_id = spec.get("leaf_id")
    if leaf_id:
        for current_leaf_id, leaf in iter_page_leaves_with_ids(page_info):
            if current_leaf_id == leaf_id:
                return leaf if rect_is_within_bbox(spec["rect"], leaf.get("bbox")) else None
        return None

    for _, leaf in iter_page_leaves_with_ids(page_info):
        if rect_is_within_bbox(spec["rect"], leaf.get("bbox")):
            return leaf
    return None


def remove_acroform_from_page_leaves(page_info, form_name):
    removed = 0
    for _, leaf in iter_page_leaves_with_ids(page_info):
        forms = leaf.get("acroforms", [])
        kept = [
            form
            for form in forms
            if form.get("name") != form_name or is_protected_original_acroform(form)
        ]
        if len(kept) != len(forms):
            leaf["acroforms"] = kept
            removed += len(forms) - len(kept)
    return removed


def remove_manual_acroform_source_from_page_leaves(page_info, source_name):
    """Remove a prior manual injection without touching a native name collision."""
    removed = 0
    for _, leaf in iter_page_leaves_with_ids(page_info):
        forms = leaf.get("acroforms", [])
        kept = [
            form
            for form in forms
            if not (form.get("manual") and form.get("manual_source_name") == str(source_name))
        ]
        leaf["acroforms"] = kept
        removed += len(forms) - len(kept)
    return removed


def move_manual_acroforms_to_leaf_tail(leaf):
    forms = leaf.get("acroforms") or []
    leaf["acroforms"] = [f for f in forms if not f.get("manual")] + [f for f in forms if f.get("manual")]
    return leaf["acroforms"]


def inject_manual_acroforms_into_pages(parsed_pages, manual_specs):
    injected = 0
    for spec in manual_specs:
        for page_info in parsed_pages:
            if page_info["page"] != spec["page"]:
                continue
            target_leaf = find_leaf_by_manual_spec(page_info, spec)
            if target_leaf is None:
                print(f"人工标注未匹配到叶子节点: page={spec['page']} leaf_id={spec.get('leaf_id')} rect={spec['rect']}")
                continue
            remove_manual_acroform_source_from_page_leaves(page_info, spec["name"])
            page_forms = [form for _, leaf in iter_page_leaves_with_ids(page_info) for form in leaf.get("acroforms", [])]
            target_leaf.setdefault("acroforms", []).append(
                build_manual_acroform_item(spec, name=manual_acroform_name(str(spec["name"]), page_forms))
            )
            move_manual_acroforms_to_leaf_tail(target_leaf)
            injected += 1
    return injected


def remove_manual_acroforms_from_pages(parsed_pages, removal_specs):
    removed = 0
    for spec in removal_specs:
        for page_info in parsed_pages:
            if page_info["page"] != spec["page"]:
                continue
            removed += remove_acroform_from_page_leaves(page_info, spec["name"])
    return removed
