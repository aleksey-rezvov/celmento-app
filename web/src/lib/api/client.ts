import createClient, { type Client } from "openapi-fetch";
import { currentContour, type Contour } from "../contour";
import { ERROR_CODES } from "./error-codes";
import type { components, paths } from "./schema";

export type Schemas = components["schemas"];

export function apiClient(
  token: string | null,
  contour: Contour = currentContour(),
): Client<paths> {
  const isCurrent = contour === currentContour();
  const origin = isCurrent
    ? process.env.NEXT_PUBLIC_CLM_APP_API_URL
    : process.env.NEXT_PUBLIC_CLM_APP_OTHER_ZONE_API_URL;

  if (!origin || (token !== null && !isCurrent)) {
    throw new Error("No API for this contour and session.");
  }

  return createClient<paths>({
    baseUrl: new URL("/api/v1", origin).href,
    headers: token ? { Authorization: "Bearer " + token } : undefined,
  });
}

export function errorCode(error: unknown): Schemas["ErrorCode"] | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }

  const { code } = error;
  return ERROR_CODES.find((candidate) => candidate === code) ?? null;
}
