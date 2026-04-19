-- 쿠팡 키워드 순위 추적
CREATE TABLE IF NOT EXISTS rank_keywords (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  platform    text NOT NULL DEFAULT 'coupang' CHECK (platform IN ('coupang')),
  keyword     text NOT NULL,
  product_id  text NOT NULL,
  product_name text,
  target_rank integer,
  max_pages   integer NOT NULL DEFAULT 5,
  is_active   boolean NOT NULL DEFAULT true,
  last_checked_at timestamptz,
  last_rank   integer,
  last_is_ad  boolean,
  last_page   integer,
  last_error  text,
  status      text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','queued','checking','done','failed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, keyword, product_id)
);

CREATE INDEX IF NOT EXISTS idx_rank_keywords_user ON rank_keywords(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rank_keywords_status ON rank_keywords(status);

-- 순위 이력 (일자별)
CREATE TABLE IF NOT EXISTS rank_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword_id   uuid NOT NULL REFERENCES rank_keywords(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  checked_at   timestamptz NOT NULL DEFAULT now(),
  checked_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date,
  rank         integer,          -- null = 미노출 (max_pages 내 없음)
  is_ad        boolean,
  page         integer,
  total_scanned integer,         -- 확인한 상품 수 (디버깅용)
  note         text
);

CREATE INDEX IF NOT EXISTS idx_rank_history_keyword ON rank_history(keyword_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_rank_history_date ON rank_history(checked_date);
CREATE INDEX IF NOT EXISTS idx_rank_history_user ON rank_history(user_id, checked_at DESC);

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION rank_keywords_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rank_keywords_updated_at ON rank_keywords;
CREATE TRIGGER trg_rank_keywords_updated_at
BEFORE UPDATE ON rank_keywords
FOR EACH ROW EXECUTE FUNCTION rank_keywords_touch_updated_at();
