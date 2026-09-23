const BARE_IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]+$/;

export function parseQrPayload(text: string): { publicIdentifier: string } | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  if (trimmed.includes("/")) {
    const match = trimmed.match(/\/p\/([^/?#]+)/);
    return match ? { publicIdentifier: match[1] } : null;
  }

  return BARE_IDENTIFIER_PATTERN.test(trimmed) ? { publicIdentifier: trimmed } : null;
}
