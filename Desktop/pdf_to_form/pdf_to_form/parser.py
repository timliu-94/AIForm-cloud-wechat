from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Tuple

import pdfplumber
from pypdf import PdfReader

from .acroforms import (
    EXTEND_TOL,
    LINE_THICKNESS,
    MERGE_TOL,
    extract_acroforms_by_page,
    extract_acroforms_in_box,
)

TEXT_PAD = 1.0


@dataclass
class BoxNode:
    bbox: Tuple[float, float, float, float]
    page: int
    text: str = ""
    acroforms: List[Dict[str, Any]] = field(default_factory=list)
    ocr_nodes: List[Dict[str, Any]] = field(default_factory=list)
    children: List["BoxNode"] = field(default_factory=list)
    is_need_filled: bool = True
    is_handwritting: bool = False

    @property
    def is_leaf(self) -> bool:
        return not self.children

    def to_dict(self):
        d = {"bbox": [round(v, 2) for v in self.bbox], "page": self.page, "is_leaf": self.is_leaf}
        if self.is_leaf:
            d["text"] = self.text
            d["is_need_filled"] = self.is_need_filled
            d["is_handwritting"] = self.is_handwritting
            d["acroforms"] = [
                {
                    **form,
                    "is_acro_need_filled": form.get("is_acro_need_filled", self.is_need_filled),
                    "is_acro_handwritting": form.get("is_acro_handwritting", self.is_handwritting),
                }
                for form in self.acroforms
            ]
            d["ocr_nodes"] = self.ocr_nodes
        else:
            d["children"] = [c.to_dict() for c in self.children]
        return d


def extract_lines(page):
    h_lines, v_lines = [], []
    for r in page.rects:
        if not r.get("fill"):
            continue
        w, h = r["width"], r["height"]
        if h < LINE_THICKNESS and w >= LINE_THICKNESS:
            h_lines.append(((r["y0"] + r["y1"]) / 2, r["x0"], r["x1"]))
        elif w < LINE_THICKNESS and h >= LINE_THICKNESS:
            v_lines.append(((r["x0"] + r["x1"]) / 2, r["y0"], r["y1"]))
    for r in page.rects:
        if r.get("stroke") and not r.get("fill"):
            x0, y0, x1, y1 = r["x0"], r["y0"], r["x1"], r["y1"]
            h_lines.extend([(y0, x0, x1), (y1, x0, x1)])
            v_lines.extend([(x0, y0, y1), (x1, y0, y1)])
    return merge_lines(h_lines), merge_lines(v_lines)


def extract_closed_rects(page):
    """Return visible closed rectangles using their native PDF coordinates.

    A stroked PDF ``rect`` is already a complete frame. Reconstructing it from
    globally merged edge lines can move a side when nearby rectangles have
    almost-aligned borders, so direct rectangles must take priority.
    """
    frames = []
    for rect in page.rects:
        if not rect.get("stroke") or rect.get("fill"):
            continue
        x0, y0, x1, y1 = (float(rect[key]) for key in ("x0", "y0", "x1", "y1"))
        x0, x1 = sorted((x0, x1))
        y0, y1 = sorted((y0, y1))
        if x1 - x0 < LINE_THICKNESS or y1 - y0 < LINE_THICKNESS:
            continue
        frames.append((x0, y0, x1, y1))
    return frames


def merge_lines(lines):
    if not lines:
        return []
    lines = sorted(lines, key=lambda t: (t[0], t[1]))
    clusters = []
    cur = [lines[0]]
    for line in lines[1:]:
        if abs(line[0] - cur[-1][0]) <= MERGE_TOL:
            cur.append(line)
        else:
            clusters.append(cur)
            cur = [line]
    clusters.append(cur)

    merged = []
    for cluster in clusters:
        coord = sum(t[0] for t in cluster) / len(cluster)
        segs = sorted((t[1], t[2]) for t in cluster)
        out = [list(segs[0])]
        for start, end in segs[1:]:
            if start <= out[-1][1] + MERGE_TOL:
                out[-1][1] = max(out[-1][1], end)
            else:
                out.append([start, end])
        merged.extend((coord, start, end) for start, end in out)
    return merged


def strictly_contains(outer, inner, eps=0.5):
    ox0, oy0, ox1, oy1 = outer
    ix0, iy0, ix1, iy1 = inner
    if ox0 <= ix0 + eps and oy0 <= iy0 + eps and ox1 >= ix1 - eps and oy1 >= iy1 - eps:
        return (ox1 - ox0) * (oy1 - oy0) > (ix1 - ix0) * (iy1 - iy0) + eps
    return False


def index_lines(h_lines, v_lines):
    h_by_y, v_by_x = {}, {}
    for y, start, end in h_lines:
        h_by_y.setdefault(round(y, 2), []).append((start, end))
    for x, start, end in v_lines:
        v_by_x.setdefault(round(x, 2), []).append((start, end))
    return h_by_y, v_by_x


def has_seg(buckets, key, lo, hi):
    for k, segs in buckets.items():
        if abs(k - key) <= MERGE_TOL:
            for start, end in segs:
                if start <= lo + EXTEND_TOL and end >= hi - EXTEND_TOL:
                    return True
    return False


def boxes_match(first, second, tol=EXTEND_TOL):
    if all(abs(a - b) <= tol for a, b in zip(first, second)):
        return True
    ax0, ay0, ax1, ay1 = first
    bx0, by0, bx1, by1 = second
    intersection = max(0.0, min(ax1, bx1) - max(ax0, bx0)) * max(
        0.0, min(ay1, by1) - max(ay0, by0)
    )
    smaller_area = min((ax1 - ax0) * (ay1 - ay0), (bx1 - bx0) * (by1 - by0))
    return smaller_area > 0 and intersection / smaller_area >= 0.95


def find_outer_frames(h_lines, v_lines, closed_rects=None):
    direct_frames = list(closed_rects or [])
    xs = sorted({round(v[0], 2) for v in v_lines})
    ys = sorted({round(h[0], 2) for h in h_lines})
    h_by_y, v_by_x = index_lines(h_lines, v_lines)
    inferred_frames = []
    if h_lines and v_lines:
        for i in range(len(xs)):
            for j in range(i + 1, len(xs)):
                x0, x1 = xs[i], xs[j]
                for k in range(len(ys)):
                    for l in range(k + 1, len(ys)):
                        y0, y1 = ys[k], ys[l]
                        if (
                            has_seg(h_by_y, y0, x0, x1)
                            and has_seg(h_by_y, y1, x0, x1)
                            and has_seg(v_by_x, x0, y0, y1)
                            and has_seg(v_by_x, x1, y0, y1)
                        ):
                            inferred_frames.append((x0, y0, x1, y1))

    # Keep the exact direct rectangle when the line reconstruction found an
    # approximately equivalent frame.
    candidates = direct_frames + [
        frame
        for frame in inferred_frames
        if not any(boxes_match(frame, direct) for direct in direct_frames)
    ]
    return [b for b in candidates if not any(strictly_contains(o, b) for o in candidates if o != b)]


def spanning_lines(seg_buckets, span_lo, span_hi, key_min, key_max):
    out = []
    for k, segs in seg_buckets.items():
        if not (key_min + EXTEND_TOL < k < key_max - EXTEND_TOL):
            continue
        for start, end in segs:
            if start <= span_lo + EXTEND_TOL and end >= span_hi - EXTEND_TOL:
                out.append(k)
                break
    return sorted(out)


def extract_text_in_box(page, box):
    x0, y0, x1, y1 = box
    top = page.height - y1 + TEXT_PAD
    bottom = page.height - y0 - TEXT_PAD
    crop = page.within_bbox((x0 + TEXT_PAD, top, x1 - TEXT_PAD, bottom), relative=False, strict=False)
    return (crop.extract_text(x_tolerance=2, y_tolerance=3) or "").strip()


def split_box(box, h_by_y, v_by_x, page, page_index, acroforms_by_page=None):
    x0, y0, x1, y1 = box
    inner_h = spanning_lines(h_by_y, x0, x1, y0, y1)
    if inner_h:
        node = BoxNode(bbox=box, page=page_index)
        ys = [y0] + inner_h + [y1]
        node.children = [split_box((x0, a, x1, b), h_by_y, v_by_x, page, page_index, acroforms_by_page) for a, b in zip(ys, ys[1:])]
        node.children.sort(key=lambda c: -c.bbox[3])
        return node

    inner_v = spanning_lines(v_by_x, y0, y1, x0, x1)
    if inner_v:
        node = BoxNode(bbox=box, page=page_index)
        xs = [x0] + inner_v + [x1]
        node.children = [split_box((a, y0, b, y1), h_by_y, v_by_x, page, page_index, acroforms_by_page) for a, b in zip(xs, xs[1:])]
        node.children.sort(key=lambda c: c.bbox[0])
        return node

    leaf = BoxNode(bbox=box, page=page_index)
    leaf.text = extract_text_in_box(page, box)
    leaf.acroforms = extract_acroforms_in_box((acroforms_by_page or {}).get(page_index, []), box)
    return leaf


def count_leaves(node):
    if node.is_leaf:
        return 1
    return sum(count_leaves(c) for c in node.children)


def parse_pdf(path, manual_specs=None, removal_specs=None):
    result = []
    acroforms_by_page = extract_acroforms_by_page(path, manual_specs=manual_specs, removal_specs=removal_specs)
    with pdfplumber.open(path) as pdf:
        pypdf_page_count = len(PdfReader(path).pages)
        pdfplumber_page_count = len(pdf.pages)
        if pdfplumber_page_count != pypdf_page_count:
            raise RuntimeError(
                "PDF parser page count mismatch: "
                f"PyPDF={pypdf_page_count}, pdfplumber={pdfplumber_page_count}, file={path}. "
                "The PDF may contain broken metadata or page references; regenerate the CommonForms PDF."
            )
        for i, page in enumerate(pdf.pages):
            h_lines, v_lines = extract_lines(page)
            h_by_y, v_by_x = index_lines(h_lines, v_lines)
            frames = find_outer_frames(
                h_lines,
                v_lines,
                closed_rects=extract_closed_rects(page),
            )
            roots = [split_box(f, h_by_y, v_by_x, page, i + 1, acroforms_by_page) for f in frames]
            roots.sort(key=lambda r: (-r.bbox[3], r.bbox[0]))
            result.append(
                {
                    "page": i + 1,
                    "size": (round(page.width, 2), round(page.height, 2)),
                    "n_frames": len(frames),
                    "n_leaves": sum(count_leaves(r) for r in roots),
                    "n_acroforms": len(acroforms_by_page.get(i + 1, [])),
                    "trees": [r.to_dict() for r in roots],
                }
            )
    return result


def print_tree(node, indent=0):
    pad = "  " * indent
    bbox = ", ".join(f"{v:.1f}" for v in node["bbox"])
    if node["is_leaf"]:
        text = node["text"].replace("\n", " / ")
        if len(text) > 80:
            text = text[:77] + "..."
        forms = node.get("acroforms", [])
        form_names = ", ".join(f["name"] for f in forms[:3])
        if len(forms) > 3:
            form_names += ", ..."
        suffix = f" acroforms={len(forms)} [{form_names}]" if forms else ""
        print(f"{pad}- [{bbox}] {text!r}{suffix}")
    else:
        print(f"{pad}+ [{bbox}] ({len(node['children'])} children)")
        for child in node["children"]:
            print_tree(child, indent + 1)
