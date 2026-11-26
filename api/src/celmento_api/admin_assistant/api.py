from collections.abc import Mapping
from enum import StrEnum

from httpx import AsyncClient, RequestError
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import BaseModel, ValidationError


class Method(StrEnum):
    GET = "GET"
    POST = "POST"
    PUT = "PUT"


class AdminAPI:
    def __init__(self, client: AsyncClient) -> None:
        self._client = client

    # spec:impl admin-ai-assistant#limit-data-reachable-actions-f11
    async def request[Result: BaseModel](
        self,
        model: type[Result],
        method: Method,
        path: str,
        *,
        params: Mapping[str, str | bool] | None = None,
        body: BaseModel | None = None,
        not_found: str = "The requested object is missing in this contour.",
        conflict: str = "The requested change conflicts with the current state.",
    ) -> Result:
        try:
            response = await self._client.request(
                method,
                path,
                params=params,
                json=body.model_dump(mode="json") if body is not None else None,
                follow_redirects=False,
            )
        except RequestError:
            raise ToolError(
                "The configured administration API is unavailable."
            ) from None

        match response.status_code:
            case 401 | 403:
                raise ToolError("The administrator key is invalid or revoked.")
            case 404:
                raise ToolError(not_found)
            case 409:
                raise ToolError(conflict)
            case 422:
                raise ToolError(
                    "The administration API rejected the supplied arguments."
                )
            case _:
                pass

        if not response.is_success:
            raise ToolError(
                "The configured administration API could not complete the request."
            )

        try:
            return model.model_validate_json(response.content)
        except ValidationError:
            raise ToolError(
                "The administration API returned an unexpected response."
            ) from None
