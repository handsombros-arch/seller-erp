-- 인사이트 기간 행에 빈박스(리뷰용 발송) 수량 (2026-09-11)
-- 윙(판매자배송) 판매량에는 리뷰용 빈박스가 섞인다. 순판매 = 총 판매수(취소 전) − 취소 − 빈박스.
ALTER TABLE coupang_insight_metrics ADD COLUMN IF NOT EXISTS empty_qty INTEGER NOT NULL DEFAULT 0;
NOTIFY pgrst, 'reload schema';
