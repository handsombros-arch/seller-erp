-- 키워드별 Top-N 순위 스냅샷 (시간대별 누적)

-- 1) 추적할 키워드 정의
CREATE TABLE IF NOT EXISTS snapshot_keywords (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  platform    text NOT NULL DEFAULT 'coupang' CHECK (platform IN ('coupang')),
  keyword     text NOT NULL,
  top_n       integer NOT NULL DEFAULT 40 CHECK (top_n BETWEEN 10 AND 200),
  is_active   boolean NOT NULL DEFAULT true,
  auto_interval_minutes integer,          -- null = 수동만, 숫자면 해당 분 간격 자동 큐잉
  status      text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','queued','running','done','failed')),
  last_error  text,
  last_snapshot_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, keyword)
);

CREATE INDEX IF NOT EXISTS idx_snapshot_keywords_user ON snapshot_keywords(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshot_keywords_status ON snapshot_keywords(status);

-- 2) 각 스냅샷 실행 (한 번의 수집 시점)
CREATE TABLE IF NOT EXISTS keyword_snapshots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword_id  uuid NOT NULL REFERENCES snapshot_keywords(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  keyword     text NOT NULL,
  checked_at  timestamptz NOT NULL DEFAULT now(),
  top_n       integer NOT NULL,
  items_count integer,
  error       text
);

CREATE INDEX IF NOT EXISTS idx_keyword_snapshots_kw ON keyword_snapshots(keyword_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_keyword_snapshots_user ON keyword_snapshots(user_id, checked_at DESC);

-- 3) 스냅샷 항목 (Top-N 각 위치)
CREATE TABLE IF NOT EXISTS keyword_snapshot_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id   uuid NOT NULL REFERENCES keyword_snapshots(id) ON DELETE CASCADE,
  rank          integer NOT NULL,
  product_id    text,
  title         text,
  price         text,
  is_ad         boolean NOT NULL DEFAULT false,
  is_rocket     boolean NOT NULL DEFAULT false,
  thumbnail_url text,
  product_url   text,
  merchant_name text,
  rating        numeric,
  review_count  integer
);

CREATE INDEX IF NOT EXISTS idx_snapshot_items_snap ON keyword_snapshot_items(snapshot_id, rank);
CREATE INDEX IF NOT EXISTS idx_snapshot_items_product ON keyword_snapshot_items(product_id);

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION snapshot_keywords_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_snapshot_keywords_updated_at ON snapshot_keywords;
CREATE TRIGGER trg_snapshot_keywords_updated_at
BEFORE UPDATE ON snapshot_keywords
FOR EACH ROW EXECUTE FUNCTION snapshot_keywords_touch_updated_at();
