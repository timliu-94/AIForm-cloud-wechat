from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from pdf_to_form.export import save_simplified_parsed_pdf_json
from pdf_to_form.pipeline import PipelineConfig, run_cleanup_pipeline, run_pipeline
from pdf_to_form.upload_acroforms import rebuild_pdf_acroforms, synchronize_pdf_acroforms


JAPAN_NAME_FIELD_EXAMPLE_OVERRIDES = {
    "姓": "刘 LIU",
    "名": "明 MING",
    "合法监护人姓名": "刘伟 LIU WEI",
}


class MultiPDFProcessingError(RuntimeError):
    def __init__(self, failures: list[dict], upload_skipped: bool = False):
        self.failures = failures
        names = ", ".join(item["pdf"] for item in failures)
        message = f"{len(failures)} PDF(s) failed: {names}"
        if upload_skipped:
            message += "; upload_data was not rebuilt"
        super().__init__(message)


def load_acroform_annotations(parsed_simple_json_path: Path) -> dict[int, list[dict]]:
    """Load each leaf and the actual AcroForm rectangles assigned to it."""
    if not parsed_simple_json_path.is_file():
        raise FileNotFoundError(f"parsed simple JSON does not exist: {parsed_simple_json_path}")

    payload = json.loads(parsed_simple_json_path.read_text(encoding="utf-8"))
    annotations_by_page: dict[int, list[dict]] = {}
    for page in payload.get("pages", []):
        page_number = int(page["page"])
        for leaf in page.get("leaf_nodes", []):
            acroforms = leaf.get("acroforms", [])
            leaf_bbox = leaf.get("bbox")
            form_rects = [
                {"rect": form["rect"], "name": form.get("name", "")}
                for form in acroforms
                if isinstance(form.get("rect"), list) and len(form["rect"]) == 4
            ]
            if form_rects:
                annotations_by_page.setdefault(page_number, []).append(
                    {"leaf_bbox": leaf_bbox, "acroforms": form_rects}
                )
    return annotations_by_page


def render_preview_images(
    pdf_path: Path,
    output_dir: Path,
    acroform_annotations_by_page: dict[int, list[dict]],
    target_height: int,
    render_pages: bool = True,
    render_extractor: bool = True,
) -> list[str]:
    """Render PDF pages plus leaf (orange) and actual AcroForm (blue) boxes."""
    try:
        import fitz  # PyMuPDF
        from PIL import Image, ImageDraw
    except ImportError as exc:
        raise RuntimeError(
            "Preview rendering requires PyMuPDF and Pillow. "
            "Install them with `python3 -m pip install pymupdf pillow`."
        ) from exc

    output_dir.mkdir(parents=True, exist_ok=True)
    rendered_paths = []

    with fitz.open(pdf_path) as document:
        for page_index in range(document.page_count):
            page = document[page_index]
            scale = target_height / page.rect.height
            pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)

            page_number = page_index + 1
            if render_pages:
                image_path = output_dir / f"page-{page_number}.png"
                pixmap.save(image_path)
                rendered_paths.append(str(image_path))

            image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
            draw = ImageDraw.Draw(image)
            for annotation in acroform_annotations_by_page.get(page_number, []):
                leaf_bbox = annotation.get("leaf_bbox")
                if isinstance(leaf_bbox, list) and len(leaf_bbox) == 4:
                    x0, y0, x1, y1 = leaf_bbox
                    leaf_box = (
                        round(x0 * scale),
                        round((page.rect.height - y1) * scale),
                        round(x1 * scale),
                        round((page.rect.height - y0) * scale),
                    )
                    draw.rectangle(leaf_box, outline="orange", width=1)

                for form in annotation["acroforms"]:
                    x0, y0, x1, y1 = form["rect"]
                    box = (
                        round(x0 * scale),
                        round((page.rect.height - y1) * scale),
                        round(x1 * scale),
                        round((page.rect.height - y0) * scale),
                    )
                    draw.rectangle(box, outline="blue", width=3)
                    draw.text((box[0] + 2, box[1] + 2), form["name"], fill="blue")

            if render_extractor:
                extractor_image_path = output_dir / f"page-{page_number}-extractor.png"
                image.save(extractor_image_path)
                rendered_paths.append(str(extractor_image_path))

    return rendered_paths


def build_parser():
    parser = argparse.ArgumentParser(description="Extract PDF form structure, OCR/LLM fields, and export JSON.")
    # Processing stages:
    # - prepare: raw PDF -> CommonForms PDF with detected AcroForm widgets.
    # - parse: CommonForms PDF -> raw parsed.json plus source-page previews.
    # - clean: apply automatic/manual rules, infer final LLM fields, then export cleaned JSON/previews.
    # - all: run prepare, parse, and clean in that order.
    parser.add_argument(
        "rawdata_dir",
        type=Path,
        help="rawdata/<country> PDF directory; each PDF creates its own outputs/ and preview/ folders",
    )
    parser.add_argument(
        "--preview-height",
        type=int,
        default=2000,
        help="rendered PNG page height in pixels",
    )
    parser.add_argument("--output-json", type=Path, help="full parsed JSON output path")
    parser.add_argument("--output-simple-json", type=Path, help="simplified parsed JSON output path")
    parser.add_argument(
        "--stage",
        choices=("prepare", "parse", "clean", "upload", "all"),
        default="all",
        help=(
            "prepare: create CommonForms PDFs; parse: generate parsed.json and preview PNGs "
            "from existing CommonForms PDFs; clean: apply cleanup/manual rules, infer final LLM fields, "
            "and export cleaned JSON; upload: rebuild upload_data from existing outputs; "
            "all: run all stages (default)"
        ),
    )
    parser.add_argument("--commonforms-model", default="FFDNet-L", help="CommonForms model or model path")
    parser.add_argument("--commonforms-device", default="cpu", help="CommonForms inference device")
    parser.add_argument(
        "--commonforms-confidence",
        type=float,
        default=0.4,
        help="CommonForms detection confidence threshold",
    )
    parser.add_argument("--commonforms-fast", action="store_true", help="enable CommonForms fast mode for FFDNet models")
    parser.add_argument("--run-ocr", action="store_true", help="run OCR for leaf crops; otherwise only cached text is not loaded")
    llm_group = parser.add_mutually_exclusive_group()
    llm_group.add_argument(
        "--run-llm",
        dest="run_llm",
        action="store_true",
        help="run LLM field inference after cleanup/manual rules (default)",
    )
    llm_group.add_argument(
        "--no-run-llm",
        dest="run_llm",
        action="store_false",
        help="disable LLM field inference",
    )
    parser.set_defaults(run_llm=True)
    parser.add_argument("--overwrite-ocr", action="store_true", help="overwrite existing OCR data in memory")
    parser.add_argument(
        "--overwrite-llm",
        action="store_true",
        help="deprecated: clean always reapplies LLM results to the final AcroForms",
    )
    parser.add_argument("--refresh-ocr-cache", action="store_true", help="ignore OCR text cache and call OCR service")
    parser.add_argument("--refresh-llm-cache", action="store_true", help="ignore LLM JSON cache and call LLM service")
    parser.add_argument("--image-dir", type=Path, default=Path("ocr_leaf_images"), help="OCR crop image cache directory")
    parser.add_argument("--text-dir", type=Path, default=Path("ocr_leaf_texts"), help="OCR text cache directory")
    parser.add_argument("--llm-max-workers", type=int, default=10, help="LLM remote call worker count")
    parser.add_argument(
        "--llm-output-dir",
        type=Path,
        default=Path("llm_outputs"),
        help="LLM cache root; each PDF uses <root>/<country>/<pdf-stem>",
    )
    parser.add_argument("--print-trees", action="store_true", help="print parsed tree structure")
    parser.add_argument("--no-manual-rules", action="store_true", help="disable city/PDF-specific manual overrides")
    parser.add_argument(
        "--manual-rules-file",
        type=Path,
        help="explicit city/PDF manual rules JSON override (default: this PDF's outputs/*.manual_rules.json)",
    )
    parser.add_argument(
        "--no-detect-false-positive-acroforms",
        action="store_true",
        help="disable automatic AcroForm false-positive detection",
    )
    parser.add_argument(
        "--remove-false-positive-acroforms",
        action="store_true",
        help="deprecated: the clean stage always removes automatically detected false-positive AcroForms",
    )
    parser.add_argument(
        "--false-positive-text-pad",
        type=float,
        default=1.0,
        help="inner padding used when checking text inside AcroForm rects",
    )
    parser.add_argument(
        "--false-positive-min-text-len",
        type=int,
        default=1,
        help="minimum native text length required to flag a false-positive AcroForm",
    )
    parser.add_argument("--write-styled-pdf", action="store_true", help="write a PDF with textbox default styles")
    parser.add_argument("--styled-pdf", type=Path, help="styled PDF output path")
    return parser


def build_config(
    args,
    pdf_path: Path,
    output_dir: Path | None = None,
    llm_infer_dir: Path | None = None,
):
    output_json = args.output_json
    output_simple_json = args.output_simple_json
    styled_pdf = args.styled_pdf

    if output_dir is not None:
        output_dir.mkdir(parents=True, exist_ok=True)
        output_json = output_dir / f"{pdf_path.stem}.parsed.json"
        output_simple_json = output_dir / f"{pdf_path.stem}.parsed.simple.json"
        if args.write_styled_pdf:
            styled_pdf = output_dir / f"{pdf_path.stem}_textbox_defaults.pdf"

    return PipelineConfig(
        pdf_path=pdf_path,
        output_json=output_json,
        output_simple_json=output_simple_json,
        defer_simple_json=True,
        styled_pdf=styled_pdf,
        run_ocr=args.run_ocr,
        run_llm=args.run_llm,
        overwrite_ocr=args.overwrite_ocr,
        overwrite_llm=args.overwrite_llm,
        refresh_ocr_cache=args.refresh_ocr_cache,
        refresh_llm_cache=args.refresh_llm_cache,
        image_dir=args.image_dir,
        text_dir=args.text_dir,
        llm_infer_dir=llm_infer_dir or args.llm_output_dir,
        llm_max_workers=args.llm_max_workers,
        print_trees=args.print_trees,
        apply_manual_rules=not args.no_manual_rules,
        manual_rules_path=args.manual_rules_file,
        write_styled_pdf=args.write_styled_pdf,
        detect_false_positive_acroforms=not args.no_detect_false_positive_acroforms,
        remove_false_positive_acroforms=args.remove_false_positive_acroforms,
        false_positive_text_pad=args.false_positive_text_pad,
        false_positive_min_text_len=args.false_positive_min_text_len,
        field_example_overrides=(
            JAPAN_NAME_FIELD_EXAMPLE_OVERRIDES
            if country_dir_for_rawdata(args.rawdata_dir).name.casefold() == "japan"
            else None
        ),
    )


def iter_raw_pdfs(rawdata_dir: Path):
    """Yield source PDFs directly under a country rawdata directory."""
    if not rawdata_dir.is_dir():
        raise FileNotFoundError(f"rawdata directory does not exist: {rawdata_dir}")
    yield from sorted(path for path in rawdata_dir.iterdir() if path.is_file() and path.suffix.lower() == ".pdf")


def country_dir_for_rawdata(rawdata_dir: Path) -> Path:
    return rawdata_dir.parent if rawdata_dir.name == "rawdata" else rawdata_dir


def llm_infer_dir_for_raw_pdf(rawdata_dir: Path, raw_pdf_path: Path, llm_root: Path) -> Path:
    """Isolate LLM cache artifacts by country and source PDF version."""
    country_name = country_dir_for_rawdata(rawdata_dir).name
    return Path(llm_root) / country_name / raw_pdf_path.stem


def result_dirs_for_raw_pdf(pdf_path: Path, rawdata_dir: Path) -> tuple[Path, Path]:
    """Return the outputs and preview directories for one raw source PDF."""
    # data/<country>/rawdata -> data/<country>/<pdf-stem>, while a directory
    # such as rawdata/<country> keeps its result folders inside that country.
    country_dir = country_dir_for_rawdata(rawdata_dir)
    result_dir = country_dir / pdf_path.stem
    return result_dir / "outputs", result_dir / "preview"


def commonforms_pdf_path(raw_pdf_path: Path, outputs_dir: Path) -> Path:
    """Return the CommonForms PDF location associated with one raw source PDF."""
    return outputs_dir.parent / "commonforms" / raw_pdf_path.name


def require_valid_pdf(pdf_path: Path, description: str = "PDF") -> Path:
    """Reject missing, empty, or obviously invalid PDF artifacts early."""
    pdf_path = Path(pdf_path)
    if not pdf_path.is_file():
        raise FileNotFoundError(f"{description} does not exist: {pdf_path}")
    size = pdf_path.stat().st_size
    with pdf_path.open("rb") as pdf_file:
        header = pdf_file.read(5)
    if size == 0:
        raise RuntimeError(f"{description} is empty (0 bytes): {pdf_path}")
    if header != b"%PDF-":
        raise RuntimeError(
            f"{description} is not a valid PDF (missing %PDF- header, size={size} bytes): {pdf_path}"
        )
    return pdf_path


PAGE_PREVIEW_PATTERN = re.compile(r"page-\d+\.png")


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source_file:
        for chunk in iter(lambda: source_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_upload_data(
    rawdata_dir: Path,
    raw_pdf_paths: list[Path],
    upload_root: Path | None = None,
) -> dict:
    """Build the upload-only subset for one country without copying rawdata."""
    country_dir = country_dir_for_rawdata(rawdata_dir)
    upload_root = upload_root or Path(__file__).resolve().parent / "upload_data"
    upload_root.mkdir(parents=True, exist_ok=True)

    country_upload_dir = upload_root / country_dir.name
    staging_dir = Path(tempfile.mkdtemp(prefix=f".{country_dir.name}-", dir=upload_root))
    copied_paths: list[str] = []
    verified_files = 0
    acroform_sync: list[dict] = []

    def copy_file(source: Path, relative_destination: Path) -> None:
        nonlocal verified_files
        if not source.is_file():
            raise FileNotFoundError(f"upload source file does not exist: {source}")
        destination = staging_dir / relative_destination
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        if file_sha256(source) != file_sha256(destination):
            raise RuntimeError(f"upload copy verification failed: {source} -> {destination}")
        verified_files += 1
        copied_paths.append(str(Path(country_dir.name) / relative_destination))

    try:
        for raw_pdf_path in raw_pdf_paths:
            outputs_dir, preview_dir = result_dirs_for_raw_pdf(raw_pdf_path, rawdata_dir)
            document_relative_dir = Path(raw_pdf_path.stem)

            prepared_pdf_path = commonforms_pdf_path(raw_pdf_path, outputs_dir)
            copy_file(
                prepared_pdf_path,
                document_relative_dir / "commonforms" / prepared_pdf_path.name,
            )

            simple_json_path = outputs_dir / f"{raw_pdf_path.stem}.parsed.simple.json"
            copy_file(
                simple_json_path,
                document_relative_dir / "outputs" / simple_json_path.name,
            )

            uploaded_pdf_path = (
                staging_dir / document_relative_dir / "commonforms" / prepared_pdf_path.name
            )
            uploaded_json_path = (
                staging_dir / document_relative_dir / "outputs" / simple_json_path.name
            )
            sync_result = synchronize_pdf_acroforms(uploaded_pdf_path, uploaded_json_path)
            sync_result["pdf"] = str(
                country_upload_dir
                / document_relative_dir
                / "commonforms"
                / prepared_pdf_path.name
            )
            sync_result["source_pdf"] = sync_result["pdf"]
            acroform_sync.append(sync_result)
            print(
                f"[upload:acroforms] pdf={raw_pdf_path.name} "
                f"before={sync_result['before']} expected={sync_result['expected']} "
                f"adjusted={sync_result['adjusted']}",
                flush=True,
            )

            preview_paths = sorted(
                path
                for path in preview_dir.iterdir()
                if path.is_file() and PAGE_PREVIEW_PATTERN.fullmatch(path.name)
            ) if preview_dir.is_dir() else []
            for preview_path in preview_paths:
                copy_file(
                    preview_path,
                    document_relative_dir / "preview" / preview_path.name,
                )

        if country_upload_dir.exists():
            shutil.rmtree(country_upload_dir)
        staging_dir.replace(country_upload_dir)
    except Exception:
        shutil.rmtree(staging_dir, ignore_errors=True)
        raise

    return {
        "path": str(country_upload_dir),
        "copied_files": len(copied_paths),
        "verified_files": verified_files,
        "files": copied_paths,
        "acroform_checked_pdfs": len(acroform_sync),
        "acroform_adjusted_pdfs": sum(item["adjusted"] for item in acroform_sync),
        "acroform_sync": acroform_sync,
    }


def prepare_commonforms_pdf(raw_pdf_path: Path, prepared_pdf_path: Path, args) -> Path:
    """Create a fillable PDF whose widgets are the source of parsed AcroForms."""
    require_valid_pdf(raw_pdf_path, "raw source PDF")
    # Resolve before changing the subprocess cwd.  When this script is invoked
    # as ``python main.py`` (or through runpy), ``__file__`` may be relative;
    # passing ``PYTHONPATH=commonforms`` while also using ``cwd=commonforms``
    # points at the nested package directory and silently imports the globally
    # installed CommonForms instead of this workspace's implementation.
    local_commonforms_root = Path(__file__).resolve().with_name("commonforms")
    if not local_commonforms_root.is_dir():
        raise FileNotFoundError(f"CommonForms directory does not exist: {local_commonforms_root}")

    prepared_pdf_path.parent.mkdir(parents=True, exist_ok=True)
    command = [
        "commonforms",
        str(raw_pdf_path.resolve()),
        str(prepared_pdf_path.resolve()),
        "--model",
        args.commonforms_model,
        "--device",
        args.commonforms_device,
        "--confidence",
        str(args.commonforms_confidence),
        "--keep-existing-fields",
    ]
    if args.commonforms_fast:
        command.append("--fast")
    environment = os.environ.copy()
    existing_pythonpath = environment.get("PYTHONPATH")
    environment["PYTHONPATH"] = os.pathsep.join(
        value for value in (str(local_commonforms_root), existing_pythonpath) if value
    )
    try:
        subprocess.run(command, cwd=local_commonforms_root, check=True, env=environment)
    except FileNotFoundError as exc:
        raise RuntimeError(
            "The `commonforms` command is not available. Run this command from an environment "
            "where `cd commonforms && commonforms <input.pdf> <output.pdf>` succeeds."
        ) from exc
    try:
        return require_valid_pdf(prepared_pdf_path, "CommonForms output PDF")
    except (FileNotFoundError, RuntimeError) as exc:
        raise RuntimeError(f"CommonForms completed without creating a usable PDF: {prepared_pdf_path}") from exc


def require_commonforms_pdf(raw_pdf_path: Path, prepared_pdf_path: Path) -> Path:
    """Require the prepared PDF before stages that consume its AcroForm widgets."""
    try:
        return require_valid_pdf(prepared_pdf_path, "CommonForms PDF")
    except (FileNotFoundError, RuntimeError) as exc:
        raise RuntimeError(
            f"CommonForms PDF is missing or invalid: {prepared_pdf_path}. "
            f"Restore a valid prepared PDF or run `python main.py {raw_pdf_path.parent} --stage prepare` first."
        ) from exc


def render_pdf_preview(pdf_path: Path, preview_dir: Path, preview_height: int) -> list[str]:
    """Stage 1 preview: render prepared PDF pages only, without extractor boxes."""
    return render_preview_images(
        pdf_path, preview_dir, {}, preview_height, render_pages=True, render_extractor=False
    )


def finalize_extractor_and_simple_json(
    source_pdf_path: Path,
    pdf_path: Path,
    preview_dir: Path,
    config: PipelineConfig,
    summaries: dict,
    preview_height: int,
) -> None:
    """Write final JSON, rebuild the PDF form layer, then render extractor boxes."""
    simple_path = config.output_simple_json or pdf_path.with_suffix(".parsed.simple.json")
    post_json_path = Path(summaries["export"]["post_json"])
    post_payload = json.loads(post_json_path.read_text(encoding="utf-8"))
    source_pdf = post_payload.get("source_pdf")
    if not source_pdf or Path(source_pdf).resolve() != pdf_path.resolve():
        raise RuntimeError(
            f"post JSON source mismatch: expected={pdf_path} actual={source_pdf!r}"
        )
    simple_json_path, simple_payload = save_simplified_parsed_pdf_json(
        post_payload, simple_path
    )
    written_simple_payload = json.loads(simple_json_path.read_text(encoding="utf-8"))
    if written_simple_payload != simple_payload:
        raise RuntimeError(f"simple JSON verification failed: {simple_json_path}")
    if written_simple_payload.get("summary", {}).get("llm_cache_dir") != str(
        config.llm_infer_dir
    ) and config.run_llm:
        raise RuntimeError(f"simple JSON LLM cache metadata mismatch: {simple_json_path}")
    summaries["export"]["simple_json"] = str(simple_json_path)
    summaries["export"]["simple_source_post_json"] = str(post_json_path)
    summaries["export"]["simple_source_post_sha256"] = file_sha256(post_json_path)
    summaries["export"]["simple_json_verified"] = True
    summaries["acroform_rebuild"] = rebuild_pdf_acroforms(
        source_pdf_path,
        pdf_path,
        simple_json_path,
    )
    summaries["preview"] = {
        "paths": render_preview_images(
            pdf_path,
            preview_dir,
            load_acroform_annotations(simple_json_path),
            preview_height,
            render_pages=False,
            render_extractor=True,
        )
    }


def process_raw_pdf(args, raw_pdf_path: Path) -> dict:
    country_name = country_dir_for_rawdata(args.rawdata_dir).name
    llm_infer_dir = llm_infer_dir_for_raw_pdf(
        args.rawdata_dir, raw_pdf_path, args.llm_output_dir
    )
    print(f"[pdf:start] country={country_name} pdf={raw_pdf_path.name}", flush=True)

    outputs_dir, preview_dir = result_dirs_for_raw_pdf(raw_pdf_path, args.rawdata_dir)
    prepared_pdf_path = commonforms_pdf_path(raw_pdf_path, outputs_dir)
    summaries = {"status": "ok", "country": country_name, "source_pdf": str(raw_pdf_path)}

    if args.stage in ("prepare", "all"):
        prepared_pdf_path = prepare_commonforms_pdf(raw_pdf_path, prepared_pdf_path, args)
        summaries["prepare_stage"] = {
            "source_pdf": str(raw_pdf_path),
            "prepared_pdf": str(prepared_pdf_path),
        }
    if args.stage in ("parse", "clean"):
        prepared_pdf_path = require_commonforms_pdf(raw_pdf_path, prepared_pdf_path)

    config = build_config(
        args,
        prepared_pdf_path,
        outputs_dir,
        llm_infer_dir=llm_infer_dir,
    )
    if args.stage in ("parse", "all"):
        _, parse_summaries = run_pipeline(config)
        parse_summaries["preview"] = {
            "paths": render_pdf_preview(prepared_pdf_path, preview_dir, args.preview_height)
        }
        summaries["parse_stage"] = parse_summaries
    if args.stage in ("clean", "all"):
        print(f"[llm] cache_dir={llm_infer_dir}", flush=True)
        _, cleanup_summaries = run_cleanup_pipeline(config)
        finalize_extractor_and_simple_json(
            raw_pdf_path,
            prepared_pdf_path,
            preview_dir,
            config,
            cleanup_summaries,
            args.preview_height,
        )
        summaries["cleanup_stage"] = cleanup_summaries

    fields = summaries.get("cleanup_stage", {}).get("fields", {})
    print(
        f"[pdf:done] country={country_name} pdf={raw_pdf_path.name} "
        f"llm_named={fields.get('llm_named', 0)} fallback={fields.get('fallback', 0)}",
        flush=True,
    )
    return summaries


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.output_json or args.output_simple_json or args.styled_pdf:
        parser.error("custom output paths are not supported for a rawdata directory run")

    results = {}
    failures = []
    raw_pdf_paths = list(iter_raw_pdfs(args.rawdata_dir))
    if args.stage != "upload":
        for raw_pdf_path in raw_pdf_paths:
            try:
                results[raw_pdf_path.name] = process_raw_pdf(args, raw_pdf_path)
            except Exception as exc:
                failure = {
                    "pdf": raw_pdf_path.name,
                    "error_type": type(exc).__name__,
                    "error": str(exc),
                }
                failures.append(failure)
                results[raw_pdf_path.name] = {"status": "failed", **failure}
                print(
                    f"[pdf:failed] pdf={raw_pdf_path.name} "
                    f"error={failure['error_type']}: {failure['error']}",
                    flush=True,
                )

    if args.stage in ("upload", "all"):
        if failures:
            results["upload_data"] = {
                "status": "skipped",
                "reason": "one_or_more_pdfs_failed",
            }
        else:
            results["upload_data"] = build_upload_data(args.rawdata_dir, raw_pdf_paths)

    results["run_summary"] = {
        "total_pdfs": len(raw_pdf_paths),
        "succeeded": len(raw_pdf_paths) - len(failures),
        "failed": len(failures),
        "failures": failures,
    }
    print(json.dumps(results, ensure_ascii=False, indent=2))
    if failures:
        raise MultiPDFProcessingError(failures, upload_skipped=args.stage == "all")
    return results


if __name__ == "__main__":
    main()
