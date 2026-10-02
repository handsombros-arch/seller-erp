export type AdRow = Record<string, unknown>;

// Preserve the existing database key so corrected reports replace legacy rows.
export function adRowKey(row: AdRow): string {
  const keyword = String(row['키워드'] ?? '').trim();
  return `${row['날짜']}|${keyword === '-' ? '' : keyword}|${row['광고전환매출발생 옵션ID'] ?? ''}|${row['광고 노출 지면'] ?? ''}`;
}

// One legacy key may contain several legitimate source rows, even with identical
// dimensions. Store the whole family atomically; never deduplicate inside a file.
const MEMBERS = '__adSourceRowsV2';
export function unpackAdRows(rows: AdRow[]): AdRow[] {
  const result: AdRow[] = [];
  for (const row of rows) {
    const members = row[MEMBERS];
    if (Array.isArray(members)) {
      for (const member of members) result.push(member as AdRow);
    } else result.push(row);
  }
  return result;
}

export function packAdRows(rows: AdRow[]): AdRow[] {
  const groups = new Map<string, AdRow[]>();
  for (const row of unpackAdRows(rows)) {
    const key = adRowKey(row);
    const group = groups.get(key);
    if (group) group.push(row); else groups.set(key, [row]);
  }
  return Array.from(groups.values(), members => members.length === 1
    ? members[0] : { ...members[0], [MEMBERS]: members });
}

/** Pending report families win; otherwise server wins, retaining local history. */
export function mergeAdRows(local: AdRow[], server: AdRow[], pending: AdRow[]): AdRow[] {
  const seen = new Set<string>();
  const result: AdRow[] = [];
  for (const rows of [pending, server, local]) {
    for (const row of packAdRows(rows)) {
      const key = adRowKey(row);
      if (!seen.has(key)) { seen.add(key); result.push(row); }
    }
  }
  return unpackAdRows(result);
}
