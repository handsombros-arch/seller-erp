import { NextRequest, NextResponse } from 'next/server';

const TEMPLATES: Record<string, { filename: string; csv: string }> = {
  products: {
    filename: 'products_template.csv',
    csv: '상품명,카테고리,브랜드,SKU코드,옵션1유형,옵션1값,옵션2유형,옵션2값,원가,물류비,안전재고,발주점,리드타임(일),공급처명\n'
      + '그랑누보 백팩,가방,그랑누보,GNB-001,색상,블랙,사이즈,M,15000,2000,10,5,30,홍콩상사\n'
      + '그랑누보 백팩,가방,그랑누보,GNB-002,색상,블랙,사이즈,L,15000,2000,10,5,30,홍콩상사\n',
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
