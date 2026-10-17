'use client';
import { useEffect, useState } from 'react';
type Result = Record<string, string | number | boolean | null>;
const evidenceKey = 'rg-snapshot-check-evidence-v1';
export default function RelayCheckPage() {
  const [busy, setBusy] = useState(false), [result, setResult] = useState<Result | null>(null);
  const [history, setHistory] = useState<Result[]>([]);
  useEffect(() => { try { setHistory(JSON.parse(localStorage.getItem(evidenceKey) ?? '[]')); } catch {} }, []);
  async function run(action: 'prepare' | 'save' | 'read') {
    if (busy) return;
    if (action === 'prepare' && !confirm('다른 수집이 없도록 단독 조율했나요? 쿠팡 첫 페이지를 1회 조회합니다. 아직 저장하지 않습니다.')) return;
    if (action === 'save' && !confirm('준비된 스냅샷을 최대 1행 추가합니다. 기존 행·분류·창고 재고는 변경하지 않습니다. 진행할까요?')) return;
    setBusy(true);
    try {
      const response = await fetch('/api/coupang/snapshot-check', action === 'read' ? { cache: 'no-store' } : {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      const data: Result = await response.json();
      setResult(data);
      setHistory(previous => { const next = [...previous, data].slice(-20);
        try { localStorage.setItem(evidenceKey, JSON.stringify(next)); } catch {} return next; });
    } catch {
      const data = { state: 'RESPONSE_UNCERTAIN_USE_DB_READ', checked_utc: new Date().toISOString() };
      setResult(data);
    } finally { setBusy(false); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `snapshot-check-${Date.now()}.json`; link.click(); URL.revokeObjectURL(url);
  }
  return <main className="p-6 max-w-3xl space-y-5">
    <h1 className="text-xl font-semibold">쿠팡 중계 · 스냅샷 검증</h1>
    <p>다른 수집과 겹치지 않도록 조율한 뒤 실행하세요. 첫 페이지 1회에서 최대 10개 후보를 확인하고, 오늘 스냅샷이 없는 항목 최대 1행만 추가합니다.</p>
    <p>기존 스냅샷 덮어쓰기, 반품 분류 추가·삭제·연결, 창고 재고 차감·복원, 판매 플랫폼 변경, Slack, 다른 플랫폼 수집은 하지 않습니다. 전체 수집 검증은 아닙니다.</p>
    <div className="flex flex-wrap gap-3">
      <button disabled={busy} onClick={() => run('prepare')} className="border rounded px-4 py-2 disabled:opacity-50">1. 쿠팡 조회 · 저장 준비</button>
      <button disabled={busy || !(result?.state === 'READY_TO_SAVE' || result?.can_save === true)} onClick={() => run('save')} className="border rounded px-4 py-2 disabled:opacity-50">2. 스냅샷 최대 1행 저장</button>
      <button disabled={busy} onClick={() => run('read')} className="border rounded px-4 py-2 disabled:opacity-50">3. DB 독립 재조회</button>
      <button disabled={!history.length || busy} onClick={download} className="border rounded px-4 py-2 disabled:opacity-50">비민감 결과 저장</button>
    </div>
    <p>응답이 불확실하면 저장을 다시 누르지 말고 DB 독립 재조회부터 하세요. 준비 기록은 10분간 유지됩니다. 후보가 모두 기존 행이면 신규 저장은 하지 않습니다.</p>
    {busy && <p role="status">처리 중입니다. 다른 탭에서 중복 실행하지 마세요.</p>}
    <section id="snapshot-check-summary" aria-label="검증 비민감 요약" className="border rounded p-4 space-y-2" aria-live="polite">
      <h2 className="font-semibold">검증 비민감 요약</h2>
      <dl className="grid grid-cols-2 gap-2">
        <dt>확인 시각 UTC</dt><dd>{String(result?.checked_utc ?? '실행 전')}</dd>
        <dt>상태 코드</dt><dd>{String(result?.state ?? 'NOT_STARTED')}</dd>
        <dt>이번 단계 플랫폼 요청 횟수</dt><dd>{String(result?.provider_requests ?? '확인 전')}</dd>
        <dt>준비 단계에서 읽은 건수</dt><dd>{String(result?.provider_items_read ?? '확인 전')}</dd>
        <dt>확인한 유효 후보 건수</dt><dd>{String(result?.candidates_checked ?? '확인 전')}</dd>
        <dt>이번 단계 저장 시도 횟수</dt><dd>{String(result?.write_attempts ?? '확인 전')}</dd>
        <dt>이번 단계 새로 저장된 건수</dt><dd>{String(result?.inserted ?? '확인 전')}</dd>
        <dt>DB 존재 확인</dt><dd>{result?.present === true ? '있음' : result?.present === false ? '없음' : '확인 전'}</dd>
        <dt>독립 재조회 일치</dt><dd>{result?.matches_sample === true ? '일치' : result?.matches_sample === false ? '불일치' : '확인 전'}</dd>
      </dl>
    </section>
    <p className="text-sm">SAVED_AND_READ_BACK은 신규 저장 후 재조회, INDEPENDENT_READ_PRESENT는 별도 요청의 DB 존재 확인입니다. ALREADY_PRESENT는 신규 저장 미실행, WRITE_UNCERTAIN은 성공 확정 아님입니다. 비민감 결과만 이 브라우저에 보존됩니다.</p>
  </main>;
}
