'use client';
import { useEffect, useRef, useState } from 'react';
type Summary = Record<string, string | number | boolean | null>;
const storageKey = 'rg-full-snapshot-check-v1';
export default function FullRelayCheck() {
  const [summary, setSummary] = useState<Summary | null>(null), [history, setHistory] = useState<Summary[]>([]);
  const [requestId, setRequestId] = useState(''), [busy, setBusy] = useState(false), [confirming, setConfirming] = useState(false);
  const [scheduledDate, setScheduledDate] = useState(new Date().toISOString().slice(0,10));
  const lock = useRef(false);
  useEffect(() => { try { const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    setRequestId(saved.request_id ?? ''); setHistory(saved.history ?? []); setSummary(saved.history?.at(-1) ?? null);
  } catch {} }, []);
  function record(value: Summary, id: string) {
    setSummary(value); setHistory(previous => { const next = [...previous,value].slice(-30);
      try { localStorage.setItem(storageKey,JSON.stringify({request_id:id,history:next})); } catch {} return next; });
  }
  async function run(kind: 'start' | 'read' | 'scheduled') {
    if (lock.current || busy) return;
    if (kind === 'start' && !confirming) return;
    lock.current = true; setBusy(true); setConfirming(false);
    const id = kind === 'start' ? crypto.randomUUID() : requestId;
    if (kind === 'start') { setRequestId(id); record({state:'REQUEST_PENDING',error_code:'USE_INDEPENDENT_READ',checked_utc:new Date().toISOString()},id); }
    let timer: ReturnType<typeof setTimeout> | undefined; const controller = new AbortController();
    try {
      const action = async () => {
        const query = kind === 'scheduled' ? '?scheduled_date='+encodeURIComponent(scheduledDate) : '?request_id='+encodeURIComponent(id);
        const response = await fetch('/api/coupang/full-snapshot-check'+(kind==='start'?'':query),kind==='start' ? {
          method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:id}),signal:controller.signal,
        } : {cache:'no-store',signal:controller.signal});
        return await response.json() as Summary;
      };
      const deadline = new Promise<never>((_,reject) => { timer=setTimeout(()=>{controller.abort();reject(new Error('WAIT_EXPIRED'));},35000); });
      record(await Promise.race([action(),deadline]),id);
    } catch { record({state:kind==='start'?'WRITE_UNCERTAIN':'READ_UNCERTAIN',error_code:'USE_INDEPENDENT_READ',checked_utc:new Date().toISOString()},id); }
    finally { if(timer!==undefined)clearTimeout(timer);lock.current=false;setBusy(false); }
  }
  const terminal = ['COMPLETE','FAILED','EXPIRED','NOT_FOUND','BLOCKED'].includes(String(summary?.state)) || summary?.lease_expired === true;
  function download() {
    const url=URL.createObjectURL(new Blob([JSON.stringify(history,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=`full-snapshot-check-${Date.now()}.json`;link.click();URL.revokeObjectURL(url);
  }
  return <main className="p-6 max-w-3xl space-y-5">
    <h1 className="text-xl font-semibold">쿠팡 RG 전체 · 검증 스냅샷</h1>
    <p>다른 수집과 단독 조율 후 실행하세요. 기존 한 계정의 전체 페이지를 조회하되 최대 50페이지·1000행·실행 예산을 넘으면 실패 기록을 남깁니다.</p>
    <p>검증 전용 DB에만 저장합니다. 기존 운영 스냅샷·주문·창고재고·반품분류·판매 플랫폼은 바꾸지 않고 Slack과 다른 플랫폼도 실행하지 않습니다.</p>
    <div className="flex flex-wrap gap-3">
      <button disabled={busy||confirming|| (!!requestId&&!terminal)} onClick={()=>setConfirming(true)} className="border rounded px-4 py-2 disabled:opacity-50">전체 검증 실행 준비</button>
      <button disabled={busy||confirming||!requestId} onClick={()=>run('read')} className="border rounded px-4 py-2 disabled:opacity-50">저장본 독립 재조회</button>
      <button disabled={busy||!history.length} onClick={download} className="border rounded px-4 py-2">비민감 증거 저장</button>
    </div>
    {confirming&&<section aria-label="전체 검증 실행 확인" className="border rounded p-4 space-y-3">
      <p>기존 한 계정의 쿠팡 재고 전체 조회와 검증 전용 스냅샷 저장을 시작합니다. 중간 실패는 완료로 처리하지 않습니다. 다른 수집과 겹치지 않음을 확인했나요?</p>
      <button disabled={busy} onClick={()=>run('start')} className="border rounded px-4 py-2">확인 후 전체 검증 실행</button>
      <button disabled={busy} onClick={()=>setConfirming(false)} className="border rounded px-4 py-2 ml-3">취소</button>
    </section>}
    <p>응답이 불확실하면 실행을 반복하지 말고 저장본 독립 재조회부터 하세요. READING이 만료되면 기록을 보존하고 담당자와 새 실행을 조율하세요.</p>
    {busy&&<p role="status">처리 중입니다. 중복 실행하지 마세요.</p>}
    <section id="full-snapshot-summary" aria-label="전체 검증 비민감 요약" className="border rounded p-4">
      <h2 className="font-semibold">전체 검증 비민감 요약</h2>
      <dl className="grid grid-cols-2 gap-2">
        <dt>확인 UTC</dt><dd>{String(summary?.checked_utc??'실행 전')}</dd>
        <dt>상태</dt><dd>{String(summary?.state??'NOT_STARTED')}</dd>
        <dt>고정 오류 코드</dt><dd>{String(summary?.error_code??'NONE')}</dd>
        <dt>실행 구분</dt><dd>{String(summary?.trigger_kind??'확인 전')}</dd>
        <dt>완료 페이지</dt><dd>{String(summary?.pages??'확인 전')}</dd>
        <dt>고유 저장 행수</dt><dd>{String(summary?.rows??'확인 전')}</dd>
        <dt>독립 DB 행수</dt><dd>{String(summary?.independent_rows??'확인 전')}</dd>
        <dt>독립 내용 대조</dt><dd>{summary?.matches===true?'일치':summary?.matches===false?'미완료 또는 불일치':'확인 전'}</dd>
        <dt>완료 UTC</dt><dd>{String(summary?.finished_utc??'확인 전')}</dd>
        <dt>실행 소유 만료</dt><dd>{summary?.lease_expired===true?'만료 — 재실행 전 조율':'아니오 또는 확인 전'}</dd>
      </dl>
    </section>
    <section className="space-y-2"><h2 className="font-semibold">예약 결과 읽기 전용 확인</h2>
      <label>예약 기준 UTC 날짜 <input type="date" value={scheduledDate} onChange={e=>setScheduledDate(e.target.value)} className="border rounded p-2" /></label>
      <button disabled={busy||confirming} onClick={()=>run('scheduled')} className="border rounded px-4 py-2 ml-3">예약 저장본 조회만</button>
      <p>이 버튼은 예약을 호출하지 않습니다. 실제 예약 성공은 Vercel 예약 호출 증거와 DB 완료·독립 일치를 함께 확인해야 합니다.</p>
    </section>
  </main>;
}
