"""Synthetic registry configuration and app isolation regressions."""

import json
import hashlib
from pathlib import Path

import pytest

from backend.app.config import Settings
from backend.app.main import createApp
from backend.app.modules.registry import ModuleRegistry, ModuleUnavailableError, ModuleSelectionError, RegistryConfigError


def makeConfig(moduleId="module_01_endo", **changes):
    config = dict(moduleId=moduleId, moduleName="Synthetic module", moduleHintValue="EndometriosisChronicPelvicPain" if moduleId == "module_01_endo" else moduleId,
                  version="1", kbVersion="1", reviewDate="2026-10-07", jurisdictionNotes="Synthetic", sourceRegister={}, active=True, status="approved")
    config.update(changes)
    return config


def writeConfig(root, folder, config):
    directory = root / folder
    directory.mkdir(parents=True)
    # Availability fixtures now carry synthetic checksum-bound provenance, never real evidence.
    (directory / "mirror.bin").write_bytes(b"Synthetic registry fixture")
    (directory / "sources.json").write_text(json.dumps({"sources": [dict(sourceId="Synthetic", organization="Synthetic", title="Synthetic", knowledgeFile="mirror.bin", status="pendingReview")]}), encoding="utf-8")
    config = dict(config)
    config.setdefault("sourceCatalog", "sources.json")
    config.setdefault("knowledgeChecksums", {"mirror.bin": hashlib.sha256(b"Synthetic registry fixture").hexdigest()})
    (directory / "config.json").write_text(json.dumps(config), encoding="utf-8")


def testExplicitModuleOne(tmp_path):
    writeConfig(tmp_path, "first", makeConfig())
    registry = ModuleRegistry(tmp_path)
    assert registry.resolveModule("module_01_endo").moduleId == "module_01_endo"
    assert registry.resolveModule("EndometriosisChronicPelvicPain").moduleId == "module_01_endo"
    assert [config.moduleId for config in registry.listModules()] == ["module_01_endo"]
    config = registry.getModule("module_01_endo")
    config.active = False
    assert registry.resolveModule("module_01_endo").active is True


@pytest.mark.parametrize("changes", [{"active": False}, {"status": "pending_review"}, {"status": "inactive"}, {"active": False, "status": "approved"}])
def testUnavailableStates(tmp_path, changes):
    writeConfig(tmp_path, "first", makeConfig(**changes))
    registry = ModuleRegistry(tmp_path)
    assert registry.listModules() == []
    with pytest.raises(ModuleUnavailableError, match="^Selected module is unavailable.$"):
        registry.resolveModule("module_01_endo")


def testSelectionDoesNotInspectClinicalText(tmp_path, caplog):
    writeConfig(tmp_path, "first", makeConfig())
    registry = ModuleRegistry(tmp_path)
    for selection in ["UnknownModule", "Synthetic pelvic pain notes", "", None, {"symptoms": "Synthetic"}]:
        with pytest.raises(ModuleUnavailableError) as failure:
            registry.resolveModule(selection)
        assert str(failure.value) == "Selected module is unavailable."
    with pytest.raises(ModuleSelectionError):
        registry.resolveModule("NotSure")
    with pytest.raises(TypeError):
        registry.resolveModule()
    assert caplog.text == ""


@pytest.mark.parametrize("changes", [{"unexpected": "Synthetic secret"}, {"active": "true"}, {"moduleId": "bad id"}, {"moduleName": ""}, {"moduleName": "x" * 201}, {"urgentRuleIds": ["bad id"]}, {"supportedCaseTypes": ["unknown"]}, {"status": "active"}])
def testMalformedConfigFailsSafely(tmp_path, changes, caplog):
    writeConfig(tmp_path, "first", makeConfig(**changes))
    with pytest.raises(RegistryConfigError) as failure:
        ModuleRegistry(tmp_path)
    assert str(failure.value) == "Invalid module configuration."
    assert caplog.text == ""


@pytest.mark.parametrize("content", ["{", '{"active": true, "active": false}', "[]"])
def testInvalidJson(tmp_path, content):
    directory = tmp_path / "first"
    directory.mkdir()
    (directory / "config.json").write_text(content, encoding="utf-8")
    with pytest.raises(RegistryConfigError):
        ModuleRegistry(tmp_path)


@pytest.mark.parametrize("second", [makeConfig(), makeConfig("Other", moduleHintValue="EndometriosisChronicPelvicPain"), makeConfig("Other", moduleHintValue="module_01_endo"), makeConfig("NotSure")])
def testDuplicateOrReservedSelections(tmp_path, second):
    writeConfig(tmp_path, "first", makeConfig())
    writeConfig(tmp_path, "second", second)
    with pytest.raises(RegistryConfigError):
        ModuleRegistry(tmp_path)


@pytest.mark.parametrize("knowledgePath", ["../outside", "first/../../outside", "missing", "", "C:/outside/content", "/outside/content"])
def testUnsafeKnowledgePaths(tmp_path, knowledgePath):
    writeConfig(tmp_path, "first", makeConfig(knowledgePath=knowledgePath))
    with pytest.raises(RegistryConfigError):
        ModuleRegistry(tmp_path)


def testContainedKnowledgePath(tmp_path):
    writeConfig(tmp_path, "first", makeConfig(knowledgePath="first/content.txt"))
    (tmp_path / "first" / "content.txt").write_text("Synthetic fixture", encoding="utf-8")
    assert ModuleRegistry(tmp_path).resolveModule("module_01_endo").knowledgePath == "first/content.txt"


def testEnumerationOrderAndAvailableOnly(tmp_path):
    for folder, moduleId, changes in [("a", "Zulu", {}), ("z", "Alpha", {}), ("b", "Disabled", {"active": False})]:
        writeConfig(tmp_path, folder, makeConfig(moduleId, **changes))
    assert [config.moduleId for config in ModuleRegistry(tmp_path).listModules()] == ["Alpha", "Zulu"]


def testAppRegistryIsolationAndInjection(tmp_path):
    firstRoot = tmp_path / "first"
    secondRoot = tmp_path / "second"
    writeConfig(firstRoot, "module", makeConfig())
    writeConfig(secondRoot, "module", makeConfig("Other"))
    firstApp = createApp(Settings(moduleRoot=firstRoot))
    secondApp = createApp(Settings(moduleRoot=secondRoot))
    assert firstApp.state.registry is not secondApp.state.registry
    assert firstApp.state.registry.resolveModule("module_01_endo").moduleId == "module_01_endo"
    with pytest.raises(ModuleUnavailableError):
        secondApp.state.registry.resolveModule("module_01_endo")
    injected = ModuleRegistry(firstRoot)
    assert createApp(Settings(moduleRoot=secondRoot), registry=injected).state.registry is injected


def testAppCreationFailsOnConfigError(tmp_path):
    writeConfig(tmp_path, "module", makeConfig(unexpected=True))
    with pytest.raises(RegistryConfigError):
        createApp(Settings(moduleRoot=tmp_path))


def testDefaultModuleRemainsUnavailable():
    registry = ModuleRegistry(Settings().moduleRoot)
    config = registry.getModule("module_01_endo")
    assert config.moduleHintValue == "EndometriosisChronicPelvicPain"
    assert config.sourceRegister == {} and config.knowledgePath is None and config.urgentRuleIds == []
    assert registry.listModules() == []


def testMissingRootFailsClosed(tmp_path):
    with pytest.raises(RegistryConfigError):
        ModuleRegistry(tmp_path / "missing")


def testMissingModuleConfigFailsClosed(tmp_path):
    (tmp_path / "unfinished").mkdir()
    with pytest.raises(RegistryConfigError):
        ModuleRegistry(tmp_path)


@pytest.mark.parametrize("target", ["config.json", "content.txt"])
def testRedirectedPathsFailClosed(tmp_path, monkeypatch, target):
    root = tmp_path / "root"
    outside = tmp_path / "outside"
    outside.write_text("Synthetic", encoding="utf-8")
    writeConfig(root, "first", makeConfig(knowledgePath="first/content.txt"))
    (root / "first" / "content.txt").write_text("Synthetic", encoding="utf-8")
    originalResolve = Path.resolve

    def resolvePath(path, *args, **options):
        # Simulate canonical targets of Windows junctions without symlink privileges.
        if path.name == target:
            return outside
        return originalResolve(path, *args, **options)

    monkeypatch.setattr(Path, "resolve", resolvePath)
    with pytest.raises(RegistryConfigError):
        ModuleRegistry(root)


def testConfigSizeLimit(tmp_path):
    writeConfig(tmp_path, "first", makeConfig(description="x" * 65536))
    with pytest.raises(RegistryConfigError):
        ModuleRegistry(tmp_path)


def testActivationDefaultsToDisabled(tmp_path):
    config = makeConfig()
    del config["active"]
    writeConfig(tmp_path, "first", config)
    registry = ModuleRegistry(tmp_path)
    assert registry.getModule("module_01_endo").active is False
    with pytest.raises(ModuleUnavailableError):
        registry.resolveModule("module_01_endo")


def testConfiguredRootAlias(tmp_path, monkeypatch):
    writeConfig(tmp_path, "first", makeConfig())
    monkeypatch.setenv("MODULE_ROOT", str(tmp_path))
    settings = Settings()
    assert settings.moduleRoot == tmp_path
    assert "moduleRoot" not in settings.model_dump()
    assert str(tmp_path) not in repr(settings)
    assert createApp(settings).state.registry.resolveModule("module_01_endo").moduleId == "module_01_endo"


def testReversedConfigurationCreationOrder(tmp_path):
    firstRoot = tmp_path / "first"
    secondRoot = tmp_path / "second"
    for moduleId in ["Zulu", "Alpha"]:
        writeConfig(firstRoot, moduleId, makeConfig(moduleId))
    for moduleId in ["Alpha", "Zulu"]:
        writeConfig(secondRoot, moduleId, makeConfig(moduleId))
    assert ModuleRegistry(firstRoot).listModules() == ModuleRegistry(secondRoot).listModules()
