import { NextRequest, NextResponse } from 'next/server';

const TEMPLATES: Record<string, { filename: string; csv: string }> = {
  'platform-skus': {
    filename: 'platform_skus_template.csv',
    csv: 'SKU코드,채널명,플랫폼상품명,플랫폼상품ID,판매가\n'
      + 'GNB-001,스마트스토어,그랑누보 백팩 블랙M,123456789,39900\n'
      + 'GNB-001,쿠팡,그랑누보 백팩 블랙M 소형,COUPANG-001,42000\n',
  },
  products: {
    filename: 'products_template.csv',
    csv: '상품명,카테고리,브랜드,SKU코드,사이즈,색상,기타옵션,원가,물류비,리드타임(일),발주점,안전재고,공급처명,초기재고\n'
      + '# 설명,분류 (예: 가방/의류),브랜드명,고유코드(필수),사이즈 옵션(옵션1),색상 옵션(옵션2),3번째 옵션,원가(부가세별도),건당물류비,조달기간(일),발주 트리거 재고량,최소 보유 재고량,공급처명(공급처 등록 필요),현재 실사 재고\n'
      + '그랑누보 백팩,가방,그랑누보,GNB-BLK-M,M,블랙,,15000,2000,30,5,10,홍콩상사,50\n'
      + '그랑누보 백팩,가방,그랑누보,GNB-BLK-L,L,블랙,,15000,2000,30,5,10,홍콩상사,30\n'
      + '그랑누보 백팩,가방,그랑누보,GNB-RED-M,M,레드,,15000,2000,30,5,10,홍콩상사,20\n'
      + '심플 토트백,가방,그랑누보,GTB-001,,,단일상품,22000,2500,45,3,5,홍콩상사,100\n',
  },
  suppliers: {
    filename: 'suppliers_template.csv',
    csv: '업체명,담당자,국가코드,전화번호,이메일,국가,리드타임(일),주요상품,사무실,출고지,메모\n'
      + '홍콩상사,홍길동,+86,13800000000,test@example.com,중국,21,백팩·가방류,광저우시 텐허구 XX빌딩 3층,광저우시 판위구 XX물류단지,주력 공급사\n',
  },
  'channel-orders': {
    filename: 'channel_orders_template.csv',
    csv: '주문일자,상품명,옵션명,주문번호,수하인명,수량,택배운임,송장번호,주문상태,배송주소\n'
      + '2026-03-18,그랑누보 백팩,블랙/M,2026031800001,홍길동,2,3000,123456789012,배송완료,서울특별시 강남구 테헤란로 123\n'
      + '2026-03-18,그랑누보 백팩,블랙/L,2026031800002,김제주,1,6000,123456789013,배송완료,제주특별자치도 제주시 연동 123\n',
  },
  'sku-aliases': {
    filename: 'sku_aliases_template.csv',
    csv: '채널상품명,SKU코드\n'
      + '그랑누보 데일리 초경량 여자 백팩 가방,GNB-001\n',
  },
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') ?? '';
  const tmpl = TEMPLATES[type];

  if (!tmpl) {
    return NextResponse.json({ error: '잘못된 type' }, { status: 400 });
  }

  // BOM for Excel Korean compatibility
  const bom = '\uFEFF';
  return new NextResponse(bom + tmpl.csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${tmpl.filename}"`,
    },
  });
}
