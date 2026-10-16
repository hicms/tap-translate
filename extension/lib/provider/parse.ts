// Four-level parse tolerance. Each level is strictly more lenient than the
// last; only after all fail does the caller fall back to a bisect re-request.
//   L1: strict JSON              (array or {"0":..} object)
//   L2: strip ``` fences + retry
//   L3: regex-extract the first {...}/[...] snippet
//   L4: line/order alignment     (N non-empty lines → N translations)

function stripFences(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

function fromParsed(parsed: unknown, expectedLen: number): string[] | null {
  if (Array.isArray(parsed) && parsed.length === expectedLen) {
    // Preserve alignment, but leave invalid values empty for the scheduler's
    // failure/retry path instead of rendering "null" or "[object Object]".
    return parsed.map((item) => typeof item === 'string' ? item.trim() : '');
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    const out: string[] = [];
    for (let i = 0; i < expectedLen; i++) {
      if (!Object.hasOwn(obj, String(i))) return null;
      const val = obj[String(i)];
      out.push(typeof val === 'string' ? val.trim() : '');
    }
    return out;
  }
  return null;
}

function tryJson(text: string, expectedLen: number): string[] | null {
  try {
    return fromParsed(JSON.parse(text), expectedLen);
  } catch {
    return null;
  }
}

function fromLineAlignment(text: string, expectedLen: number): string[] | null {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/^\s*(?:\d+[.)\]:-]?|["'`\-*])\s*/, '').trim())
    .filter(Boolean);
  if (lines.length === expectedLen) return lines;
  return null;
}

/** Returns exactly `expectedLen` translations, or throws to trigger bisect. */
export function parseTranslationArray(raw: string, expectedLen: number): string[] {
  const stripped = stripFences(raw);

  // L1 + L2 (stripFences already applied) — strict parse.
  const strict = tryJson(stripped, expectedLen);
  if (strict) return strict;

  // L3 — extract the first plausible JSON snippet.
  const snippet = stripped.match(/\[[\s\S]*\]/)?.[0] ?? stripped.match(/\{[\s\S]*\}/)?.[0];
  if (snippet) {
    const extracted = tryJson(snippet, expectedLen);
    if (extracted) return extracted;
  }

  // L4 — line/order alignment.
  const aligned = fromLineAlignment(stripped, expectedLen);
  if (aligned) return aligned;

  throw new Error(`expected ${expectedLen} translations, got unparseable batch response`);
}
