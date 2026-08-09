from types import SimpleNamespace

from pdf_to_form.parser import boxes_match, extract_closed_rects, find_outer_frames


def test_native_closed_rect_wins_when_merged_edges_no_longer_close():
    native_rect = (62.8223, 403.6211, 559.0996, 480.4654)
    page = SimpleNamespace(
        rects=[
            {
                "x0": native_rect[0],
                "y0": native_rect[1],
                "x1": native_rect[2],
                "y1": native_rect[3],
                "width": native_rect[2] - native_rect[0],
                "height": native_rect[3] - native_rect[1],
                "fill": False,
                "stroke": True,
            }
        ]
    )
    # This reproduces the Japan hand-drawn PDF: nearby right borders were
    # averaged to 561.04, beyond the 1.5-point closure tolerance of the native
    # top and bottom edges ending at 559.10.
    h_lines = [
        (native_rect[1], native_rect[0], native_rect[2]),
        (native_rect[3], native_rect[0], native_rect[2]),
    ]
    v_lines = [
        (62.47, native_rect[1], native_rect[3]),
        (561.04, native_rect[1], native_rect[3]),
    ]

    assert find_outer_frames(h_lines, v_lines) == []
    assert find_outer_frames(
        h_lines,
        v_lines,
        closed_rects=extract_closed_rects(page),
    ) == [native_rect]


def test_filled_rect_is_not_treated_as_a_layout_frame():
    page = SimpleNamespace(
        rects=[
            {
                "x0": 10,
                "y0": 20,
                "x1": 110,
                "y1": 120,
                "width": 100,
                "height": 100,
                "fill": True,
                "stroke": False,
            }
        ]
    )

    assert extract_closed_rects(page) == []


def test_native_rect_replaces_nearly_identical_reconstructed_frame():
    native_rect = (60.70, 566.82, 562.81, 624.57)
    reconstructed = (59.42, 566.82, 561.04, 624.57)

    assert boxes_match(native_rect, reconstructed)
