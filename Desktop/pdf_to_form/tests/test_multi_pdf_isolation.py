import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import ANY, patch

import main as app


class MultiPDFIsolationTests(unittest.TestCase):
    def test_llm_cache_directory_is_scoped_by_country_and_pdf(self):
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            llm_root = root / "llm_outputs"
            italy_rawdata = root / "data" / "Italy" / "rawdata"
            france_rawdata = root / "data" / "France" / "rawdata"

            italy_shanghai = app.llm_infer_dir_for_raw_pdf(
                italy_rawdata, italy_rawdata / "上海版.pdf", llm_root
            )
            italy_beijing = app.llm_infer_dir_for_raw_pdf(
                italy_rawdata, italy_rawdata / "北京版.pdf", llm_root
            )
            france_shanghai = app.llm_infer_dir_for_raw_pdf(
                france_rawdata, france_rawdata / "上海版.pdf", llm_root
            )

        self.assertEqual(italy_shanghai, llm_root / "Italy" / "上海版")
        self.assertEqual(italy_beijing, llm_root / "Italy" / "北京版")
        self.assertEqual(france_shanghai, llm_root / "France" / "上海版")
        self.assertEqual(len({italy_shanghai, italy_beijing, france_shanghai}), 3)

    def test_build_config_uses_document_specific_llm_directory(self):
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            rawdata = root / "data" / "Italy" / "rawdata"
            rawdata.mkdir(parents=True)
            raw_pdf = rawdata / "北京版.pdf"
            args = app.build_parser().parse_args([str(rawdata), "--stage", "clean"])
            infer_dir = app.llm_infer_dir_for_raw_pdf(
                rawdata, raw_pdf, args.llm_output_dir
            )
            config = app.build_config(
                args,
                root / "commonforms" / raw_pdf.name,
                root / "outputs",
                llm_infer_dir=infer_dir,
            )

        self.assertEqual(config.llm_infer_dir, Path("llm_outputs") / "Italy" / "北京版")
        self.assertIsNone(config.field_example_overrides)

    def test_build_config_preserves_japan_name_examples(self):
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            rawdata = root / "data" / "Japan" / "rawdata"
            rawdata.mkdir(parents=True)
            args = app.build_parser().parse_args([str(rawdata), "--stage", "clean"])
            config = app.build_config(args, root / "commonforms" / "form.pdf")

        self.assertEqual(
            config.field_example_overrides,
            app.JAPAN_NAME_FIELD_EXAMPLE_OVERRIDES,
        )

    def test_all_stage_failure_does_not_stop_later_pdfs_and_skips_upload_rebuild(self):
        with TemporaryDirectory() as temp_dir:
            rawdata = Path(temp_dir) / "data" / "Italy" / "rawdata"
            rawdata.mkdir(parents=True)
            pdfs = [rawdata / name for name in ("a.pdf", "b.pdf", "c.pdf")]
            for pdf in pdfs:
                pdf.touch()

            processed = []

            def process(args, pdf_path):
                processed.append(pdf_path.name)
                if pdf_path.name == "b.pdf":
                    raise RuntimeError("simulated failure")
                return {"status": "ok"}

            with (
                patch("main.process_raw_pdf", side_effect=process),
                patch("main.build_upload_data") as build_upload,
            ):
                with redirect_stdout(StringIO()):
                    with self.assertRaises(app.MultiPDFProcessingError) as context:
                        app.main([str(rawdata), "--stage", "all"])

        self.assertEqual(processed, ["a.pdf", "b.pdf", "c.pdf"])
        build_upload.assert_not_called()
        self.assertEqual([item["pdf"] for item in context.exception.failures], ["b.pdf"])

    def test_upload_stage_rebuilds_from_all_pdfs_without_processing_them(self):
        with TemporaryDirectory() as temp_dir:
            rawdata = Path(temp_dir) / "data" / "Italy" / "rawdata"
            rawdata.mkdir(parents=True)
            pdfs = [rawdata / name for name in ("a.pdf", "b.pdf")]
            for pdf in pdfs:
                pdf.touch()

            with (
                patch("main.process_raw_pdf", return_value={"status": "ok"}) as process,
                patch(
                    "main.build_upload_data",
                    return_value={"path": "upload_data/Italy", "copied_files": 0},
                ) as build_upload,
            ):
                with redirect_stdout(StringIO()):
                    results = app.main([str(rawdata), "--stage", "upload"])

        process.assert_not_called()
        build_upload.assert_called_once_with(rawdata, pdfs)
        self.assertEqual(results["run_summary"]["succeeded"], 2)
        self.assertEqual(results["run_summary"]["failed"], 0)

    def test_clean_stage_does_not_rebuild_upload_data(self):
        with TemporaryDirectory() as temp_dir:
            rawdata = Path(temp_dir) / "data" / "Italy" / "rawdata"
            rawdata.mkdir(parents=True)
            raw_pdf = rawdata / "a.pdf"
            raw_pdf.touch()

            with (
                patch("main.process_raw_pdf", return_value={"status": "ok"}) as process,
                patch("main.build_upload_data") as build_upload,
            ):
                with redirect_stdout(StringIO()):
                    app.main([str(rawdata), "--stage", "clean"])

        process.assert_called_once_with(ANY, raw_pdf)
        build_upload.assert_not_called()


if __name__ == "__main__":
    unittest.main()
