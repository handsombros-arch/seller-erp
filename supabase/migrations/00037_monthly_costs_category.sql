-- 월 고정비용 카테고리 분류
ALTER TABLE monthly_costs ADD COLUMN IF NOT EXISTS category text DEFAULT 'fixed';
-- 기존 데이터 카테고리 설정
UPDATE monthly_costs SET category = 'revenue' WHERE label LIKE '%매출%' AND parent_id IS NULL;
UPDATE monthly_costs SET category = 'cogs' WHERE label LIKE '%매입원가%' AND parent_id IS NULL;
UPDATE monthly_costs SET category = 'ad' WHERE label IN ('마케팅비', '토스') AND parent_id IS NULL;
-- 자식 항목은 부모 카테고리 따라감
UPDATE monthly_costs c SET category = p.category FROM monthly_costs p WHERE c.parent_id = p.id;
