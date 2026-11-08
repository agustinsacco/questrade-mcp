/**
 * Response shaping. Everything a tool returns passes through here so the
 * model gets compact, predictable JSON:
 *  - null / undefined / '' / [] / {} are dropped (absent means "not set")
 *  - long free-text fields are clipped in summary mode
 *  - lists come in one envelope: items, page/pageSize or offset/limit,
 *    totalCount, hasMore and nextPage/nextOffset
 *  - toText enforces the response budget
 */

export function compact(value, { clip = 0 } = {}) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    if (value === '' || value.trim() === '') return undefined;
    if (clip && value.length > clip) return `${value.slice(0, clip)}… [+${value.length - clip} chars]`;
    return value;
  }
  if (Array.isArray(value)) {
    const out = value.map((v) => compact(v, { clip })).filter((v) => v !== undefined);
    return out.length ? out : undefined;
  }
  if (typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) {
      const v = compact(value[key], { clip });
      if (v !== undefined) out[key] = v;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return value;
}

/** Clip long text fields (descriptions, notes) in list views. */
export const SUMMARY_CLIP = 280;

export function shape(value, detail = 'summary') {
  return compact(value, { clip: detail === 'full' ? 0 : SUMMARY_CLIP }) ?? null;
}

/** Client-side pagination: Questrade returns whole lists. */
export function paginateArray(all, { page = 1, pageSize = 20 } = {}) {
  const start = (page - 1) * pageSize;
  const items = all.slice(start, start + pageSize);
  const totalPages = Math.max(1, Math.ceil(all.length / pageSize));
  const hasMore = page < totalPages;
  return { items, page, pageSize, totalCount: all.length, totalPages, hasMore, ...(hasMore ? { nextPage: page + 1 } : {}) };
}

/** Offset/limit window over computed rows (reports, candles). */
export function windowRows(rows, { offset = 0, limit = 50 } = {}) {
  const items = rows.slice(offset, offset + limit);
  const hasMore = offset + items.length < rows.length;
  return { items, offset, limit, totalCount: rows.length, hasMore, ...(hasMore ? { nextOffset: offset + items.length } : {}) };
}

/**
 * Serialize for the model and enforce the response budget. When a payload is
 * over budget, trailing list items are removed (never silently: the result
 * says how many were dropped and how to page instead).
 */
export function toText(payload, maxChars) {
  let text = JSON.stringify(payload);
  if (!maxChars || text.length <= maxChars) return text;
  if (payload && Array.isArray(payload.items) && payload.items.length > 1) {
    const items = [...payload.items];
    const original = items.length;
    while (items.length > 1) {
      items.pop();
      const trimmed = {
        ...payload,
        items: [...items],
        truncated: {
          returned: items.length,
          of: original,
          reason: `Response exceeded ${maxChars} characters. Use a smaller pageSize/limit or detail="summary" to see the rest.`,
        },
      };
      text = JSON.stringify(trimmed);
      if (text.length <= maxChars) return text;
    }
    return text;
  }
  return JSON.stringify({
    truncated: true,
    reason: `Response exceeded ${maxChars} characters; narrow the request (filters, smaller pages, detail="summary").`,
    preview: text.slice(0, Math.max(0, maxChars - 300)),
  });
}

/** Round money and ratios for display without float noise (2 dp by default). */
export function round(value, dp = 2) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  const f = 10 ** dp;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** Sum numbers into per-key buckets, e.g. totals by currency. */
export function addTo(bucket, key, field, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return;
  bucket[key] ??= {};
  bucket[key][field] = round((bucket[key][field] ?? 0) + value, 6);
}
