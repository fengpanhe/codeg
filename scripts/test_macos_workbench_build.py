#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import subprocess
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

    def make_git_repo(self) -> tuple[tempfile.TemporaryDirectory, Path]:
        temp_dir = tempfile.TemporaryDirectory()
        root = Path(temp_dir.name)
        subprocess.check_call(["git", "init", "-b", "main"], cwd=root, stdout=subprocess.DEVNULL)
        subprocess.check_call(["git", "config", "user.email", "ci@example.invalid"], cwd=root)
        subprocess.check_call(["git", "config", "user.name", "CI"], cwd=root)
        return temp_dir, root

    def commit_file(self, root: Path, name: str, content: str, message: str) -> str:
        (root / name).write_text(content)
        subprocess.check_call(["git", "add", name], cwd=root)
        subprocess.check_call(["git", "commit", "-m", message], cwd=root, stdout=subprocess.DEVNULL)
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()

    def build_empty_commit(self, root: Path, message: str) -> str:
        subprocess.check_call(
            ["git", "commit", "--allow-empty", "-m", message],
            cwd=root,
            stdout=subprocess.DEVNULL,
        )
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()

    def test_build_provenance_accepts_same_tree_source(self) -> None:
        temp_dir, root = self.make_git_repo()
        with temp_dir:
            source = self.commit_file(root, "file.txt", "same", "source")
            build_commit = self.build_empty_commit(root, "build metadata")
            original_cwd = Path.cwd()
            try:
                os.chdir(root)
                provenance = build.build_provenance(source)
            finally:
                os.chdir(original_cwd)

        self.assertEqual(provenance["build_commit"], build_commit)
        self.assertEqual(provenance["source_commit"], source)
        self.assertTrue(provenance["source_resolved"])
        self.assertTrue(provenance["same_tree"])
        self.assertEqual(provenance["identity"], "same-tree")
        self.assertEqual(provenance["source_tree"], provenance["build_tree"])

    def test_build_provenance_rejects_mismatched_tree_source(self) -> None:
        temp_dir, root = self.make_git_repo()
        with temp_dir:
            source = self.commit_file(root, "file.txt", "source", "source")
            build_commit = self.commit_file(root, "file.txt", "build", "build")
            original_cwd = Path.cwd()
            try:
                os.chdir(root)
                provenance = build.build_provenance(source)
            finally:
                os.chdir(original_cwd)

        self.assertEqual(provenance["build_commit"], build_commit)
        self.assertEqual(provenance["source_commit"], source)
        self.assertTrue(provenance["source_resolved"])
        self.assertFalse(provenance["same_tree"])
        self.assertEqual(provenance["identity"], "tree-mismatch")
        self.assertNotEqual(provenance["source_tree"], provenance["build_tree"])

    def test_build_provenance_rejects_missing_source_object(self) -> None:
        temp_dir, root = self.make_git_repo()
        with temp_dir:
            self.commit_file(root, "file.txt", "build", "build")
            missing = "f" * 40
            original_cwd = Path.cwd()
            try:
                os.chdir(root)
                provenance = build.build_provenance(missing)
            finally:
                os.chdir(original_cwd)

        self.assertEqual(provenance["source_commit"], missing)
        self.assertFalse(provenance["source_resolved"])
        self.assertFalse(provenance["same_tree"])
        self.assertEqual(provenance["identity"], "source-unresolved")
        self.assertIn("unable to resolve git object", provenance["error"])

    def test_build_provenance_records_build_only_without_source(self) -> None:
        temp_dir, root = self.make_git_repo()
        with temp_dir:
            build_commit = self.commit_file(root, "file.txt", "build", "build")
            original_cwd = Path.cwd()
            try:
                os.chdir(root)
                provenance = build.build_provenance("")
            finally:
                os.chdir(original_cwd)

        self.assertEqual(provenance["build_commit"], build_commit)
        self.assertEqual(provenance["source_commit"], "")
        self.assertIsNone(provenance["source_resolved"])
        self.assertIsNone(provenance["same_tree"])
        self.assertEqual(provenance["identity"], "build-only")


    def test_package_fails_before_trusting_mismatched_source(self) -> None:
        temp_dir, root = self.make_git_repo()
        with temp_dir:
            source = self.commit_file(root, "file.txt", "source", "source")
            self.commit_file(root, "file.txt", "build", "build")
            artifacts = root / "artifacts"
            original_cwd = Path.cwd()
            original_source = os.environ.get("CODEG_SOURCE_COMMIT")
            os.environ["CODEG_SOURCE_COMMIT"] = source
            try:
                os.chdir(root)
                with self.assertRaisesRegex(build.BuildConfigError, "does not identify"):
                    build.command_package(
                        type(
                            "Args",
                            (),
                            {
                                "target": "aarch64-apple-darwin",
                                "artifacts_dir": str(artifacts),
                            },
                        )()
                    )
                bundle_info = json.loads((artifacts / "bundle-info.json").read_text())
            finally:
                os.chdir(original_cwd)
                if original_source is None:
                    os.environ.pop("CODEG_SOURCE_COMMIT", None)
                else:
                    os.environ["CODEG_SOURCE_COMMIT"] = original_source

        self.assertEqual(bundle_info["provenance"]["identity"], "tree-mismatch")
        self.assertFalse(bundle_info["provenance"]["same_tree"])

    def test_package_fails_before_trusting_missing_source(self) -> None:
        temp_dir, root = self.make_git_repo()
        with temp_dir:
            self.commit_file(root, "file.txt", "build", "build")
            artifacts = root / "artifacts"
            original_cwd = Path.cwd()
            original_source = os.environ.get("CODEG_SOURCE_COMMIT")
            os.environ["CODEG_SOURCE_COMMIT"] = "f" * 40
            try:
                os.chdir(root)
                with self.assertRaisesRegex(build.BuildConfigError, "does not identify"):
                    build.command_package(
                        type(
                            "Args",
                            (),
                            {
                                "target": "aarch64-apple-darwin",
                                "artifacts_dir": str(artifacts),
                            },
                        )()
                    )
                bundle_info = json.loads((artifacts / "bundle-info.json").read_text())
            finally:
                os.chdir(original_cwd)
                if original_source is None:
                    os.environ.pop("CODEG_SOURCE_COMMIT", None)
                else:
                    os.environ["CODEG_SOURCE_COMMIT"] = original_source

        self.assertEqual(bundle_info["provenance"]["identity"], "source-unresolved")
        self.assertFalse(bundle_info["provenance"]["source_resolved"])
        self.assertFalse(bundle_info["provenance"]["same_tree"])

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
