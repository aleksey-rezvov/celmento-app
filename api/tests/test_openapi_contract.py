from enum import StrEnum
from pathlib import Path
from typing import cast

import pytest
import yaml
from httpx import AsyncClient

from celmento_api.config import REPOSITORY_ROOT
from celmento_api.main import api
from celmento_api.models import enums

CONTRACT_PATH: Path = (
    REPOSITORY_ROOT.parent / "celmento-spex" / "contracts" / "api.openapi.yaml"
)
HTTP_METHODS: frozenset[str] = frozenset(
    {"get", "put", "post", "delete", "options", "head", "patch", "trace"},
)


def _object(value: object, label: str) -> dict[str, object]:
    assert isinstance(value, dict), f"Expected an object for {label}"
    return cast(dict[str, object], value)


@pytest.fixture(scope="session")
def openapi_contract() -> dict[str, object]:
    assert CONTRACT_PATH.is_file(), "Check out celmento-spex beside celmento-app"
    contract: object = yaml.safe_load(CONTRACT_PATH.read_text(encoding="utf-8"))
    return _object(contract, "OpenAPI contract")


async def test_openapi_is_served_under_the_api_prefix(api_client: AsyncClient) -> None:
    response = await api_client.get("/api/v1/openapi.json")
    assert response.status_code == 200

    schema = _object(response.json(), "generated OpenAPI")
    assert schema["openapi"] == "3.1.1"
    assert schema["servers"] == [{"url": "/api/v1"}]
    assert schema == api.openapi()

    for path in _object(schema["paths"], "generated paths"):
        assert path.startswith("/")
        assert path != "/api/v1" and not path.startswith("/api/v1/")


def test_implemented_operations_match_contract(
    openapi_contract: dict[str, object],
) -> None:
    actual_paths = _object(api.openapi()["paths"], "generated paths")
    expected_paths = _object(openapi_contract["paths"], "contract paths")

    for path, methods in actual_paths.items():
        for method, operation in _object(methods, path).items():
            if method not in HTTP_METHODS:
                continue
            label = f"{method.upper()} {path}"
            assert path in expected_paths, label
            expected_methods = _object(expected_paths[path], f"contract path {path}")
            assert method in expected_methods, label
            actual = _object(operation, f"generated {label}")
            expected = _object(expected_methods[method], f"contract {label}")
            assert actual["operationId"] == expected["operationId"], label
            assert (
                _object(actual["responses"], label).keys()
                == _object(
                    expected["responses"],
                    label,
                ).keys()
            ), label


def test_api_enumerations_match_contract(openapi_contract: dict[str, object]) -> None:
    components = _object(openapi_contract["components"], "contract components")
    schemas = _object(components["schemas"], "contract schemas")

    expected: dict[str, object] = {}
    for name, definition in schemas.items():
        schema = _object(definition, name)
        if "enum" in schema:
            expected[name] = schema["enum"]

    actual: dict[str, list[str]] = {}
    for name, candidate in vars(enums).items():
        symbol: object = candidate
        if (
            isinstance(symbol, type)
            and issubclass(symbol, StrEnum)
            and symbol is not StrEnum
        ):
            actual[name] = [member.value for member in symbol]

    assert expected
    assert actual == expected


def test_account_client_payment_and_meeting_request_bodies_are_named() -> None:
    paths = _object(api.openapi()["paths"], "generated paths")
    for path, method, media_type, name in (
        ("/account", "patch", "application/json", "AccountUpdate"),
        ("/account/photo", "put", "multipart/form-data", "ProfilePhotoUpload"),
        ("/clients", "post", "application/json", "ClientCreate"),
        ("/clients/{client_id}", "patch", "application/json", "ClientUpdate"),
        ("/clients/{client_id}/link", "put", "application/json", "ClientLinkByLogin"),
        (
            "/clients/{client_id}/photo",
            "put",
            "multipart/form-data",
            "ClientPhotoUpload",
        ),
        (
            "/clients/{client_id}/payments",
            "post",
            "application/json",
            "ClientPaymentCreate",
        ),
        (
            "/clients/{client_id}/payments/{payment_id}",
            "patch",
            "application/json",
            "ClientPaymentUpdate",
        ),
        ("/meetings", "post", "application/json", "MeetingCreate"),
        ("/meetings/{meeting_id}", "patch", "application/json", "MeetingUpdate"),
        (
            "/meetings/{meeting_id}/outcome",
            "put",
            "application/json",
            "MeetingOutcomeInput",
        ),
    ):
        operation = _object(_object(paths[path], path)[method], method)
        request = _object(operation["requestBody"], "requestBody")
        content = _object(request["content"], "requestBody content")
        schema = _object(_object(content[media_type], media_type)["schema"], "schema")
        assert request["required"] is True
        assert schema["$ref"] == f"#/components/schemas/{name}"
