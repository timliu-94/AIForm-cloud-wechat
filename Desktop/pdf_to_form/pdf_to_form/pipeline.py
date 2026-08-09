from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import json

from .export import load_parsed_pdf_json, save_parsed_pdf_json, save_simplified_parsed_pdf_json
from .false_positive import (
    detect_acroform_text_overlap_in_payload,
    remove_detected_false_positive_acroforms_from_payload,
)
from .fields import assign_field_names_to_pages, find_unresolved_required_acroforms
from .leaf_fill_rules import apply_text_block_fill_rules
from .llm import LLM_INFER_DIR, LLM_MAX_WORKERS, add_llm_fields_to_leaves
from .manual_rules import EMPTY_MANUAL_RULES, apply_manual_rules_to_payload, get_manual_rules
from .ocr import OCR_IMAGE_DIR, OCR_TEXT_DIR, add_ocr_nodes_to_leaves
from .parser import parse_pdf, print_tree
from .pdf_style import save_pdf_with_textbox_defaults


@dataclass
class PipelineConfig:
    pdf_path: Path
    output_json: Path | None = None
    output_simple_json: Path | None = None
    defer_simple_json: bool = False
    styled_pdf: Path | None = None
    run_ocr: bool = False
    run_llm: bool = True
    overwrite_ocr: bool = False
    overwrite_llm: bool = False
    refresh_ocr_cache: bool = False
    refresh_llm_cache: bool = False
    image_dir: Path = OCR_IMAGE_DIR
    text_dir: Path = OCR_TEXT_DIR
    llm_infer_dir: Path = LLM_INFER_DIR
    llm_max_workers: int = LLM_MAX_WORKERS
    print_trees: bool = False
    apply_manual_rules: bool = True
    manual_rules_path: Path | None = None
    write_styled_pdf: bool = False
    detect_false_positive_acroforms: bool = True
    remove_false_positive_acroforms: bool = False
    false_positive_text_pad: float = 1.0
    false_positive_min_text_len: int = 1
    field_example_overrides: dict[str, str] | None = None


def run_pipeline(config: PipelineConfig):
    """Stage 1: run CommonForms extraction and write the raw parsed JSON."""
    pdf_path = Path(config.pdf_path)
    # Manual corrections are deliberately applied only after parsed.json exists.
    pages = parse_pdf(str(pdf_path))
    if config.print_trees:
        for page in pages:
            print(
                f"\n========== Page {page['page']} size={page['size']} "
                f"frames={page['n_frames']} leaves={page['n_leaves']} acroforms={page['n_acroforms']} =========="
            )
            for tree in page["trees"]:
                print_tree(tree)

    summaries = {"parse": {"pages": len(pages), "total_leaves": sum(p["n_leaves"] for p in pages)}}

    if config.run_ocr:
        summaries["ocr"] = add_ocr_nodes_to_leaves(
            str(pdf_path),
            pages,
            image_dir=config.image_dir,
            text_dir=config.text_dir,
            overwrite=config.overwrite_ocr,
            refresh_cache=config.refresh_ocr_cache,
        )

    summaries["leaf_fill_rules"] = apply_text_block_fill_rules(pages)

    summaries["fields"] = {
        "assigned": assign_field_names_to_pages(
            pages, config.field_example_overrides
        )
    }

    output_json = config.output_json or pdf_path.with_suffix(".parsed.json")
    output_simple_json = config.output_simple_json or pdf_path.with_suffix(".parsed.simple.json")
    json_path, payload = save_parsed_pdf_json(
        pdf_path,
        pages,
        output_path=output_json,
    )
    summaries["export"] = {"json": str(json_path), "parsed_json": str(json_path), "summary": payload["summary"]}
    if not config.defer_simple_json:
        simple_json_path, _ = save_simplified_parsed_pdf_json(payload, output_simple_json)
        summaries["export"]["simple_json"] = str(simple_json_path)

    if config.write_styled_pdf:
        styled_pdf = config.styled_pdf or pdf_path.with_name(f"{pdf_path.stem}_textbox_defaults.pdf")
        summaries["styled_pdf"] = {
            "path": str(styled_pdf),
            "updated_textboxes": save_pdf_with_textbox_defaults(str(pdf_path), str(styled_pdf)),
        }

    return payload, summaries


def run_cleanup_pipeline(config: PipelineConfig):
    """Stage 2: clean parsed JSON, infer final fields, and write post-processed output."""
    pdf_path = Path(config.pdf_path)
    parsed_json_path = config.output_json or pdf_path.with_suffix(".parsed.json")
    payload = load_parsed_pdf_json(parsed_json_path)
    summaries = {"cleanup": {"source_json": str(parsed_json_path)}}

    if config.detect_false_positive_acroforms:
        detections = detect_acroform_text_overlap_in_payload(
            pdf_path,
            payload,
            pad=config.false_positive_text_pad,
            min_text_len=config.false_positive_min_text_len,
            log=True,
        )
        # The cleanup stage removes detected false positives by default.  The
        # legacy flag remains accepted for command-line compatibility.
        removed = remove_detected_false_positive_acroforms_from_payload(payload, detections)
        summaries["false_positive_acroforms"] = {"detected": len(detections), "removed": removed}

    manual_rules = get_manual_rules(pdf_path, config.manual_rules_path) if config.apply_manual_rules else EMPTY_MANUAL_RULES
    if manual_rules != EMPTY_MANUAL_RULES:
        summaries["manual"] = {
            "city": manual_rules.city,
            "pdf": manual_rules.pdf_filename,
            **apply_manual_rules_to_payload(payload, manual_rules),
        }

    # Field inference must see the final leaf AcroForms after automatic and
    # manual additions/removals. Existing inference attached to parsed.json is
    # always reconsidered, while the final-state cache can still be reused.
    if config.run_llm:
        summaries["llm"] = add_llm_fields_to_leaves(
            payload.get("pages", []),
            infer_dir=config.llm_infer_dir,
            overwrite=True,
            refresh_cache=config.refresh_llm_cache,
            max_workers=config.llm_max_workers,
            progress=True,
        )
        summaries["llm"]["cache_dir"] = str(config.llm_infer_dir)

    summaries["fields"] = {
        "assigned": assign_field_names_to_pages(
            payload.get("pages", []), config.field_example_overrides
        )
    }
    source_counts = {"llm": 0, "manual": 0, "fallback": 0, "missing": 0}
    for page in payload.get("pages", []):
        for leaf in page.get("leaf_nodes", []):
            for form in leaf.get("acroforms", []):
                source = form.get("field_name_source") or "missing"
                source_counts[source] = source_counts.get(source, 0) + 1
    summaries["fields"].update(
        {
            "total": sum(source_counts.values()),
            "by_source": source_counts,
            "llm_named": source_counts.get("llm", 0),
            "manual_named": source_counts.get("manual", 0),
            "fallback": source_counts.get("fallback", 0) + source_counts.get("missing", 0),
        }
    )
    unresolved = find_unresolved_required_acroforms(payload.get("pages", []))
    summaries["fields"]["unresolved_required"] = len(unresolved)
    # A shorter LLM list is valid: positional values are used where present,
    # and remaining AcroForms retain their normal fallback/default metadata.
    payload.setdefault("summary", {})["leaves_with_llm_fields"] = sum(
        1
        for page in payload.get("pages", [])
        for leaf in page.get("leaf_nodes", [])
        if leaf.get("llm_ocr_fields")
    )
    payload["summary"]["field_name_sources"] = source_counts
    if config.run_llm:
        payload["summary"]["llm_cache_dir"] = str(config.llm_infer_dir)

    post_json_path = parsed_json_path.with_suffix(".post.json")
    post_json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    summaries["export"] = {
        "json": str(post_json_path),
        "parsed_json": str(parsed_json_path),
        "post_json": str(post_json_path),
        "summary": payload["summary"],
    }
    if not config.defer_simple_json:
        output_simple_json = config.output_simple_json or pdf_path.with_suffix(".parsed.simple.json")
        simple_json_path, _ = save_simplified_parsed_pdf_json(payload, output_simple_json)
        summaries["export"]["simple_json"] = str(simple_json_path)
    return payload, summaries
