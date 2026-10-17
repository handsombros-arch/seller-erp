export type SnapshotRow = {
  snapshot_date: string; vendor_item_id: string; external_sku_id: string | null;
  total_orderable_qty: number; sales_last_30d: number;
};
export type CheckReceipt = {
  user: string; id: string; issued: number; row: SnapshotRow; existed: boolean;
  provider_items_read: number; candidates_checked: number;
};
export function sampleRows(payload: unknown, date: string): SnapshotRow[] {
  const json = payload as { code?: unknown; data?: unknown };
  if (!json || (json.code != null && String(json.code) !== '200') || !Array.isArray(json.data)) {
    throw new Error('PROVIDER_RESPONSE_INVALID');
  }
  const seen = new Set<string>();
  const rows: SnapshotRow[] = [];
  // Inspect only the first ten items of one upstream page. Persist at most one.
  for (const item of json.data.slice(0, 10)) {
    const id = String(item?.vendorItemId ?? '');
    const qty = item?.inventoryDetails?.totalOrderableQuantity;
    const sales = item?.salesCountMap?.SALES_COUNT_LAST_THIRTY_DAYS ?? 0;
    if (!/^\d{1,32}$/.test(id) || !Number.isSafeInteger(qty) || qty < 0 ||
        !Number.isSafeInteger(sales) || sales < 0 || seen.has(id)) continue;
    const ext = item.externalSkuId == null ? null : String(item.externalSkuId);
    if (ext != null && ext.length > 128) continue;
    seen.add(id);
    rows.push({ snapshot_date: date, vendor_item_id: id, external_sku_id: ext,
      total_orderable_qty: qty, sales_last_30d: sales });
  }
  if (json.data.length && !rows.length) throw new Error('PROVIDER_RESPONSE_INVALID');
  return rows;
}
export function chooseRow(rows: SnapshotRow[], existing: string[]): { row: SnapshotRow; existed: boolean } | null {
  if (!rows.length) return null;
  const found = new Set(existing);
  const fresh = rows.find(row => !found.has(row.vendor_item_id));
  return { row: fresh ?? rows[0], existed: !fresh };
}
export async function saveSample(
  receipt: CheckReceipt,
  insertIgnoreDuplicate: (row: SnapshotRow) => Promise<{ inserted: number; uncertain: boolean }>,
  reread: (row: SnapshotRow) => Promise<SnapshotRow | null>,
) {
  if (receipt.existed) return { state: 'ALREADY_PRESENT', inserted: 0, present: !!await reread(receipt.row) };
  let inserted = 0, uncertain = false;
  try { const saved = await insertIgnoreDuplicate(receipt.row); inserted = saved.inserted; uncertain = saved.uncertain; }
  catch { uncertain = true; }
  // Always independently read after a write, including lost/uncertain responses.
  let stored: SnapshotRow | null;
  try { stored = await reread(receipt.row); }
  catch { return { state: 'WRITE_UNCERTAIN', inserted, present: null }; }
  if (!stored) return { state: uncertain ? 'WRITE_UNCERTAIN' : 'NOT_STORED', inserted, present: false };
  const matches = stored.total_orderable_qty === receipt.row.total_orderable_qty &&
    stored.sales_last_30d === receipt.row.sales_last_30d && stored.external_sku_id === receipt.row.external_sku_id;
  return { state: !matches ? 'PRESENT_DIFFERENT' : uncertain ? 'PRESENT_AFTER_UNCERTAIN_WRITE' :
    inserted === 1 ? 'SAVED_AND_READ_BACK' : 'ALREADY_PRESENT', inserted, present: true };
}
