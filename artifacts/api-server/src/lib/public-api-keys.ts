import type { Request } from "express";

const PUBLIC_KEY_HEADERS = {
  groq: "x-nexo-groq-key",
  gemini: "x-nexo-gemini-key",
} as const;

export function isPublicApiRequest(request: Request): boolean {
  return request.path === "/public" || request.path.startsWith("/public/");
}

export function getPublicProviderKey(
  request: Request,
  provider: keyof typeof PUBLIC_KEY_HEADERS,
): string | undefined {
  const value = request.get(PUBLIC_KEY_HEADERS[provider])?.trim();
  return value && value.length <= 512 ? value : undefined;
}
