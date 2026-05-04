# 재고 관리 알고리즘 (seller-erp)

> 마지막 업데이트: 2026-05-04 — 이중 차감 버그 발견 및 수정.

## 데이터 모델

| 테이블 | 역할 |
|---|---|
| `inventory` | SKU × 창고 현재 수량 (단일 진실 — UNIQUE(sku_id, warehouse_id)) |
| `inventory_adjustments` | 모든 변동 이력 — `reason` 필드로 종류 구분 |
| `warehouse_inventory_snapshots` | 일자별 자사 창고 스냅샷 (추세 분석용) |
| `rg_inventory_snapshots` | 쿠팡 RG 창고 일자별 스냅샷 (자사 inventory 와 별개) |
| `channel_orders` | 전 채널 주문. `inventory_deducted`, `deducted_warehouse_id`, `cancelled_at` 으로 차감 상태 추적 |
| `inbound_records` / `outbound_records` | 입출고 기록 (트리거로 inventory 자동 반영) |

`inventory_adjustments.reason` 값 분류:
- `__ORDER__:<order_number>` — 주문 차감
- `__RESTORE__:<order_number>` — 반품 복구
- `__EXCHANGE_DEDUCT__:<id>` / `__EXCHANGE_RESTORE__:<id>` — 교환 처리
- `__PHYSICAL_COUNT__:<YYYY-MM-DD>` — 월별 실사 (덮어쓰기 + cutoff)
- `수동 조정` 등 — 사용자가 UI 에서 직접 조정

## 차감 트리거 조건 (이게 핵심)

`SHIPPED_STATUSES` (재고 차감 대상):
- 스마트스토어: `DELIVERING`, `DELIVERED`, `PURCHASE_DECIDED`
- 토스: `SHIPPING`, `PURCHASE_CONFIRMED`
- 쿠팡 Wing: `DELIVERING`
- 공통: `배송중`, `배송완료`

→ **배송준비중 / 결제취소** 는 차감 X (출고 전이라 재고 변동 없음)

`RETURN_STATUSES` (재고 복구 대상):
- `RETURN_DONE`, `RETURNED`, `RETURN_COMPLETED`

`SKIP_CHANNELS`: `coupang_rg` (쿠팡 자체 센터 출고 → 자사 inventory 무관)

## 이전 동작 (버그 있음)

두 경로가 동시 작동:
1. **DB BEFORE INSERT 트리거** `deduct_inventory_on_order()` — channel_orders 신규 INSERT 시 자동 차감. **`inventory_adjustments` 미기록**, `inventory_deducted = TRUE` 만 설정.
2. **앱 코드** `applyOrdersToInventory()` — cron daily 에서 호출. `inventory_adjustments` 의 `__ORDER__:` 행을 보고 미차감분 처리. 트리거가 audit 안 남기니 **모든 INSERT 후 호출되면 한 번 더 차감**.

→ **2026-05-04 이전 신규 주문은 이중 차감되어 실제 재고가 채널 매출보다 더 빠지고 있을 가능성.**

## 수정 후 동작 (이번 commit 부터)

1. **트리거 그대로 유지**: 신규 주문 INSERT → inventory 차감 + flag TRUE (DB 단 atomic)
2. **applyOrders 가 `inventory_deducted` 플래그 우선 확인**: 이미 TRUE 면 스킵 + 미존재 audit 백필만 (이중 차감 방지)
3. **applyOrders 가 차감 후 `channel_orders.inventory_deducted` 직접 업데이트** (트리거가 INSERT 에만 걸려 있어 backfill 케이스에서 필요)
4. **반품 복구도 동일**: 트리거가 UPDATE 시 cancelled_at 세팅 → applyOrders 는 그 행 스킵

## 멱등성 보장

| 시나리오 | 결과 |
|---|---|
| 신규 주문 INSERT | 트리거 1회 차감 + flag TRUE. applyOrders 는 다음 cron 에서 audit 백필만 |
| 같은 주문 재 sync (upsert) | upsert 가 `ignoreDuplicates: true` 라 INSERT 자체 안 됨 → 트리거도 안 탐 |
| 주문 상태가 취소/반품으로 UPDATE | UPDATE 트리거가 inventory 복구 + flag FALSE + cancelled_at = NOW() |
| applyOrders 재실행 | flag/audit 둘 중 하나라도 있으면 스킵 → 동작 0 |

## 이전 이중 차감분 진단 SQL

```sql
-- SKU 별 'expected vs actual' 비교
WITH src AS (
  SELECT s.id AS sku_id, s.code, s.name,
    -- 수동 조정 합계
    COALESCE(SUM(CASE WHEN ia.reason NOT LIKE '\_\_%' THEN ia.after_quantity - ia.before_quantity ELSE 0 END), 0) AS manual_delta,
    -- 주문 차감 (audit 기준)
    COALESCE(SUM(CASE WHEN ia.reason LIKE '\_\_ORDER\_\_:%' THEN ia.before_quantity - ia.after_quantity ELSE 0 END), 0) AS order_deduct_audit,
    -- 반품 복구 (audit 기준)
    COALESCE(SUM(CASE WHEN ia.reason LIKE '\_\_RESTORE\_\_:%' THEN ia.after_quantity - ia.before_quantity ELSE 0 END), 0) AS restore_audit
  FROM skus s
  LEFT JOIN inventory_adjustments ia ON ia.sku_id = s.id
  GROUP BY s.id, s.code, s.name
),
trigger_deduct AS (
  -- 트리거가 차감했는데 audit 안 남긴 분 = 이중 차감 가능성
  SELECT sku_id, SUM(quantity) AS qty
  FROM channel_orders
  WHERE inventory_deducted = TRUE
    AND order_number NOT IN (
      SELECT REPLACE(reason, '__ORDER__:', '')
      FROM inventory_adjustments
      WHERE reason LIKE '\_\_ORDER\_\_:%'
    )
  GROUP BY sku_id
)
SELECT
  src.code,
  src.name,
  i.quantity AS actual_qty,
  COALESCE(td.qty, 0) AS double_deducted_estimate
FROM src
LEFT JOIN inventory i ON i.sku_id = src.sku_id
LEFT JOIN trigger_deduct td ON td.sku_id = src.sku_id
WHERE COALESCE(td.qty, 0) > 0
ORDER BY td.qty DESC;
```

## 권장 운영 흐름 — 월별 실사

매월 1회 실측 → CSV 업로드 → 그 이후 자동.

1. **재고 페이지 → "CSV 일괄 기입" 다이얼로그**
2. **"월별 실사 모드" 토글 ON**
3. CSV 형식: `SKU코드, 창고명, 수량, 사유(선택)` 한 줄당 하나
4. 업로드 → 각 행이 `inventory_adjustments` 에 reason `__PHYSICAL_COUNT__:<YYYY-MM-DD>` 로 기록 + `inventory.quantity` 덮어쓰기
5. 그 이후 발생하는 모든 변동은 자동 적용:
   - **신규 주문 (쿠팡 Wing/네이버/토스/기타)** — DB 트리거가 INSERT 시 자동 차감 (배송중 이상)
   - **반품 완료** — UPDATE 트리거가 자동 복구
   - **cron daily** — 트리거가 놓친 케이스 백필 + audit 행 보강

실사 이전 주문은 `lastManualDate` 필터로 자동 무시 — 실사 수치에 이미 반영된 것으로 간주.

다음 달 실사 때 같은 절차 반복. 매월 1회 실측이 baseline 이고, 사이는 자동.

## 알려진 한계

1. **음수 재고 허용** — `GREATEST(0, qty - x)` 가 트리거에는 있지만 applyOrders 에는 없음. 차감량이 재고보다 크면 음수까지 내려감 (negativeSkuIds 로 보고됨, 실패는 아님)
2. **교환 자동 처리 X** — `EXCHANGE` 상태는 무엇으로 교환됐는지 확정 못 해서 수동
3. **수기 기입일 이전 주문 무시** — `lastManualDate` 이전 order_date 는 applyOrders 가 스킵 (재고 카운팅 시점 보호용)
4. **창고 선택 단순함** — 자사·3PL 창고 중 재고 가장 많은 1개 선택. 다중 창고 비례 분배 X
