"""Load and post-merge manual PDF adjustments scoped to one PDF file.

Rules live in :mod:`manual_rules.json` so annotators can add corrections
without changing Python.  The JSON hierarchy is ``cities -> <city> -> pdfs
-> <filename>``.  Matching rules are merged into an already-exported
``parsed.json`` payload; a PDF without an entry deliberately receives no
manual adjustments.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .acroforms import (
    build_manual_acroform_item,
    is_protected_original_acroform,
    manual_acroform_name,
    rect_is_within_bbox,
)


@dataclass(frozen=True)
class ManualRules:
    """The adjustments applicable to one city/PDF pair."""

    city: str | None = None
    pdf_filename: str | None = None
    acroforms: tuple[dict[str, Any], ...] = ()
    acroform_removals: tuple[dict[str, Any], ...] = ()
    leaves_not_need_filled: frozenset[str] = frozenset()
    leaves_handwritten: frozenset[str] = frozenset()


EMPTY_MANUAL_RULES = ManualRules()


def _require_list(value: Any, path: str) -> list[Any]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(f"{path} must be a JSON array")
    return value


def _require_string_list(value: Any, path: str) -> frozenset[str]:
    values = _require_list(value, path)
    if not all(isinstance(item, str) for item in values):
        raise ValueError(f"{path} must contain only strings")
    return frozenset(values)


def _load_rules_document(rules_path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(rules_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise FileNotFoundError(f"manual rules file does not exist: {rules_path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid manual rules JSON in {rules_path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError("manual rules root must be a JSON object")
    if payload.get("version") != 1:
        raise ValueError("manual rules 'version' must be 1")
    cities = payload.get("cities", {})
    if not isinstance(cities, dict):
        raise ValueError("manual rules 'cities' must be a JSON object")
    return cities


def _find_pdf_rules_file(pdf_path: Path) -> Path | None:
    """Find the per-PDF rules file next to the prepared PDF's outputs.

    A normal prepared PDF lives at
    ``<country>/<pdf-stem>/commonforms/<pdf-name>.pdf``.  Its rules belong in
    the sibling ``outputs`` directory, not in a repository-wide rule file.
    """
    commonforms_dir = next((parent for parent in (pdf_path.parent, *pdf_path.parents) if parent.name == "commonforms"), None)
    if commonforms_dir is None:
        return None
    outputs_dir = commonforms_dir.parent / "outputs"
    if not outputs_dir.is_dir():
        return None

    exact_path = outputs_dir / f"{pdf_path.stem}.manual_rules.json"
    if exact_path.is_file():
        return exact_path

    candidates = sorted(outputs_dir.glob("*.manual_rules.json"))
    if len(candidates) == 1:
        return candidates[0]
    if len(candidates) > 1:
        names = ", ".join(path.name for path in candidates)
        raise ValueError(f"multiple manual rules files found for {pdf_path}: {names}")
    return None


def get_manual_rules(pdf_path: str | Path, rules_path: str | Path | None = None) -> ManualRules:
    """Return the exact city/PDF rule entry for ``pdf_path``, if configured.

    Unless explicitly overridden, rules are loaded from the current document's
    ``<country>/<pdf-stem>/outputs/*.manual_rules.json``.  That directory is
    authoritative when the file contains one PDF entry, so stale filename
    metadata cannot silently suppress this document's corrections.  Explicit
    shared rule files retain strict filename matching.  When the per-document
    file is absent, manual overrides are simply not applied.
    """

    pdf_path = Path(pdf_path)
    uses_per_pdf_rules_file = rules_path is None
    rules_path = Path(rules_path) if rules_path is not None else _find_pdf_rules_file(pdf_path)
    if rules_path is None or not rules_path.is_file():
        return EMPTY_MANUAL_RULES
    cities = _load_rules_document(rules_path)
    entries: list[tuple[str, str, dict[str, Any]]] = []
    path_parts = set(pdf_path.parts)

    for city, city_config in cities.items():
        if not isinstance(city, str) or not isinstance(city_config, dict):
            raise ValueError("each city rule must be an object")
        pdfs = city_config.get("pdfs", {})
        if not isinstance(pdfs, dict):
            raise ValueError(f"cities.{city}.pdfs must be a JSON object")
        for configured_pdf_name, pdf_rules in pdfs.items():
            if not isinstance(configured_pdf_name, str):
                raise ValueError(f"cities.{city}.pdfs keys must be strings")
            if not isinstance(pdf_rules, dict):
                raise ValueError(f"cities.{city}.pdfs.{configured_pdf_name} must be a JSON object")
            entries.append((city, configured_pdf_name, pdf_rules))

    matches = [entry for entry in entries if entry[1] == pdf_path.name]
    if not matches:
        if not entries:
            return EMPTY_MANUAL_RULES
        if uses_per_pdf_rules_file and len(entries) == 1:
            # This file was discovered inside this document's own outputs/
            # directory.  Its directory is the authoritative scope; tolerate
            # stale display metadata such as a renamed PDF key inside the file.
            matches = entries
        elif uses_per_pdf_rules_file:
            configured_names = ", ".join(entry[1] for entry in entries)
            raise ValueError(
                f"per-PDF manual rules file {rules_path} has no entry for {pdf_path.name} "
                f"and is not unambiguous: {configured_names}"
            )
        else:
            return EMPTY_MANUAL_RULES
    city_matches = [match for match in matches if match[0] in path_parts]
    if len(city_matches) == 1:
        city, configured_pdf_name, rules = city_matches[0]
    elif len(matches) == 1:
        city, configured_pdf_name, rules = matches[0]
    else:
        candidates = ", ".join(city for city, _, _ in matches)
        raise ValueError(f"manual rules for {pdf_path.name} are ambiguous across cities: {candidates}")

    prefix = f"cities.{city}.pdfs.{configured_pdf_name}"
    acroforms = _require_list(rules.get("acroforms"), f"{prefix}.acroforms")
    removals = _require_list(rules.get("acroform_removals"), f"{prefix}.acroform_removals")
    if not all(isinstance(item, dict) for item in acroforms + removals):
        raise ValueError(f"{prefix} AcroForm rules must be JSON objects")
    return ManualRules(
        city=city,
        pdf_filename=pdf_path.name,
        acroforms=tuple(acroforms),
        acroform_removals=tuple(removals),
        leaves_not_need_filled=_require_string_list(rules.get("leaves_not_need_filled"), f"{prefix}.leaves_not_need_filled"),
        leaves_handwritten=_require_string_list(rules.get("leaves_handwritten"), f"{prefix}.leaves_handwritten"),
    )


def _find_leaf(page: dict[str, Any], spec: dict[str, Any]) -> dict[str, Any] | None:
    """Find a leaf in an exported payload using its stable ID or its box."""
    leaf_id = spec.get("leaf_id")
    leaves = page.get("leaf_nodes", [])
    if leaf_id:
        leaf = next((leaf for leaf in leaves if leaf.get("leaf_id") == leaf_id), None)
        # A stale leaf ID is worse than no match: it can attach a widget to a
        # visually unrelated field.  Do not silently fall back in this case.
        return leaf if leaf and rect_is_within_bbox(spec["rect"], leaf.get("bbox")) else None

    for leaf in leaves:
        if rect_is_within_bbox(spec["rect"], leaf.get("bbox")):
            return leaf
    return None


def _remove_named_acroform(page: dict[str, Any], name: str) -> int:
    """Remove a generated/manual form without ever deleting a source-PDF field."""
    removed = 0
    for container in [page, *page.get("leaf_nodes", [])]:
        forms = container.get("acroforms", [])
        kept = [
            form
            for form in forms
            if form.get("name") != name or is_protected_original_acroform(form)
        ]
        removed += len(forms) - len(kept)
        container["acroforms"] = kept
    return removed


def _remove_manual_acroform_source(page: dict[str, Any], source_name: str) -> int:
    """Remove only an earlier injection of this rule, never a native field."""
    removed = 0
    for container in [page, *page.get("leaf_nodes", [])]:
        forms = container.get("acroforms", [])
        kept = [
            form
            for form in forms
            if not (form.get("manual") and form.get("manual_source_name") == source_name)
        ]
        removed += len(forms) - len(kept)
        container["acroforms"] = kept
    return removed


def _apply_leaf_overrides(page: dict[str, Any], rules: ManualRules) -> None:
    for leaf in page.get("leaf_nodes", []):
        leaf_id = leaf.get("leaf_id")
        if leaf_id in rules.leaves_not_need_filled:
            leaf["is_need_filled"] = False
        if leaf_id in rules.leaves_handwritten and leaf.get("is_need_filled_rule_reason") is None:
            leaf["is_need_filled"] = True
            leaf["is_handwritting"] = True
        for form in leaf.get("acroforms", []):
            form["is_acro_need_filled"] = leaf.get("is_need_filled", True)
            form["is_acro_handwritting"] = leaf.get("is_handwritting", False)


def apply_manual_rules_to_payload(payload: dict[str, Any], rules: ManualRules) -> dict[str, int]:
    """Merge one manual-rule entry into an already exported parsed payload.

    The exported page AcroForm list and the leaf-level assignments are kept in
    sync so downstream preview and simplified JSON generation see the same
    result.
    """
    pages = {page.get("page"): page for page in payload.get("pages", [])}
    removed = injected = unmatched = 0

    for spec in rules.acroform_removals:
        page = pages.get(spec.get("page"))
        if page is not None:
            removed += _remove_named_acroform(page, spec["name"])

    for spec in rules.acroforms:
        page = pages.get(spec.get("page"))
        if page is None:
            unmatched += 1
            continue
        leaf = _find_leaf(page, spec)
        if leaf is None:
            unmatched += 1
            continue
        _remove_manual_acroform_source(page, str(spec["name"]))
        form = build_manual_acroform_item(
            spec,
            name=manual_acroform_name(str(spec["name"]), page.get("acroforms", [])),
        )
        leaf.setdefault("acroforms", []).append(form)
        page.setdefault("acroforms", []).append(dict(form))
        injected += 1

    for page in payload.get("pages", []):
        _apply_leaf_overrides(page, rules)
        page["acroforms"].sort(key=lambda form: (-form["rect"][3], form["rect"][0], form["name"]))
        page["n_acroforms"] = len(page["acroforms"])

    summary = payload.setdefault("summary", {})
    summary["total_acroforms"] = sum(page["n_acroforms"] for page in payload.get("pages", []))
    return {"removed": removed, "injected": injected, "unmatched": unmatched}
