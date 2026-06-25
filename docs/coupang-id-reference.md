# 쿠팡 ID 값 총정리 (seller-erp 기준)

쿠팡 관련 식별자가 여러 개라 헷갈리기 쉽다. 이 시스템에서 **어떤 ID가 무엇이고, 어디서 오고, 어디에 쓰이는지** 전수 정리.

## 한눈에

| ID | 자릿수 | 정체 | 매칭에 쓰나 | DB 위치 |
|---|---|---|---|---|
| **vendorItemId (옵션ID)** | 11자리 | 판매 **옵션**(색상/사이즈 조합) 식별자. 주문·광고·재고가 다 이 단위 | ✅ 핵심 | `platform_skus.platform_sku_id`, `rg_inventory_snapshots.vendor_item_id`, `rg_return_vendor_items.vendor_item_id` |
| **externalSkuId (외부SKU)** | 8자리 | 셀러가 등록 시 부여한 외부 SKU 코드 | △ 보조 | `rg_inventory_snapshots.external_sku_id` |
| **sellerProductId (등록상품ID)** | — | 쿠팡 Wing **상품**(옵션 묶음) 단위 | ✕ (조회용) | (저장 안 함, API 조회만) |
| **바코드 (barcode)** | — | 로켓그로스 **입고/물류용 물리 바코드** | ✕ 표시만 | `skus.barcode` |

## 광고 raw 엑셀의 옵션ID — 컬럼이 2개 ⚠️

둘 다 값 형식은 vendorItemId(11자리)인데 **의미가 다르고, 화면마다 다른 걸 매칭에 쓴다.**

| 엑셀 컬럼 | 의미 | 이걸 매칭에 쓰는 곳 |
|---|---|---|
| **`광고전환매출발생 옵션ID`** | 실제 **구매가 일어난** 옵션 | **광고분석 화면**(`ad-analysis/page.tsx:597`) — 매출/ROAS |
| **`광고집행 옵션ID`** | 광고가 **노출/집행된** 옵션 | **상품별 순이익 광고비**(`monthly-product-ads/route.ts:37`) |

- 고객이 A옵션 광고를 보고 B옵션을 사면 두 값이 **달라진다.**
- 그래서 같은 상품도 **광고분석 화면엔 매출 0인데 순이익 화면엔 광고비 잡히는** 식의 불일치가 가능.
- 👉 **광고분석 화면 매출을 잡으려면 마스터에 `광고전환매출발생 옵션ID`를 넣어야 한다.** (실제 사례: `94153738524`=집행ID로 넣어 0, `95429954704`/`95431118054`=전환ID로 바꾸니 잡힘)

## platform_skus DB 필드 (마스터 입력 → 저장)

| DB 필드 | 마스터 입력 칸 | 값 |
|---|---|---|
| `platform_sku_id` | 쿠팡 채널 **"상품ID"** | **vendorItemId(옵션ID)** — 광고분석 매칭의 핵심. 보통 `광고전환매출발생 옵션ID` |
| `platform_sku_id_return` | 반품 SKU ID | 반품용 옵션ID |
| `platform_product_id` | (비쿠팡 채널) 상품ID | 쿠팡이면 항상 `null` (`master:870-871`) |
| `price` | 판매가 | **필수.** 광고분석 매출 = `price × 주문수`. 없으면 매칭돼도 0 |

> ⚠️ 쿠팡 채널이 아닌 칸에 옵션ID를 넣으면 `platform_product_id`로 들어가 **매칭 안 됨.**

## sku_id 연결(매칭) 경로

옵션ID/외부SKU가 결국 내부 `sku_id`로 연결되는 흐름:

1. **광고분석 화면**: `광고전환매출발생 옵션ID` → `platform_skus.platform_sku_id` → `sku_id`
2. **주문/재고 동기화**(`matchSku.ts`, `sync-rg-inventory`):
   `vendorItemId` 또는 `externalSkuId` → `platform_skus.platform_sku_id` → `sku_id`
   (`sync-rg-inventory:98-100`: `extId` 우선, 없으면 `vid`로 매칭)
3. **상품별 광고비**(`monthly-product-ads`): `광고집행 옵션ID` → `rg_inventory_snapshots.vendor_item_id` 또는 `platform_skus.platform_sku_id` → `sku_id`

## 8자리 ↔ 11자리 변환

- 마스터에 **8자리 externalSkuId**만 넣어둔 경우, **마스터 "쿠팡 ID 동기화" 버튼**(`sync-platform-prices`)이 쿠팡 API로 조회해 **11자리 vendorItemId로 갱신**해 준다 (`route.ts:145-149`).
- 단, **가격은 절대 자동 안 채움** — 항상 수기 (`route.ts:133` "가격은 수기 입력 전용").

## 신상품 등록 체크리스트 (광고 매출까지 잡으려면)

1. `/products`에서 **상품/SKU 생성** (바코드는 안 넣어도 무방)
2. **마스터** → 그 SKU 행 → 쿠팡 채널 **"상품ID" = `광고전환매출발생 옵션ID`(11자리)** + **판매가** 입력 → 저장
3. **광고분석 F5** → 매출/ROAS 표시
4. (옵션) 순이익 광고비까지 정확히: `광고집행 옵션ID`도 같은 SKU로 잡히는지 확인 — 두 ID가 다르면 별도 고려 필요
