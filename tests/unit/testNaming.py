"""Check field naming and environment compatibility after the naming migration."""

import inspect

import pytest
from pydantic import BaseModel

from backend.app import config
from backend.app.models import input, module, output, retrieval, safety


ModelClasses = [
    modelClass
    for modelModule in (config, input, module, output, retrieval, safety)
    for className, modelClass in inspect.getmembers(modelModule, inspect.isclass)
    if issubclass(modelClass, BaseModel) and modelClass is not BaseModel
]


@pytest.mark.parametrize("modelClass", ModelClasses)
def testFieldsUseCamelCase(modelClass):
    for fieldName in modelClass.model_fields:
        assert chr(95) not in fieldName


def testEnvironmentAliasesStillLoad(monkeypatch):
    monkeypatch.setenv("WATSONX_API_KEY", "synthetic-key")
    monkeypatch.setenv("MILVUS_PORT", "19531")
    monkeypatch.setenv("PII_FILTER_ENABLED", "false")
    settings = config.Settings()
    assert settings.watsonxApiKey.get_secret_value() == "synthetic-key"
    assert settings.milvusPort == 19531
    assert settings.piiFilterEnabled is False
