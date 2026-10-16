"""Offline static-host configuration and Python-host launch boundaries."""

import json
import sys
import tomllib
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from tools import serveTester


@pytest.mark.parametrize("port", ["1", "8000", "10000", "65535"])
def testAssignedPort(port, monkeypatch):
    monkeypatch.setenv("PORT", port)
    assert serveTester.readPort() == int(port)


@pytest.mark.parametrize("port", [None, "", "0", "65536", "-1", "08000", " 8000", "8000 ", "8e3", "secret-synthetic-host"])
def testInvalidPortsStayPrivate(port, monkeypatch, caplog):
    if port is None:
        monkeypatch.delenv("PORT", raising=False)
    else:
        monkeypatch.setenv("PORT", port)
    with pytest.raises(serveTester.HostingError) as failure:
        serveTester.readPort()
    assert str(failure.value) == "Tester hosting configuration is invalid."
    assert not caplog.text


def clearHost(monkeypatch):
    for name in ["CLINICAL_RUNTIME_MODE", "CLINICAL_DEMO_MODE", "CLINICAL_TESTER_PROVIDER", "LANGUAGE_PROVIDER",
                 "CLINICAL_EVIDENCE_ROOT", "MODULE_ROOT", "DEBUG"]:
        monkeypatch.delenv(name, raising=False)
    # Record the source-free launcher's environment mutations for fixture cleanup.
    monkeypatch.setenv("MODULE_ROOT", "")
    monkeypatch.setenv("CLINICAL_RUNTIME_MODE", "standard")
    monkeypatch.setenv("CLINICAL_DEMO_MODE", "false")
    monkeypatch.setenv("LANGUAGE_PROVIDER", "disabled")


@pytest.mark.parametrize("mode", ["standard", "synthetic"])
def testHostedSourceFreeModes(mode, monkeypatch):
    clearHost(monkeypatch)
    monkeypatch.setenv("CLINICAL_RUNTIME_MODE", mode)
    app = serveTester.buildApp()
    from fastapi.testclient import TestClient
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/ready").status_code == (200 if mode == "synthetic" else 503)
    assert all(not config.active for config in app.state.authenticRegistry.moduleConfigs.values())


@pytest.mark.parametrize("settings", [
    {"CLINICAL_RUNTIME_MODE": "production"},
    {"CLINICAL_TESTER_PROVIDER": "watsonx"},
    {"LANGUAGE_PROVIDER": "watsonx"},
    {"DEBUG": "true"},
    {"CLINICAL_TESTER_PROVIDER": "deterministic"},
    {"CLINICAL_DEMO_MODE": "true"},
    {"CLINICAL_DEMO_MODE": "TRUE"},
    {"CLINICAL_EVIDENCE_ROOT": ""},
    {"CLINICAL_RUNTIME_MODE": "competition", "CLINICAL_EVIDENCE_ROOT": "relative"},
])
def testInvalidHostingFailsClosed(settings, monkeypatch, caplog):
    clearHost(monkeypatch)
    for name, setting in settings.items():
        monkeypatch.setenv(name, setting)
    with pytest.raises(serveTester.HostingError) as failure:
        serveTester.buildApp()
    assert str(failure.value) == "Tester runtime is unavailable." and not caplog.text


def testNoInImageCompetitionEvidence(monkeypatch):
    clearHost(monkeypatch)
    project = Path(__file__).resolve().parents[2]
    monkeypatch.setenv("CLINICAL_RUNTIME_MODE", "competition")
    monkeypatch.setenv("CLINICAL_EVIDENCE_ROOT", str(project / "privateEvidence"))
    with pytest.raises(serveTester.HostingError):
        serveTester.buildApp()


def testCompetitionUsesPublicPackagesWithoutPrivateMount(monkeypatch):
    clearHost(monkeypatch)
    monkeypatch.setenv("CLINICAL_RUNTIME_MODE", "competition")
    app = serveTester.buildApp()
    assert app.state.registry.publicEvaluation is True
    assert app.state.analysis.isReady()
    assert all(not config.active for config in app.state.authenticRegistry.moduleConfigs.values())


def testMissingPrivateMountFailsClosed(tmp_path, monkeypatch):
    clearHost(monkeypatch)
    monkeypatch.setenv("CLINICAL_RUNTIME_MODE", "competition")
    monkeypatch.setenv("CLINICAL_EVIDENCE_ROOT", str(tmp_path / "missing"))
    with pytest.raises(serveTester.HostingError):
        serveTester.buildApp()


@pytest.mark.parametrize("provider", ["disabled", "deterministic"])
def testCompetitionDelegatesPrivateValidation(provider, tmp_path, monkeypatch):
    clearHost(monkeypatch)
    from tools import runDemo
    # This fictional external mount is never read; the real verifier is covered
    # by installation regressions. Assert the host cannot bypass that boundary.
    privateRoot = Path(tmp_path.anchor) / "SyntheticPrivateEvidence"
    monkeypatch.setenv("CLINICAL_RUNTIME_MODE", "competition")
    monkeypatch.setenv("CLINICAL_EVIDENCE_ROOT", str(privateRoot))
    monkeypatch.setenv("CLINICAL_TESTER_PROVIDER", provider)
    verify = Mock()
    monkeypatch.setattr(runDemo, "configureDemo", verify)
    assert serveTester.configureHost() == provider
    verify.assert_called_once_with("competition", privateRoot)


def testPrivateValidatorFailureIsSanitized(tmp_path, monkeypatch, caplog):
    clearHost(monkeypatch)
    from tools import runDemo
    privateRoot = Path(tmp_path.anchor) / "SyntheticPrivateEvidence"
    monkeypatch.setenv("CLINICAL_RUNTIME_MODE", "competition")
    monkeypatch.setenv("CLINICAL_EVIDENCE_ROOT", str(privateRoot))
    monkeypatch.setattr(runDemo, "configureDemo", Mock(side_effect=ValueError("synthetic-secret and private document payload")))
    with pytest.raises(serveTester.HostingError) as failure:
        serveTester.configureHost()
    assert str(failure.value) == "Tester hosting configuration is invalid." and not caplog.text


@pytest.mark.parametrize("provider", ["disabled", "deterministic"])
def testOnlyExplicitCompetitionEvaluatorIsInjected(provider, monkeypatch):
    clearHost(monkeypatch)
    monkeypatch.setenv("CLINICAL_RUNTIME_MODE", "competition")
    monkeypatch.setattr(serveTester, "configureHost", lambda: provider)
    import backend.app.main as application
    from backend.competition.deterministic import EvaluationLanguage
    create = Mock(return_value="Synthetic app sentinel")
    monkeypatch.setattr(application, "createApp", create)
    assert serveTester.buildApp() == "Synthetic app sentinel"
    assert create.call_args.args[0].runtimeMode() == "competition"
    language = create.call_args.kwargs["language"]
    assert isinstance(language, EvaluationLanguage) if provider == "deterministic" else language is None


def testHostedServerBindingAndPrivacy(monkeypatch):
    app = object()
    run = Mock()
    monkeypatch.setenv("PORT", "10000")
    monkeypatch.setattr(serveTester, "buildApp", lambda: app)
    monkeypatch.setitem(sys.modules, "uvicorn", SimpleNamespace(run=run))
    serveTester.main()
    run.assert_called_once_with(app, host="0.0.0.0", port=10000, workers=1, access_log=False,
                                proxy_headers=False, log_level="warning")


def testInvalidPortDoesNotConstructApp(monkeypatch):
    monkeypatch.delenv("PORT", raising=False)
    build = Mock(side_effect=AssertionError("Must not construct"))
    monkeypatch.setattr(serveTester, "buildApp", build)
    with pytest.raises(SystemExit, match="^Tester runtime is unavailable\\.$"):
        serveTester.main()
    build.assert_not_called()


def testFileBasedDebugCannotEnableHostedDebug(monkeypatch):
    clearHost(monkeypatch)
    import backend.app.config as configuration
    monkeypatch.setattr(configuration, "Settings", lambda: SimpleNamespace(debug=True))
    with pytest.raises(serveTester.HostingError, match="^Tester runtime is unavailable\\.$"):
        serveTester.buildApp()


def testNetlifyConfiguration():
    project = Path(__file__).resolve().parents[2]
    config = tomllib.loads((project / "netlify.toml").read_text(encoding="utf-8"))
    assert config["build"]["base"] == "."
    assert config["build"]["publish"] == "frontend/dist"
    assert (project / config["build"]["base"] / config["build"]["publish"]).relative_to(project).as_posix() == "frontend/dist"
    assert config["build"]["command"] == "npm --prefix frontend ci --ignore-scripts --no-audit --no-fund && npm --prefix frontend run build"
    assert config["build"]["environment"] == {"NODE_VERSION": "24.21.0"}
    assert config["redirects"] == [
        {"from": "/api/*", "to": "/.netlify/functions/evaluate/:splat", "status": 200, "force": True},
        {"from": "/*", "to": "/index.html", "status": 200},
    ]
    assert not any("http" in route["to"] for route in config["redirects"])
    assert config["functions"] == {"directory": "netlify/functions", "node_bundler": "esbuild", "included_files": ["netlify/RuntimeNotice.txt"]}
    assert config["dev"]["framework"] == "#static"
    unavailable = json.loads((project / "frontend/public/backend-unavailable.json").read_bytes())
    assert unavailable == {"detail": "Analysis is unavailable. No backend is configured for this site."}
    assert all(header["values"]["Cache-Control"] == "no-store" for header in config["headers"])
    assert (project / ".dockerignore").read_text().splitlines()[-1] == "**"
