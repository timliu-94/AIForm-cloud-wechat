from __future__ import annotations

from pathlib import Path

import pdfplumber

from .traversal import iter_page_leaf_nodes

PADDLE_OCR_TASK_TYPE = "ocr"
OCR_IMAGE_DIR = Path("ocr_leaf_images")
OCR_TEXT_DIR = Path("ocr_leaf_texts")
OCR_RESOLUTION = 180
OCR_BBOX_PAD = 2.0


def clip(value, lo, hi):
    return max(lo, min(hi, value))


def leaf_cache_key(page_no, leaf_index, bbox):
    bbox_key = "_".join(f"{v:.1f}" for v in bbox).replace("-", "m").replace(".", "p")
    return f"page_{page_no:03d}_leaf_{leaf_index:04d}_{bbox_key}"


def save_leaf_crop_image(pdf_path, page_no, bbox, output_path, resolution=OCR_RESOLUTION, pad=OCR_BBOX_PAD):
    with pdfplumber.open(pdf_path) as pdf:
        page = pdf.pages[page_no - 1]
        page_h = page.height
        image = page.to_image(resolution=resolution).original

    scale = resolution / 72.0
    x0, y0, x1, y1 = bbox
    x0 = clip(x0 - pad, 0, image.width / scale)
    x1 = clip(x1 + pad, 0, image.width / scale)
    y0 = clip(y0 - pad, 0, page_h)
    y1 = clip(y1 + pad, 0, page_h)

    crop = image.crop(
        (
            int(round(x0 * scale)),
            int(round((page_h - y1) * scale)),
            int(round(x1 * scale)),
            int(round((page_h - y0) * scale)),
        )
    )
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    crop.save(output_path)
    return output_path


def normalize_ocr_nodes(ocr_response):
    if not ocr_response:
        return []
    if isinstance(ocr_response, dict) and ocr_response.get("success"):
        return [
            {
                "index": 0,
                "text": ocr_response.get("content", ""),
                "task_type": ocr_response.get("task_type"),
                "processing_time": ocr_response.get("processing_time"),
                "output_format": ocr_response.get("output_format"),
                "source": "remote_ocr",
            }
        ]
    if isinstance(ocr_response, dict):
        return [
            {
                "index": 0,
                "success": False,
                "error": ocr_response.get("error", str(ocr_response)),
                "task_type": ocr_response.get("task_type"),
                "source": "remote_ocr",
            }
        ]
    return [{"index": 0, "text": str(ocr_response), "source": "remote_ocr"}]


def make_cached_ocr_nodes(text, task_type=PADDLE_OCR_TASK_TYPE):
    return [{"index": 0, "text": text, "task_type": task_type, "source": "local_text_cache"}]


def extract_ocr_text(ocr_nodes):
    return "\n".join(
        node.get("text", "").strip()
        for node in ocr_nodes
        if isinstance(node, dict) and node.get("text", "").strip()
    )


def make_default_ocr_client():
    from paddle_ocr_infer import PaddleOCRVL

    return PaddleOCRVL()


def add_ocr_nodes_to_leaves(
    pdf_path,
    parsed_pages,
    ocr_client=None,
    task_type=PADDLE_OCR_TASK_TYPE,
    image_dir=OCR_IMAGE_DIR,
    text_dir=OCR_TEXT_DIR,
    overwrite=False,
    refresh_cache=False,
    verbose=False,
):
    image_dir = Path(image_dir)
    text_dir = Path(text_dir)
    text_dir.mkdir(parents=True, exist_ok=True)

    total = succeeded = cache_hits = remote_calls = 0
    for page_info, leaf in iter_page_leaf_nodes(parsed_pages):
        if leaf.get("ocr_nodes") and not overwrite:
            continue

        total += 1
        page_no = page_info["page"]
        cache_key = leaf_cache_key(page_no, total, leaf["bbox"])
        image_path = image_dir / f"{cache_key}.png"
        text_path = text_dir / f"{cache_key}.txt"

        if text_path.exists() and not refresh_cache:
            ocr_nodes = make_cached_ocr_nodes(text_path.read_text(encoding="utf-8"), task_type=task_type)
            cache_hits += 1
        else:
            if ocr_client is None:
                ocr_client = make_default_ocr_client()
            save_leaf_crop_image(pdf_path, page_no, leaf["bbox"], image_path)
            ocr_nodes = normalize_ocr_nodes(ocr_client.recognize(str(image_path), task_type=task_type, verbose=verbose))
            text_path.write_text(extract_ocr_text(ocr_nodes), encoding="utf-8")
            remote_calls += 1

        leaf["ocr_nodes"] = ocr_nodes
        leaf["ocr_text"] = extract_ocr_text(ocr_nodes)
        leaf["ocr_image"] = str(image_path)
        leaf["ocr_text_file"] = str(text_path)
        if leaf["ocr_text"]:
            succeeded += 1

    return {
        "total_leaves_processed": total,
        "leaves_with_ocr": succeeded,
        "cache_hits": cache_hits,
        "remote_calls": remote_calls,
    }

