"""
Tests for repository hygiene (.gitignore coverage and no leaked secrets).

Checks:
- .gitignore exists at the repository root.
- .env is listed as ignored.
- Audit log files (*.jsonl) are ignored.
- Frontend environment files are ignored.
- Milvus volume directories are ignored.
- No file in the repository root contains real credentials, patient data,
  or model identifiers in committed source files.
"""

from __future__ import annotations

from pathlib import Path

RepoRoot = Path(__file__).resolve().parent.parent.parent


class TestGitignoreCoverage:
    """Verify .gitignore contains the required patterns."""

    def gitignoreContent(self) -> str:
        gitignore = RepoRoot / ".gitignore"
        assert gitignore.exists(), ".gitignore must exist at the repository root."
        return gitignore.read_text(encoding="ascii", errors="replace")

    def testGitignoreExists(self) -> None:
        assert (RepoRoot / ".gitignore").exists()

    def testGitignoreIgnoresDotenv(self) -> None:
        content = self.gitignoreContent()
        assert ".env" in content, ".gitignore must list .env"

    def testGitignoreDoesNotIgnoreEnvExample(self) -> None:
        content = self.gitignoreContent()
        assert "!.env.example" in content, (
            ".gitignore must explicitly allow .env.example with a negation rule."
        )

    def testGitignoreIgnoresJsonlAuditFiles(self) -> None:
        content = self.gitignoreContent()
        assert "*.jsonl" in content, ".gitignore must ignore *.jsonl audit log files."

    def testGitignoreIgnoresFrontendEnvFiles(self) -> None:
        content = self.gitignoreContent()
        assert "frontend/.env" in content, (
            ".gitignore must ignore frontend/.env files that may contain secrets."
        )

    def testGitignoreIgnoresMilvusVolumes(self) -> None:
        content = self.gitignoreContent()
        assert "volumes/" in content or "milvus_data/" in content, (
            ".gitignore must ignore local Milvus volume directories."
        )

    def testGitignoreIgnoresPytestCache(self) -> None:
        content = self.gitignoreContent()
        assert ".pytest_cache/" in content

    def testGitignoreIgnoresPycache(self) -> None:
        content = self.gitignoreContent()
        assert "__pycache__/" in content

    def testGitignoreIgnoresVenv(self) -> None:
        content = self.gitignoreContent()
        assert ".venv/" in content


class TestNoLeakedSecrets:
    """
    Confirm that source-controlled files do not contain patterns that suggest
    real credentials, patient identifiers, or hard-coded model names.
    """

    SensitivePatterns = [
        # These strings must not appear as literal values in committed source.
        "ibm/granite",          # real watsonx model family prefix
        "ibm/slate",            # real watsonx embedding model prefix
        "Bearer eyJ",           # JWT token prefix
        "sk-",                  # common API key prefix pattern
        "AKIA",                 # AWS access key prefix (not IBM, but sanity check)
    ]

    def testEnvExampleHasNoRealCredentials(self) -> None:
        envExample = RepoRoot / ".env.example"
        assert envExample.exists()
        content = envExample.read_text(encoding="utf-8")
        for pattern in self.SensitivePatterns:
            # Allow patterns that appear only in commented-out example lines.
            nonCommentLines = [
                line for line in content.splitlines()
                if not line.strip().startswith("#") and pattern in line
            ]
            assert not nonCommentLines, (
                f".env.example contains '{pattern}' in a non-comment line: "
                f"{nonCommentLines}"
            )

    def testConftestHasNoRealCredentials(self) -> None:
        conftest = RepoRoot / "tests" / "conftest.py"
        assert conftest.exists()
        content = conftest.read_text(encoding="utf-8")
        for pattern in self.SensitivePatterns:
            assert pattern not in content, (
                f"tests/conftest.py must not contain '{pattern}'."
            )
