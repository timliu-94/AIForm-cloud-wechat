import os
import unittest
from pathlib import Path
from types import SimpleNamespace
from tempfile import TemporaryDirectory
from unittest.mock import patch

from main import prepare_commonforms_pdf, require_commonforms_pdf, require_valid_pdf


class PDFValidationTests(unittest.TestCase):
    def test_rejects_zero_byte_pdf(self):
        with TemporaryDirectory() as temp_dir:
            pdf_path = Path(temp_dir) / "empty.pdf"
            pdf_path.touch()

            with self.assertRaisesRegex(RuntimeError, r"empty \(0 bytes\)"):
                require_valid_pdf(pdf_path)

    def test_rejects_non_pdf_content(self):
        with TemporaryDirectory() as temp_dir:
            pdf_path = Path(temp_dir) / "fake.pdf"
            pdf_path.write_bytes(b"not a pdf")

            with self.assertRaisesRegex(RuntimeError, "missing %PDF- header"):
                require_valid_pdf(pdf_path)

    def test_accepts_pdf_header(self):
        with TemporaryDirectory() as temp_dir:
            pdf_path = Path(temp_dir) / "valid.pdf"
            pdf_path.write_bytes(b"%PDF-1.7\n")

            self.assertEqual(require_valid_pdf(pdf_path), pdf_path)

    def test_commonforms_error_identifies_invalid_artifact(self):
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_pdf = root / "raw.pdf"
            prepared_pdf = root / "commonforms" / "raw.pdf"
            prepared_pdf.parent.mkdir()
            prepared_pdf.touch()

            with self.assertRaisesRegex(RuntimeError, "CommonForms PDF is missing or invalid"):
                require_commonforms_pdf(raw_pdf, prepared_pdf)

    def test_prepare_uses_the_workspace_commonforms_package(self):
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_pdf = root / "raw.pdf"
            prepared_pdf = root / "commonforms" / "raw.pdf"
            raw_pdf.write_bytes(b"%PDF-1.7\n")
            args = SimpleNamespace(
                commonforms_model="FFDNet-L",
                commonforms_device="cpu",
                commonforms_confidence=0.4,
                commonforms_fast=False,
            )

            def create_output(*_args, **_kwargs):
                prepared_pdf.write_bytes(b"%PDF-1.7\n")

            with (
                patch("main.__file__", "main.py"),
                patch("main.subprocess.run", side_effect=create_output) as run,
            ):
                self.assertEqual(
                    prepare_commonforms_pdf(raw_pdf, prepared_pdf, args),
                    prepared_pdf,
                )

            environment = run.call_args.kwargs["env"]
            workspace_commonforms = str(Path(__file__).resolve().parents[1] / "commonforms")
            self.assertEqual(environment["PYTHONPATH"].split(os.pathsep, 1)[0], workspace_commonforms)
            self.assertIn("--keep-existing-fields", run.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
