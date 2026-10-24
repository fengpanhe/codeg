#!/usr/bin/env python3
"""Helpers for the macOS workbench CI build."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import plistlib
import re
import shutil
import subprocess
from pathlib import Path
from typing import Mapping


BASE_CONFIG = Path("src-tauri/tauri.conf.json")
BASE_BUNDLE = {
    "bundle": {
        "createUpdaterArtifacts": False,
        "macOS": {"signingIdentity": "-"},
    }
}
PRODUCT_TRAILER = "Build-Product-Name"
BUNDLE_TRAILER = "Build-Bundle-Identifier"
SOURCE_TRAILER = "Workbench-Source-Commit"
SOURCE_RE = re.compile(r"^[0-9a-fA-F]{40}$")
BUNDLE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+$")
TARGET_ARCHES = {
    "aarch64-apple-darwin": "arm64",
    "x86_64-apple-darwin": "x86_64",
}


class BuildConfigError(ValueError):
    """Raised when CI-supplied build metadata is unsafe or invalid."""


def _reject_path_or_newline(value: str, field: str) -> None:
    if any(char in value for char in ("\n", "\r", "\0", "/", "\\")):
        raise BuildConfigError(f"{field} must not contain path or newline characters")


def validate_product_name(value: str) -> str:
    if value == "":
        return ""
    _reject_path_or_newline(value, "product_name")
    if value != value.strip():
        raise BuildConfigError("product_name must not have leading or trailing whitespace")
    return value


def validate_bundle_identifier(value: str) -> str:
    if value == "":
        return ""
    _reject_path_or_newline(value, "bundle_identifier")
    if not BUNDLE_RE.fullmatch(value):
        raise BuildConfigError(
            "bundle_identifier must be a reverse-DNS identifier containing only "
            "letters, digits, dots, and hyphens"
        )
    return value


def validate_source_commit(value: str) -> str:
    if value == "":
        return ""
    if not SOURCE_RE.fullmatch(value):
        raise BuildConfigError(f"{SOURCE_TRAILER} must be a full 40-character commit SHA")
    return value.lower()


def make_override(product_name: str = "", identifier: str = "") -> dict:
    product_name = validate_product_name(product_name)
    identifier = validate_bundle_identifier(identifier)
    override = json.loads(json.dumps(BASE_BUNDLE))
    if product_name:
        override["productName"] = product_name
    if identifier:
        override["identifier"] = identifier
    return override


def write_json(path: Path, data: Mapping) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")


def git_trailer(key: str) -> str:
    output = subprocess.check_output(
        ["git", "log", "-1", f"--format=%(trailers:key={key},valueonly)"],
        text=True,
    )
    lines = [line for line in output.splitlines() if line.strip()]
    if len(lines) > 1:
        raise BuildConfigError(f"commit has multiple {key} trailers")
    return lines[0].strip() if lines else ""


def resolve_metadata(
    product_name_input: str,
    bundle_identifier_input: str,
    trailers: Mapping[str, str] | None = None,
) -> dict:
    trailer_values = trailers if trailers is not None else {
        PRODUCT_TRAILER: git_trailer(PRODUCT_TRAILER),
        BUNDLE_TRAILER: git_trailer(BUNDLE_TRAILER),
        SOURCE_TRAILER: git_trailer(SOURCE_TRAILER),
    }
    product_name = product_name_input or trailer_values.get(PRODUCT_TRAILER, "")
    bundle_identifier = (
        bundle_identifier_input or trailer_values.get(BUNDLE_TRAILER, "")
    )
    source_commit = trailer_values.get(SOURCE_TRAILER, "")
    return {
        "product_name": validate_product_name(product_name),
        "bundle_identifier": validate_bundle_identifier(bundle_identifier),
        "source_commit": validate_source_commit(source_commit),
    }


def base_config() -> dict:
    return json.loads(BASE_CONFIG.read_text())


def append_github_env(path: Path, values: Mapping[str, str]) -> None:
    with path.open("a", encoding="utf-8") as env_file:
        for key, value in values.items():
            if "\n" in value or "\r" in value:
                raise BuildConfigError(f"{key} contains a newline")
            env_file.write(f"{key}={value}\n")


def command_prepare(args: argparse.Namespace) -> None:
    metadata = resolve_metadata(args.product_name, args.bundle_identifier)
    override = make_override(
        metadata["product_name"],
        metadata["bundle_identifier"],
    )
    config_path = Path(args.config)
    write_json(config_path, override)
    env_values = {
        "CODEG_TAURI_CONFIG": str(config_path),
        "CODEG_EFFECTIVE_PRODUCT_NAME": metadata["product_name"],
        "CODEG_EFFECTIVE_BUNDLE_IDENTIFIER": metadata["bundle_identifier"],
        "CODEG_SOURCE_COMMIT": metadata["source_commit"],
    }
    if args.github_env:
        append_github_env(Path(args.github_env), env_values)
    print(json.dumps({"config": str(config_path), **metadata}, sort_keys=True))


def expected_architecture(target: str) -> str:
    try:
        return TARGET_ARCHES[target]
    except KeyError as exc:
        raise BuildConfigError(f"unsupported macOS target: {target}") from exc


def effective_values() -> tuple[str, str]:
    config = base_config()
    product_name = os.environ.get("CODEG_EFFECTIVE_PRODUCT_NAME") or config["productName"]
    identifier = (
        os.environ.get("CODEG_EFFECTIVE_BUNDLE_IDENTIFIER") or config["identifier"]
    )
    return product_name, identifier


def discover_app(target: str, product_name: str) -> Path:
    bundle_dir = Path("src-tauri") / "target" / target / "release" / "bundle" / "macos"
    expected = bundle_dir / f"{product_name}.app"
    if expected.is_dir():
        return expected
    apps = sorted(bundle_dir.glob("*.app"))
    if len(apps) == 1:
        return apps[0]
    if not apps:
        raise BuildConfigError(f"no .app bundle found in {bundle_dir}")
    raise BuildConfigError(
        f"expected {expected.name} or exactly one .app in {bundle_dir}, found "
        + ", ".join(app.name for app in apps)
    )


def only_dmg(target: str) -> Path:
    dmg_dir = Path("src-tauri") / "target" / target / "release" / "bundle" / "dmg"
    dmgs = sorted(dmg_dir.glob("*.dmg"))
    if len(dmgs) != 1:
        raise BuildConfigError(f"expected exactly one fresh DMG in {dmg_dir}, found {len(dmgs)}")
    return dmgs[0]


def run_output(command: list[str]) -> str:
    return subprocess.check_output(command, text=True).strip()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_bundle(app: Path, target: str, expected_name: str, expected_identifier: str) -> dict:
    subprocess.check_call(["codesign", "--verify", "--deep", "--strict", str(app)])
    plist_path = app / "Contents" / "Info.plist"
    with plist_path.open("rb") as file:
        plist = plistlib.load(file)
    bundle_name = plist.get("CFBundleName", "")
    identifier = plist.get("CFBundleIdentifier", "")
    executable_name = plist.get("CFBundleExecutable", "")
    if bundle_name != expected_name:
        raise BuildConfigError(
            f"CFBundleName mismatch: expected {expected_name!r}, got {bundle_name!r}"
        )
    if identifier != expected_identifier:
        raise BuildConfigError(
            "CFBundleIdentifier mismatch: expected "
            f"{expected_identifier!r}, got {identifier!r}"
        )
    executable = app / "Contents" / "MacOS" / executable_name
    if not executable.is_file():
        raise BuildConfigError(f"main executable is missing: {executable}")
    archs = run_output(["lipo", "-archs", str(executable)]).split()
    expected_arch = expected_architecture(target)
    if expected_arch not in archs:
        raise BuildConfigError(
            f"{executable} does not contain {expected_arch}; lipo reported {archs}"
        )
    return {
        "app_name": app.name,
        "bundle_name": bundle_name,
        "bundle_identifier": identifier,
        "executable": executable_name,
        "architectures": archs,
        "expected_architecture": expected_arch,
    }


def command_package(args: argparse.Namespace) -> None:
    target = args.target
    artifacts = Path(args.artifacts_dir)
    if artifacts.exists():
        shutil.rmtree(artifacts)
    artifacts.mkdir(parents=True)
    product_name, identifier = effective_values()
    app = discover_app(target, product_name)
    bundle_info = verify_bundle(app, target, product_name, identifier)
    zip_path = artifacts / f"codeg-workbench-{target}.app.zip"
    subprocess.check_call(
        ["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", str(app), str(zip_path)]
    )
    dmg = only_dmg(target)
    dmg_path = artifacts / dmg.name
    shutil.copy2(dmg, dmg_path)
    build_commit = run_output(["git", "rev-parse", "HEAD"])
    source_commit = os.environ.get("CODEG_SOURCE_COMMIT", "")
    (artifacts / "commit.txt").write_text(build_commit + "\n")
    if source_commit:
        (artifacts / "source_commit.txt").write_text(source_commit + "\n")
    sums = {
        zip_path.name: sha256(zip_path),
        dmg_path.name: sha256(dmg_path),
    }
    (artifacts / "SHA256SUMS").write_text(
        "".join(f"{digest}  {name}\n" for name, digest in sorted(sums.items()))
    )
    bundle_info.update(
        {
            "schema_version": 1,
            "target": target,
            "app_path": str(app),
            "build_commit": build_commit,
            "source_commit": source_commit,
            "artifacts": {
                "app_zip": zip_path.name,
                "dmg": dmg_path.name,
            },
            "sha256": sums,
        }
    )
    write_json(artifacts / "bundle-info.json", bundle_info)


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser()
    subparsers = root.add_subparsers(dest="command", required=True)

    prepare = subparsers.add_parser("prepare")
    prepare.add_argument("--product-name", default="")
    prepare.add_argument("--bundle-identifier", default="")
    prepare.add_argument("--config", required=True)
    prepare.add_argument("--github-env", default="")
    prepare.set_defaults(func=command_prepare)

    package = subparsers.add_parser("package")
    package.add_argument("--target", required=True)
    package.add_argument("--artifacts-dir", required=True)
    package.set_defaults(func=command_package)
    return root


def main() -> None:
    args = parser().parse_args()
    try:
        args.func(args)
    except BuildConfigError as exc:
        raise SystemExit(str(exc)) from exc


if __name__ == "__main__":
    main()
