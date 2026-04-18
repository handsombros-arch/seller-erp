-- 소싱 분석 테이블
CREATE TABLE IF NOT EXISTS sourcing_analyses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  url         text NOT NULL,
  platform    text NOT NULL CHECK (platform IN ('coupang','naver','smartstore','brand','unknown')),
  product_id  text,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','crawling','analyzing','done','failed')),
  error       text,
  product_info     jsonb,   -- {title, price, detailImages: []}
  review_stats     jsonb,   -- {total, avgRating, ratingDist, withImages}
  detail_analysis  jsonb,   -- Gemini 상세이미지 분석 결과
  review_analysis  jsonb,   -- Gemini 리뷰 분석 결과
  reviews_count    integer,
  raw_path         text,    -- 로컬 파일 경로 (디버깅용)
  note             text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  analyzed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_sourcing_status ON sourcing_analyses(status);
CREATE INDEX IF NOT EXISTS idx_sourcing_user ON sourcing_analyses(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sourcing_platform ON sourcing_analyses(platform);

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION sourcing_analyses_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sourcing_analyses_updated_at ON sourcing_analyses;
CREATE TRIGGER trg_sourcing_analyses_updated_at
BEFORE UPDATE ON sourcing_analyses
FOR EACH ROW EXECUTE FUNCTION sourcing_analyses_touch_updated_at();
