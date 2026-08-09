import unittest
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from pypdf import PdfWriter

from main import build_upload_data
from pdf_to_form.acroforms import extract_acroforms_by_page


def write_blank_pdf(path: Path) -> None:
    writer = PdfWriter()
    writer.add_blank_page(width=595, height=842)
    with path.open("wb") as output:
        writer.write(output)
    writer.close()


def write_empty_simple_json(path: Path) -> None:
    path.write_text(
        json.dumps({"pages": [{"page": 1, "acroforms": []}]}),
        encoding="utf-8",
    )


class UploadDataTests(unittest.TestCase):
    def test_builds_country_tree_from_whitelisted_files_only(self):
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            rawdata_dir = root / "data" / "Italy" / "rawdata"
            rawdata_dir.mkdir(parents=True)
            raw_pdf = rawdata_dir / "上海_申根签证申请表（90天以内）.pdf"
            raw_pdf.write_bytes(b"raw PDF must not be copied")

            document_dir = rawdata_dir.parent / raw_pdf.stem
            commonforms_dir = document_dir / "commonforms"
            outputs_dir = document_dir / "outputs"
            preview_dir = document_dir / "preview"
            commonforms_dir.mkdir(parents=True)
            outputs_dir.mkdir()
            preview_dir.mkdir()

            prepared_pdf = commonforms_dir / raw_pdf.name
            write_blank_pdf(prepared_pdf)
            simple_json = outputs_dir / f"{raw_pdf.stem}.parsed.simple.json"
            write_empty_simple_json(simple_json)
            (outputs_dir / f"{raw_pdf.stem}.parsed.json").write_text("{}", encoding="utf-8")
            (outputs_dir / f"{raw_pdf.stem}.parsed.post.json").write_text(
                '{"field_name":"internal-only"}', encoding="utf-8"
            )
            (outputs_dir / f"{raw_pdf.stem}.manual_rules.json").write_text("{}", encoding="utf-8")
            (preview_dir / "page-1.png").write_bytes(b"page 1")
            (preview_dir / "page-2.png").write_bytes(b"page 2")
            (preview_dir / "page-1-extractor.png").write_bytes(b"extractor")
            (document_dir / ".DS_Store").write_bytes(b"metadata")

            upload_root = root / "upload_data"
            summary = build_upload_data(rawdata_dir, [raw_pdf], upload_root)

            country_upload_dir = upload_root / "Italy"
            copied_files = sorted(
                path.relative_to(country_upload_dir).as_posix()
                for path in country_upload_dir.rglob("*")
                if path.is_file()
            )
            self.assertEqual(
                copied_files,
                [
                    f"{raw_pdf.stem}/commonforms/{raw_pdf.name}",
                    f"{raw_pdf.stem}/outputs/{raw_pdf.stem}.parsed.simple.json",
                    f"{raw_pdf.stem}/preview/page-1.png",
                    f"{raw_pdf.stem}/preview/page-2.png",
                ],
            )
            self.assertFalse((upload_root / "Italy" / "rawdata").exists())
            self.assertEqual(summary["copied_files"], 4)
            self.assertEqual(summary["verified_files"], 4)
            self.assertFalse(
                (
                    country_upload_dir
                    / raw_pdf.stem
                    / "outputs"
                    / f"{raw_pdf.stem}.parsed.post.json"
                ).exists()
            )

    def test_replaces_only_the_selected_country(self):
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            rawdata_dir = root / "data" / "Italy" / "rawdata"
            rawdata_dir.mkdir(parents=True)
            raw_pdf = rawdata_dir / "form.pdf"
            raw_pdf.touch()

            document_dir = rawdata_dir.parent / raw_pdf.stem
            (document_dir / "commonforms").mkdir(parents=True)
            (document_dir / "outputs").mkdir()
            (document_dir / "preview").mkdir()
            write_blank_pdf(document_dir / "commonforms" / raw_pdf.name)
            write_empty_simple_json(document_dir / "outputs" / "form.parsed.simple.json")
            (document_dir / "outputs" / "form.parsed.post.json").write_text("{}", encoding="utf-8")

            upload_root = root / "upload_data"
            stale_file = upload_root / "Italy" / "stale.txt"
            stale_file.parent.mkdir(parents=True)
            stale_file.write_text("stale", encoding="utf-8")
            other_country_file = upload_root / "France" / "keep.txt"
            other_country_file.parent.mkdir(parents=True)
            other_country_file.write_text("keep", encoding="utf-8")

            build_upload_data(rawdata_dir, [raw_pdf], upload_root)

            self.assertFalse(stale_file.exists())
            self.assertEqual(other_country_file.read_text(encoding="utf-8"), "keep")

    def test_adjusts_only_uploaded_pdf_from_simple_json(self):
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            rawdata_dir = root / "data" / "Italy" / "rawdata"
            rawdata_dir.mkdir(parents=True)
            raw_pdf = rawdata_dir / "form.pdf"
            raw_pdf.touch()

            document_dir = rawdata_dir.parent / raw_pdf.stem
            commonforms_dir = document_dir / "commonforms"
            outputs_dir = document_dir / "outputs"
            (document_dir / "preview").mkdir(parents=True)
            commonforms_dir.mkdir()
            outputs_dir.mkdir()
            prepared_pdf = commonforms_dir / raw_pdf.name
            write_blank_pdf(prepared_pdf)
            source_pdf_bytes = prepared_pdf.read_bytes()
            (outputs_dir / "form.parsed.simple.json").write_text(
                json.dumps(
                    {
                        "pages": [
                            {
                                "page": 1,
                                "acroforms": [
                                    {
                                        "name": "manual_field",
                                        "field_type": "/Tx",
                                        "rect": [10, 20, 110, 40],
                                    }
                                ],
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )

            upload_root = root / "upload_data"
            summary = build_upload_data(rawdata_dir, [raw_pdf], upload_root)

            uploaded_pdf = upload_root / "Italy" / "form" / "commonforms" / "form.pdf"
            self.assertEqual(prepared_pdf.read_bytes(), source_pdf_bytes)
            self.assertEqual(
                [form["name"] for form in extract_acroforms_by_page(str(uploaded_pdf))[1]],
                ["manual_field"],
            )
            self.assertEqual(summary["acroform_checked_pdfs"], 1)
            self.assertEqual(summary["acroform_adjusted_pdfs"], 1)
            self.assertEqual(summary["acroform_sync"][0]["pdf"], str(uploaded_pdf))


if __name__ == "__main__":
    unittest.main()
