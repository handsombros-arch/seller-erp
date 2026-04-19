-- ad_memos 에 channel 컬럼 추가 (기존 데이터는 coupang 으로 유지)
ALTER TABLE ad_memos
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'coupang'
  CHECK (channel IN ('coupang','toss','smartstore'));

-- 기존 UNIQUE(date) → UNIQUE(date, channel) 로 전환
ALTER TABLE ad_memos DROP CONSTRAINT IF EXISTS ad_memos_date_key;
ALTER TABLE ad_memos ADD CONSTRAINT ad_memos_date_channel_key UNIQUE (date, channel);

CREATE INDEX IF NOT EXISTS idx_ad_memos_channel_date ON ad_memos(channel, date);

NOTIFY pgrst, 'reload schema';
