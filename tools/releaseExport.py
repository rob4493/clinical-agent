"""Explicit source-only distribution; never archive an evidence-bearing working tree."""

import argparse
import hashlib
import json
import re
from pathlib import Path

from tools.evidenceInstall import InstallationError, safePath


def checkRelease(project: Path, names: list[str]):
    """Reject private artifacts even if someone accidentally adds them to the allowlist."""
    private = {record["path"] for record in json.loads((project / "EvidenceSources.example.json").read_bytes())["files"]}
    # Catalogs contain only source identity metadata and are intentionally public.
    private = {name for name in private if not name.endswith("/sources.json")}
    if not names or names != sorted(set(names)):
        raise InstallationError("Source-free release verification failed.")
    signatures = re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|AKIA[A-Z0-9]{16}|npm_[A-Za-z0-9]{30,}")
    for name in names:
        path = safePath(project, name)
        if (name in private or path.suffix.lower() in {".pdf", ".docx", ".html", ".pem", ".key", ".log", ".jsonl"} and name != "frontend/index.html"
                or name.startswith(("backend/competition/evidence/", "backend/competition/module02Evidence/", "docs/"))
                or "/knowledge/" in name or "/candidatePolicies/" in name or name.endswith(("/candidateClaims.json", "/candidates.json"))
                or any(part in {"sourceIntake", "node_modules", "dist", ".git", "screenshots", "privateEvidence", "__pycache__"} or part.startswith(".venv") for part in Path(name).parts)
                or ".env" in path.name and path.name != ".env.example"
                or path.stat().st_size > 2_000_000
                or signatures.search(path.read_bytes())):
            raise InstallationError("Source-free release verification failed.")
    return {name: hashlib.sha256(safePath(project, name).read_bytes()).hexdigest() for name in names}


def exportRelease(project: Path, destination: Path):
    """Copy an audited allowlist to a new directory, preserving every original byte."""
    names = (project / "ReleaseFiles.txt").read_text(encoding="utf-8").splitlines()
    digests = checkRelease(project, names)
    if destination.exists() or destination.resolve() == project.resolve() or project.resolve().is_relative_to(destination.resolve()):
        raise InstallationError("Source-free release verification failed.")
    safePath(destination, "README.md", existing=False)
    destination.mkdir(parents=True)
    for name in names:
        target = safePath(destination, name, existing=False)
        target.parent.mkdir(parents=True, exist_ok=True)
        content = safePath(project, name).read_bytes()
        if hashlib.sha256(content).hexdigest() != digests[name]:
            raise InstallationError("Source-free release verification failed.")
        target.write_bytes(content)
    return digests


def main():
    parser = argparse.ArgumentParser(description="Export source-only files; never package private evidence.")
    parser.add_argument("--destination", type=Path, required=True)
    args = parser.parse_args()
    try:
        digests = exportRelease(Path(__file__).resolve().parents[1], args.destination)
        print(f"Verified {len(digests)} source-only files. No evidence files exported.")
    except Exception:
        parser.exit(1, "Source-free release verification failed.\n")


if __name__ == "__main__":
    main()
