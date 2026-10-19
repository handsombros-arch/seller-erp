'use client';
import {useEffect,useRef,useState} from 'react';
type Raw=Record<string,any>;const storage='coupang-orders-read-check-v1';
function safe(value:Raw){const out:Raw={};for(const key of ['state','error_code','limit_scope'])if(typeof value?.[key]==='string'&&/^[A-Z0-9_]{1,64}$/.test(value[key]))out[key]=value[key];
  for(const key of ['checked_utc','day_utc','commit'])if(typeof value?.[key]==='string'&&/^[a-zA-Z0-9:.+\-TZ]{1,64}$/.test(value[key]))out[key]=value[key];
  for(const key of ['requests','db_write_attempts','inventory_changes','elapsed_ms'])if(Number.isSafeInteger(value?.[key])&&value[key]>=0)out[key]=value[key];
  if(typeof value?.relay_endpoint_verified==='boolean')out.relay_endpoint_verified=value.relay_endpoint_verified;
  out.probes=Array.isArray(value?.probes)?value.probes.slice(0,2).map((p:Raw)=>({stage:['RG_ORDERS','WING_ORDERS'].includes(p.stage)?p.stage:'UNKNOWN',
    state:typeof p.state==='string'&&/^[A-Z_]{1,32}$/.test(p.state)?p.state:'UNKNOWN',http_status:Number.isInteger(p.http_status)&&p.http_status>=100&&p.http_status<=599?p.http_status:null,
    order_count:Number.isSafeInteger(p.order_count)&&p.order_count>=0?p.order_count:null,item_count:Number.isSafeInteger(p.item_count)&&p.item_count>=0?p.item_count:null,
    quantity_field_rows:Number.isSafeInteger(p.quantity_field_rows)&&p.quantity_field_rows>=0?p.quantity_field_rows:null,has_more:p.has_more===true})):[];return out;}
export default function CoupangOrdersReadCheck(){const[day,setDay]=useState(new Date(Date.now()-86400000).toISOString().slice(0,10)),[id,setId]=useState(''),[result,setResult]=useState<Raw>({state:'NOT_STARTED'}),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false);const lock=useRef(false);
  useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem(storage)??'{}');if(typeof saved.id==='string'){setId(saved.id);setResult(safe(saved.result??{}));}}catch{}},[]);
  function record(requestId:string,value:Raw){const summary=safe(value);setResult(summary);try{localStorage.setItem(storage,JSON.stringify({id:requestId,result:summary}));}catch{}}
  async function run(read:boolean){if(lock.current||busy||(!read&&(!confirm||!!id)))return;lock.current=true;setBusy(true);setConfirm(false);const requestId=read?id:crypto.randomUUID();setId(requestId);if(!read)record(requestId,{state:'REQUEST_PENDING',error_code:'READ_RESULT_ONLY'});const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),28000);
    try{const response=await fetch('/api/coupang/orders-read-only-check'+(read?'?request_id='+encodeURIComponent(requestId):''),read?{cache:'no-store',signal:controller.signal}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:requestId,date:day}),signal:controller.signal});record(requestId,await response.json());}catch{record(requestId,{state:'REQUEST_UNCERTAIN',error_code:'READ_RESULT_ONLY'});}finally{clearTimeout(timer);lock.current=false;setBusy(false);}}
  return <main className="p-6 max-w-4xl space-y-4"><h1 className="text-xl font-semibold">아침 쿠팡 주문 조회 읽기 전용 진단</h1>
    <p>아침 작업과 같은 RG 주문·Wing 발주서 조회 경로를 순서대로 읽습니다. 최근 7일 중 완료된 UTC 하루, 경로별 첫 페이지 최대 50주문이며 Wing은 ACCEPT 상태만 확인합니다. 모든 상태·전체 페이지 검증은 아닙니다.</p>
    <p>DB 저장·재고 차감/복구·분류·판매량 갱신·스냅샷·Slack·예약은 실행하지 않습니다. 고객 정보와 주문번호는 표시하지 않습니다. 고정 중계 주소를 확인하지만 실제 외부 IP를 따로 관측하지 않습니다.</p>
    <label className="block">완료된 UTC 날짜 <input type="date" disabled={busy||!!id} value={day} onChange={e=>setDay(e.target.value)} className="border rounded p-2"/></label>
    <div className="flex gap-3"><button disabled={busy||!!id||confirm} onClick={()=>setConfirm(true)} className="border rounded p-2 disabled:opacity-50">아침 주문 조회 진단 준비</button><button disabled={busy||!id||confirm} onClick={()=>run(true)} className="border rounded p-2 disabled:opacity-50">기존 진단 결과 조회만</button></div>
    {confirm&&<section className="border rounded p-3"><p>다른 쿠팡 요청과 겹치지 않음을 확인한 뒤 읽기만 한 번 실행합니다. 첫 실패에서 중단하고 자동 재시도하지 않습니다.</p><button disabled={busy} onClick={()=>run(false)} className="border rounded p-2">주문 조회만 1회 실행</button><button disabled={busy} onClick={()=>setConfirm(false)} className="border rounded p-2 ml-2">취소</button></section>}
    <p>결과가 불확실하거나 인스턴스 결과가 없으면 새로 실행하지 마세요. 이 브라우저는 시도 기록을 보존하며 서버 제한은 함수 인스턴스 범위입니다.</p>
    <section id="coupang-orders-read-summary" aria-label="쿠팡 주문 읽기 전용 비민감 요약" className="border rounded p-4"><dl className="grid grid-cols-2 gap-2">{[['확인 UTC','checked_utc'],['조회 UTC 날짜','day_utc'],['상태','state'],['오류 코드','error_code'],['실제 요청 수','requests'],['DB 쓰기 횟수','db_write_attempts'],['재고 변경 횟수','inventory_changes'],['고정 중계 주소 검증','relay_endpoint_verified']].map(([label,key])=><div key={key}><dt>{label}</dt><dd>{String(result[key]??'확인 전')}</dd></div>)}</dl>
      <table className="mt-3"><thead><tr><th>단계</th><th>HTTP</th><th>상태</th><th>주문 수</th><th>품목 수</th><th>수량 필드 확인</th><th>다음 페이지</th></tr></thead><tbody>{(result.probes??[]).map((p:Raw,i:number)=><tr key={i}><td>{p.stage}</td><td>{p.http_status??'없음'}</td><td>{p.state}</td><td>{p.order_count??'미확인'}</td><td>{p.item_count??'미확인'}</td><td>{p.quantity_field_rows??'미확인'}</td><td>{p.has_more?'있음':'없음 또는 미확인'}</td></tr>)}</tbody></table>
    </section></main>;
}
