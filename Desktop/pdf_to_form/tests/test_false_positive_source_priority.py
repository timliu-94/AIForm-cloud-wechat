from pypdf import PdfWriter

from pdf_to_form.false_positive import (
    detect_acroform_text_overlap_in_payload,
    remove_detected_false_positive_acroforms_from_payload,
)


def test_false_positive_cleanup_does_not_flag_original_acroforms(tmp_path, monkeypatch):
    pdf_path = tmp_path / "form.pdf"
    writer = PdfWriter()
    writer.add_blank_page(width=600, height=800)
    with pdf_path.open("wb") as output:
        writer.write(output)

    payload = {
        "pages": [
            {
                "page": 1,
                "leaf_nodes": [
                    {
                        "bbox": [0, 0, 600, 800],
                        "acroforms": [
                            {
                                "name": "native",
                                "page": 1,
                                "rect": [10, 10, 100, 30],
                                "field_type": "/Tx",
                                "acroform_source": "original",
                            },
                            {
                                "name": "detected",
                                "page": 1,
                                "rect": [10, 40, 100, 60],
                                "field_type": "/Tx",
                                "acroform_source": "commonforms",
                            },
                        ],
                    }
                ],
            }
        ]
    }
    monkeypatch.setattr(
        "pdf_to_form.false_positive.char_text_in_pdf_rect",
        lambda *_args, **_kwargs: "static text",
    )

    detections = detect_acroform_text_overlap_in_payload(pdf_path, payload, log=False)

    assert [detection["name"] for detection in detections] == ["detected"]
    native, detected = payload["pages"][0]["leaf_nodes"][0]["acroforms"]
    assert "suspected_false_positive" not in native
    assert detected["suspected_false_positive"] is True


def test_even_explicit_false_positive_detection_cannot_remove_original():
    native = {
        "name": "native",
        "page": 1,
        "rect": [10, 10, 100, 30],
        "acroform_source": "original",
    }
    payload = {
        "summary": {},
        "pages": [
            {
                "page": 1,
                "n_acroforms": 1,
                "acroforms": [dict(native)],
                "leaf_nodes": [{"acroforms": [dict(native)]}],
            }
        ],
    }

    removed = remove_detected_false_positive_acroforms_from_payload(
        payload,
        [{"page": 1, "name": "native"}],
    )

    assert removed == 0
    assert payload["pages"][0]["acroforms"] == [native]
    assert payload["pages"][0]["leaf_nodes"][0]["acroforms"] == [native]
