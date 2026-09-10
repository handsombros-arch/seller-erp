-- B2B 출고 내역 공급단가의 VAT 구분 (2026-09-10)
-- false = 공급단가가 공급가액(VAT 별도, 기본) / true = 단가에 VAT 포함 → 공급가액 = 단가 ÷ 1.1
ALTER TABLE b2b_lines ADD COLUMN IF NOT EXISTS price_incl_vat BOOLEAN NOT NULL DEFAULT false;
NOTIFY pgrst, 'reload schema';
