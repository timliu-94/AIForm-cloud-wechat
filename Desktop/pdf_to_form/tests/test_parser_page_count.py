import unittest
from unittest.mock import MagicMock, patch

from pdf_to_form.parser import parse_pdf


class ParserPageCountTests(unittest.TestCase):
    def test_parse_rejects_disagreement_between_pdf_parsers(self):
        pdfplumber_pdf = MagicMock()
        pdfplumber_pdf.pages = [MagicMock(), MagicMock(), MagicMock()]
        pdfplumber_context = MagicMock()
        pdfplumber_context.__enter__.return_value = pdfplumber_pdf
        pypdf_reader = MagicMock()
        pypdf_reader.pages = [MagicMock() for _ in range(4)]

        with (
            patch("pdf_to_form.parser.extract_acroforms_by_page", return_value={}),
            patch("pdf_to_form.parser.pdfplumber.open", return_value=pdfplumber_context),
            patch("pdf_to_form.parser.PdfReader", return_value=pypdf_reader),
        ):
            with self.assertRaisesRegex(
                RuntimeError,
                r"PDF parser page count mismatch: PyPDF=4, pdfplumber=3",
            ):
                parse_pdf("broken.pdf")


if __name__ == "__main__":
    unittest.main()
