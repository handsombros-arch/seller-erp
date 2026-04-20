-- ad_raw_rows 를 user 별로 분리: user_id 컬럼 + PK 변경 + backfill
ALTER TABLE ad_raw_rows
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- 기존 데이터는 현재 유일 사용자 (handsombros@gmail.com) 소유로 귀속
UPDATE ad_raw_rows
SET user_id = (SELECT id FROM auth.users WHERE email = 'handsombros@gmail.com' LIMIT 1)
WHERE user_id IS NULL;

-- PK 교체: dedup_key → (user_id, dedup_key) 로 여러 유저가 같은 dedup_key 공존 가능
ALTER TABLE ad_raw_rows DROP CONSTRAINT IF EXISTS ad_raw_rows_pkey;
ALTER TABLE ad_raw_rows ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE ad_raw_rows ADD PRIMARY KEY (user_id, dedup_key);

CREATE INDEX IF NOT EXISTS idx_ad_raw_rows_user_created ON ad_raw_rows(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_raw_rows_user_filename ON ad_raw_rows(user_id, filename);

NOTIFY pgrst, 'reload schema';
