'use client';
import {useEffect,useRef,useState} from 'react';
type Summary=Record<string,any>;
const storage='naver-read-only-check-v1';
function safe(value:Summary):Summary{
  const out:Summary={};
  for(const key of ['from','to']){const v=value?.range?.[key]??value?.['range_'+key];if(typeof v==='string'&&/^\d{4}-\d\d-\d\dT[0-9:.]+Z$/.test(v)&&Number.isFinite(Date.parse(v)))out['range_'+key]=v;}
  for(const key of ['checked_utc','commit'])if(typeof value?.[key]==='string'&&/^[a-zA-Z0-9:.+\-TZ]{1,64}$/.test(value[key]))out[key]=value[key];
  for(const key of ['state','error_code','limit_scope'])if(typeof value?.[key]==='string'&&/^[A-Z0-9_]{1,64}$/.test(value[key]))out[key]=value[key];
  for(const key of ['requests','list_rows','detail_rows','quantity_field_rows','payment_amount_field_rows','elapsed_ms','db_write_attempts','inventory_changes'])if(Number.isSafeInteger(value?.[key])&&value[key]>=0)out[key]=value[key];
  for(const key of ['relay_endpoint_verified','egress_ip_independently_observed'])if(typeof value?.[key]==='boolean')out[key]=value[key];
  out.stages=Array.isArray(value?.stages)?value.stages.slice(0,3).map((row:Summary)=>({stage:['TOKEN','ORDER_LIST','ORDER_DETAILS'].includes(row.stage)?row.stage:'UNKNOWN',
    method:['GET','POST'].includes(row.method)?row.method:'UNKNOWN',http_status:Number.isInteger(row.http_status)&&row.http_status>=100&&row.http_status<=599?row.http_status:null,
    state:typeof row.state==='string'&&/^[A-Z_]{1,32}$/.test(row.state)?row.state:'UNKNOWN'})):[];
  return out;
}
export default function NaverReadCheck(){
  const [from,setFrom]=useState(new Date(Date.now()-86400000).toISOString().slice(0,16));
  const [to,setTo]=useState(new Date().toISOString().slice(0,16));
  const [id,setId]=useState(''),[result,setResult]=useState<Summary>({state:'NOT_STARTED'}),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false);
  const lock=useRef(false);
  useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem(storage)??'{}');if(typeof saved.id==='string'){setId(saved.id);setResult(safe(saved.result??{}));}}catch{}},[]);
  function record(requestId:string,value:Summary){const summary=safe(value);setResult(summary);try{localStorage.setItem(storage,JSON.stringify({id:requestId,result:summary}));}catch{}}
  async function run(read:boolean){if(lock.current||busy||(!read&&(!confirm||!!id)))return;lock.current=true;setBusy(true);setConfirm(false);
    const requestId=read?id:crypto.randomUUID();setId(requestId);if(!read)record(requestId,{state:'REQUEST_PENDING',error_code:'READ_RESULT_ONLY'});
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),28000);
    try{const response=await fetch('/api/naver/read-only-check'+(read?'?request_id='+encodeURIComponent(requestId):''),read?{cache:'no-store',signal:controller.signal}:{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({request_id:requestId,from:from+':00.000Z',to:to+':00.000Z'}),signal:controller.signal});record(requestId,await response.json());}
    catch{record(requestId,{state:'REQUEST_UNCERTAIN',error_code:'READ_RESULT_ONLY'});}
    finally{clearTimeout(timer);lock.current=false;setBusy(false);}
  }
  return <main className="p-6 max-w-3xl space-y-4">
    <h1 className="text-xl font-semibold">네이버 주문 읽기 전용 진단</h1>
    <p>최근 7일 안의 최대 24시간을 조회합니다. 토큰 발급 1회, 첫 페이지 최대 5건, 상세 조회 최대 1회입니다. DB 저장·재고 반영·주문 처리·예약·외부 알림은 실행하지 않습니다.</p>
    <p>고정 IP 중계 주소를 검증합니다. 요청별 실제 외부 IP를 별도로 관측하는 시험은 아닙니다. 주문번호·고객 정보·금액 원문·인증정보는 표시하지 않습니다.</p>
    <label className="block">시작 UTC <input type="datetime-local" disabled={busy||!!id} value={from} onChange={e=>setFrom(e.target.value)} className="border rounded p-2"/></label>
    <label className="block">종료 UTC <input type="datetime-local" disabled={busy||!!id} value={to} onChange={e=>setTo(e.target.value)} className="border rounded p-2"/></label>
    <div className="flex gap-3"><button disabled={busy||!!id||confirm} onClick={()=>setConfirm(true)} className="border rounded p-2 disabled:opacity-50">네이버 주문 제한 조회 준비</button>
      <button disabled={busy||!id||confirm} onClick={()=>run(true)} className="border rounded p-2 disabled:opacity-50">기존 진단 결과 조회만</button></div>
    {confirm&&<section className="border rounded p-3 space-y-2"><p>다른 네이버 시험과 겹치지 않도록 조율한 뒤, 기존 인증으로 읽기만 1회 실행합니다.</p>
      <button disabled={busy} onClick={()=>run(false)} className="border rounded p-2">읽기만 1회 실행</button>
      <button disabled={busy} onClick={()=>setConfirm(false)} className="border rounded p-2 ml-2">취소</button></section>}
    <p>실행 후 새로고침해도 자동 재실행하지 않습니다. 결과가 불확실하거나 인스턴스 결과가 없으면 새 조회를 누르지 말고 담당자와 확인하세요. 요청량 제한은 함수 인스턴스와 이 브라우저에 적용됩니다.</p>
    <section id="naver-read-summary" aria-label="네이버 읽기 전용 비민감 요약" className="border rounded p-4"><h2 className="font-semibold">비민감 진단 결과</h2>
      <dl className="grid grid-cols-2 gap-2">{[['확인 UTC','checked_utc'],['실제 조회 시작 UTC','range_from'],['실제 조회 종료 UTC','range_to'],['상태','state'],['오류 코드','error_code'],['API 요청 수','requests'],['목록 반환 건수','list_rows'],['상세 반환 건수','detail_rows'],['수량 필드 확인 건수','quantity_field_rows'],['결제금액 필드 확인 건수','payment_amount_field_rows'],['소요시간 ms','elapsed_ms'],['DB 쓰기 횟수','db_write_attempts'],['재고 변경 횟수','inventory_changes'],['고정 중계 주소 검증','relay_endpoint_verified']].map(([label,key])=><div key={key}><dt>{label}</dt><dd>{String(result[key]??'확인 전')}</dd></div>)}</dl>
      <table className="mt-3"><thead><tr><th>단계</th><th>방식</th><th>HTTP</th><th>상태</th></tr></thead><tbody>{(result.stages??[]).map((row:Summary,i:number)=><tr key={i}><td>{row.stage}</td><td>{row.method}</td><td>{row.http_status??'없음'}</td><td>{row.state}</td></tr>)}</tbody></table>
    </section>
  </main>;
}
