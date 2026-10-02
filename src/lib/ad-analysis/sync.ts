export type AdRow = Record<string, unknown>;

export async function fetchAdHistory(fetchPage: (page: number) => Promise<{ rows: AdRow[]; storedCount?: number; pageSize: number }>): Promise<AdRow[]> {
  const first = await fetchPage(0);
  if (!Number.isSafeInteger(first.storedCount) || first.storedCount! < 0 || first.pageSize !== 500) throw new Error('서버 광고 건수 확인 실패');
  const rows = [...first.rows];
  const pages = Math.ceil(first.storedCount! / first.pageSize);
  for (let page = 1; page < pages; page += 4) {
    const results = await Promise.all(Array.from({ length: Math.min(4, pages - page) }, (_, i) => fetchPage(page + i)));
    for (const result of results) for (const row of result.rows) rows.push(row);
  }
  return rows;
}

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
