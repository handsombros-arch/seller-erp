-- SKU에 수동 일일평균판매량 컬럼 추가 (시트 데이터 초기 입력용)
ALTER TABLE skus ADD COLUMN IF NOT EXISTS manual_daily_avg NUMERIC(8, 4) DEFAULT NULL;
