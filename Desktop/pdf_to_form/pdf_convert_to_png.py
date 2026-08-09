from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw

try:
    import fitz  # PyMuPDF
except ImportError as exc:
    raise SystemExit(
        "Missing dependency: PyMuPDF. Install it with `python3 -m pip install pymupdf`."
    ) from exc


DEFAULT_DATA_DIR = Path("data")


def save_acroform_preview(pixmap, page_height: float, scale: float, acroforms, output_path: Path) -> None:
    """Draw AcroForm rectangles using the same PDF-to-image coordinate conversion as the notebook."""
    image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
    draw = ImageDraw.Draw(image)

    for form in acroforms:
        x0, y0, x1, y1 = form["rect"]
        box = (
            round(x0 * scale),
            round((page_height - y1) * scale),
            round(x1 * scale),
            round((page_height - y0) * scale),
        )
        draw.rectangle(box, outline="red", width=2)
        draw.text((box[0] + 2, box[1] + 2), form.get("name", ""), fill="red")

    image.save(output_path)
    print(f"{output_path}: {pixmap.width}x{pixmap.height}, acroforms={len(acroforms)}")


def load_acroforms_by_page(parsed_json_path: Path) -> dict[int, list[dict]]:
    if not parsed_json_path.is_file():
        raise FileNotFoundError(f"parsed JSON does not exist: {parsed_json_path}")

    payload = json.loads(parsed_json_path.read_text(encoding="utf-8"))
    return {
        int(page["page"]): page.get("acroforms", [])
        for page in payload.get("pages", [])
        if "page" in page
    }


def render_pdf(
    pdf_path: Path,
    output_dir: Path,
    target_height: int,
    prefix: str,
    acroforms_by_page: dict[int, list[dict]],
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    with fitz.open(pdf_path) as doc:
        for page_index in range(doc.page_count):
            page = doc[page_index]
            scale = target_height / page.rect.height
            pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
            output_path = output_dir / f"{prefix}{page_index + 1}.png"
            pixmap.save(output_path)
            print(f"{output_path}: {pixmap.width}x{pixmap.height}")
            extractor_output_path = output_dir / f"{prefix}{page_index + 1}-extractor.png"
            save_acroform_preview(
                pixmap,
                page.rect.height,
                scale,
                acroforms_by_page.get(page_index + 1, []),
                extractor_output_path,
            )


def iter_country_pdfs(data_dir: Path):
    """Yield source PDFs from data/<country>/rawdata."""
    if not data_dir.is_dir():
        raise FileNotFoundError(f"data directory does not exist: {data_dir}")

    for country_dir in sorted(path for path in data_dir.iterdir() if path.is_dir()):
        rawdata_dir = country_dir / "rawdata"
        if rawdata_dir.is_dir():
            yield country_dir.name, sorted(rawdata_dir.glob("*.pdf"))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Render country visa PDF pages to PNG preview images."
    )
    parser.add_argument("--pdf", type=Path, help="Source PDF path; omit to render all country PDFs.")
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=DEFAULT_DATA_DIR,
        help="Root directory containing country/version data (default: data).",
    )
    parser.add_argument(
        "--target-height",
        type=int,
        default=2000,
        help="Rendered page height in pixels.",
    )
    parser.add_argument(
        "--prefix",
        default="page-",
        help="Output filename prefix. Page number and .png are appended.",
    )
    args = parser.parse_args()

    if args.pdf is not None:
        outputs_dir = args.pdf.parent
        parsed_json_path = outputs_dir / f"{args.pdf.stem}.parsed.simple.json"
        render_pdf(
            args.pdf,
            outputs_dir.parent / "preview",
            args.target_height,
            args.prefix,
            load_acroforms_by_page(parsed_json_path),
        )
        return

    for country, pdf_paths in iter_country_pdfs(args.data_dir):
        for pdf_path in pdf_paths:
            version_dir = args.data_dir / country / pdf_path.stem
            pdf_output_dir = version_dir / "preview"
            parsed_json_path = version_dir / "outputs" / f"{pdf_path.stem}.parsed.simple.json"
            render_pdf(
                pdf_path,
                pdf_output_dir,
                args.target_height,
                "page-",
                load_acroforms_by_page(parsed_json_path),
            )


if __name__ == "__main__":
    main()
