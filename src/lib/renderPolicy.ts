export function safeExternalLink(href: string | undefined, base = globalThis.location?.href ?? "https://markgrove.local/"): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href, base);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
