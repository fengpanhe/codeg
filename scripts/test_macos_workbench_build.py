#!/usr/bin/env python3

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import macos_workbench_build as build


class MacOSWorkbenchBuildTests(unittest.TestCase):
    def test_make_override_omits_empty_optional_values(self) -> None:
        override = build.make_override(product_name="", identifier="")

        self.assertNotIn("productName", override)
        self.assertNotIn("identifier", override)
        self.assertEqual(override["bundle"]["createUpdaterArtifacts"], False)
        self.assertEqual(override["bundle"]["macOS"]["signingIdentity"], "-")

    def test_make_override_accepts_generic_values(self) -> None:
        override = build.make_override(
            product_name="Example Dev",
            identifier="app.example.dev",
        )

        self.assertEqual(override["productName"], "Example Dev")
        self.assertEqual(override["identifier"], "app.example.dev")
        self.assertEqual(override["bundle"]["createUpdaterArtifacts"], False)
        self.assertEqual(override["bundle"]["macOS"]["signingIdentity"], "-")

    def test_product_name_rejects_path_and_newline_values(self) -> None:
        for value in ("Example/Dev", "Example\\Dev", "Example\nDev"):
            with self.subTest(value=value):
                with self.assertRaises(build.BuildConfigError):
                    build.make_override(product_name=value, identifier="")

    def test_bundle_identifier_rejects_path_newline_and_invalid_values(self) -> None:
        for value in ("app/example/dev", "app.example\nDev", "app..example", "app"):
            with self.subTest(value=value):
                with self.assertRaises(build.BuildConfigError):
                    build.make_override(product_name="", identifier=value)

    def test_inputs_take_precedence_over_trailers(self) -> None:
        metadata = build.resolve_metadata(
            "Input Dev",
            "app.input.dev",
            {
                build.PRODUCT_TRAILER: "Trailer Dev",
                build.BUNDLE_TRAILER: "app.trailer.dev",
                build.SOURCE_TRAILER: "a" * 40,
            },
        )

        self.assertEqual(metadata["product_name"], "Input Dev")
        self.assertEqual(metadata["bundle_identifier"], "app.input.dev")
        self.assertEqual(metadata["source_commit"], "a" * 40)

    def test_trailers_fill_absent_inputs(self) -> None:
        metadata = build.resolve_metadata(
            "",
            "",
            {
                build.PRODUCT_TRAILER: "Trailer Dev",
                build.BUNDLE_TRAILER: "app.trailer.dev",
                build.SOURCE_TRAILER: "B" * 40,
            },
        )

        self.assertEqual(metadata["product_name"], "Trailer Dev")
        self.assertEqual(metadata["bundle_identifier"], "app.trailer.dev")
        self.assertEqual(metadata["source_commit"], "b" * 40)

    def test_source_commit_requires_full_sha_identity(self) -> None:
        with self.assertRaises(build.BuildConfigError):
            build.resolve_metadata(
                "",
                "",
                {
                    build.PRODUCT_TRAILER: "",
                    build.BUNDLE_TRAILER: "",
                    build.SOURCE_TRAILER: "abc123",
                },
            )

    def test_write_override_config_does_not_touch_base_config(self) -> None:
        before = build.BASE_CONFIG.read_bytes()
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "override.json"
            build.write_json(
                path,
                build.make_override("Example Dev", "app.example.dev"),
            )
            data = json.loads(path.read_text())

        self.assertEqual(data["productName"], "Example Dev")
        self.assertEqual(build.BASE_CONFIG.read_bytes(), before)

    def test_discover_app_uses_effective_name_or_exactly_one_bundle(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            target = "aarch64-apple-darwin"
            bundle_dir = root / "src-tauri" / "target" / target / "release" / "bundle" / "macos"
            bundle_dir.mkdir(parents=True)
            (bundle_dir / "Only.app").mkdir()
            original_cwd = Path.cwd()
            try:
                import os

                os.chdir(root)
                self.assertEqual(build.discover_app(target, "Other").name, "Only.app")
                (bundle_dir / "Other.app").mkdir()
                self.assertEqual(build.discover_app(target, "Other").name, "Other.app")
            finally:
                os.chdir(original_cwd)


if __name__ == "__main__":
    unittest.main()
