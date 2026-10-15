"""Offline private-evidence verifier; never downloads, approves or publishes content."""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath, PureWindowsPath


class InstallationError(ValueError):
    """Fixed error deliberately omits document content and filesystem paths."""


def safePath(root: Path, relative: str, existing=True) -> Path:
    """Reject linked ancestors, Windows escapes and traversal before reading bytes."""
    root = Path(root).absolute()
    parts = PurePosixPath(relative).parts
    if (not parts or relative != "/".join(parts) or ".." in parts or "." in parts
            or "\\" in relative or ":" in relative or PureWindowsPath(relative).drive
            or PurePosixPath(relative).is_absolute()):
        raise InstallationError("Private evidence verification failed.")
    target = root.joinpath(*parts)
    for component in (target, *target.parents):
        if component.is_symlink() or component.is_junction():
            raise InstallationError("Private evidence verification failed.")
    if existing and not target.is_file():
        raise InstallationError("Private evidence verification failed.")
    if not target.resolve().is_relative_to(root.resolve()):
        raise InstallationError("Private evidence verification failed.")
    return target


def verifyFiles(root: Path, manifest: dict):
    """Exact trusted bytes bind identity, module ownership and package version."""
    try:
        records = manifest["files"]
        if not records or len({record["path"] for record in records}) != len(records):
            raise ValueError()
        for record in records:
            relative = record["path"]
            if record["moduleId"] not in {"module_01_endo", "module_02_early_pregnancy"}:
                raise ValueError()
            expectedModule = "module_02_early_pregnancy" if ("module02" in relative or "Module02" in relative) else "module_01_endo"
            if record["moduleId"] != expectedModule:
                raise ValueError()
            path = safePath(root, relative)
            if path.stat().st_size != record["byteSize"]:
                raise ValueError()
            content = path.read_bytes()
            if len(content) != record["byteSize"] or hashlib.sha256(content).hexdigest() != record["sha256"]:
                raise ValueError()
        return len(records)
    except Exception:
        raise InstallationError("Private evidence verification failed.") from None


def verifyRuntime(root: Path):
    """Reuse the real catalog and package validators without creating any clients."""
    from backend.app.modules.registry import ModuleRegistry
    from backend.competition.integrity import PackageHash, Module2PackageHash
    from backend.competition.package import loadPackage
    try:
        project = Path(__file__).resolve().parents[1]
        for configPath in sorted((project / "backend/app/modules").glob("*/config.json")):
            expected = configPath.read_bytes()
            actual = safePath(root, configPath.relative_to(project).as_posix()).read_bytes()
            if actual != expected:
                raise ValueError()
        registry = ModuleRegistry(root / "backend/app/modules")
        if any(config.active or config.status.value != "pending_review" for config in registry.moduleConfigs.values()):
            raise ValueError()
        for directory, digest, moduleId in (("evidence", PackageHash, "module_01_endo"),
                ("module02Evidence", Module2PackageHash, "module_02_early_pregnancy")):
            loadPackage(root / "backend/competition" / directory, digest, "competition", moduleId)
    except Exception:
        raise InstallationError("Private evidence verification failed.") from None


def installEvidence(source: Path, destination: Path, project: Path, manifest: dict):
    """Copy only verified inventory into a new external, non-web-served private mount.

    Partial installations are unusable: runtime verification is mandatory and the
    destination must be new. No receipt grants clinical or source-use approval.
    """
    try:
        source = source.absolute()
        destination = destination.absolute()
        if (destination.exists() or destination.resolve().is_relative_to(project.resolve())
                or project.resolve().is_relative_to(destination.resolve())):
            raise ValueError()
        verifyFiles(source, manifest)
        safePath(destination, "installation.json", existing=False)
        destination.mkdir(parents=True)
        for record in manifest["files"]:
            target = safePath(destination, record["path"], existing=False)
            target.parent.mkdir(parents=True, exist_ok=True)
            # Recheck source bytes during copying; verification after all writes
            # detects replacement between the first check and this read.
            target.write_bytes(safePath(source, record["path"]).read_bytes())
        for configPath in sorted((project / "backend/app/modules").glob("*/config.json")):
            relative = configPath.relative_to(project).as_posix()
            target = safePath(destination, relative, existing=False)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(configPath.read_bytes())
            config = json.loads(configPath.read_bytes())
            if config.get("reviewDirectory"):
                safePath(destination, (target.parent / config["reviewDirectory"] / "placeholder").relative_to(destination).as_posix(), existing=False).parent.mkdir(parents=True, exist_ok=True)
        verifyFiles(destination, manifest)
        verifyRuntime(destination)
    except Exception:
        raise InstallationError("Private evidence verification failed.") from None


def main():
    parser = argparse.ArgumentParser(description="Offline verification of legally obtained private evidence.")
    parser.add_argument("action", choices=["verify", "install"])
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--destination", type=Path)
    parser.add_argument("--confirm-authorized-use", dest="confirmedUse", action="store_true")
    args = parser.parse_args()
    project = Path(__file__).resolve().parents[1]
    try:
        manifest = json.loads((project / "EvidenceSources.example.json").read_bytes())
        if args.action == "install":
            if not args.confirmedUse or args.destination is None:
                raise InstallationError("Authorized private installation is required.")
            installEvidence(args.source, args.destination, project, manifest)
        else:
            verifyFiles(args.source, manifest)
            verifyRuntime(args.source)
        print("Private evidence verified. No source approval or production activation granted.")
    except (InstallationError, OSError, ValueError):
        parser.exit(1, "Private evidence verification failed.\n")


if __name__ == "__main__":
    main()
