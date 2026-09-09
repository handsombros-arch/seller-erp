-- 매출 파일 행에 옵션ID 보존 (2026-09-10) — 미매칭 행을 등록 필요 큐에 옵션ID 로 올리기 위해
ALTER TABLE monthly_product_sales ADD COLUMN IF NOT EXISTS vendor_item_id TEXT;
NOTIFY pgrst, 'reload schema';
