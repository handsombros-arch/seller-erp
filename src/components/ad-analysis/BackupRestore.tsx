'use client';

import { useCallback, useEffect, useState } from 'react';
import { CloudDownload, Loader2, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { AppDialog } from '@/components/ui/app-dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';

export interface BackupFile { path: string; name: string; size: number | null; created_at: string | null }

/** 업로드한 원본 파일을 Storage 로 백업 (브라우저 → Storage 직접, 서명 토큰). 실패는 토스트로 드러낸다. */
export async function backupFiles(files: File[], onProgress?: (done: number, total: number) => void): Promise<{ ok: number; failed: string[] }> {
  const supabase = createClient();
  let ok = 0; const failed: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    try {
      const r = await fetch('/api/ad-analysis/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: f.name }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? String(r.status));
      const { error } = await supabase.storage.from(j.bucket).uploadToSignedUrl(j.path, j.token, f, { upsert: true });
      if (error) throw error;
      ok++;
    } catch (e: any) {
      failed.push(`${f.name}: ${e?.message ?? e}`);
    }
    onProgress?.(i + 1, files.length);
  }
  return { ok, failed };
}

const fmtSize = (n: number | null) => n == null ? '' : n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`;

/** "백업에서 복원" 버튼 + 파일 목록 다이얼로그. 선택한 파일을 내려받아 onRestore(files) 로 넘긴다 (기존 업로드 경로 재사용). */
/** 이 PC 브라우저에 있는 raw 를 월별 CSV 로 만들어 백업 — 원본 파일이 없어도 현재 데이터를 다른 PC 로 옮길 수 있다 */
export async function backupLocalRows(rows: Record<string, unknown>[], onProgress?: (msg: string) => void): Promise<{ ok: number; failed: string[] }> {
  const Papa = (await import('papaparse')).default;
  const byMonth = new Map<string, Record<string, unknown>[]>();
  for (let i = 0; i < rows.length; i++) {
    const d = String(rows[i]['날짜'] ?? '').replace(/\D/g, '');
    const ym = d.length >= 6 ? `${d.slice(0, 4)}${d.slice(4, 6)}` : 'unknown';
    let a = byMonth.get(ym); if (!a) { a = []; byMonth.set(ym, a); } a.push(rows[i]);
  }
  const files: File[] = [];
  for (const [ym, list] of [...byMonth.entries()].sort()) {
    onProgress?.(`${ym} CSV 만드는 중 (${list.length.toLocaleString()}행)`);
    const csv = Papa.unparse(list, { escapeChar: '\\' });
    files.push(new File(['\ufeff' + csv], `local-backup_${ym}_${new Date().toISOString().slice(0, 10)}.csv`, { type: 'text/csv' }));
  }
  onProgress?.(`${files.length}개 파일 업로드 중`);
  return backupFiles(files, (d, t) => onProgress?.(`업로드 ${d}/${t}`));
}

export function BackupRestore({ onRestore, disabled, localRows }: { onRestore: (files: File[]) => Promise<void> | void; disabled?: boolean; localRows?: Record<string, unknown>[] | null }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<BackupFile[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const confirmDialog = useConfirm();

  const load = useCallback(async () => {
    setFiles(null);
    const r = await fetch('/api/ad-analysis/files');
    const j = await r.json().catch(() => ({ files: [] }));
    const list: BackupFile[] = j.files ?? [];
    setFiles(list);
    setSel(new Set(list.map(f => f.path)));
  }, []);
  useEffect(() => { if (open) load(); }, [open, load]);

  async function restore() {
    const targets = (files ?? []).filter(f => sel.has(f.path));
    if (!targets.length) return;
    const out: File[] = [];
    try {
      for (let i = 0; i < targets.length; i++) {
        const f = targets[i];
        setBusy(`내려받는 중 ${i + 1}/${targets.length} · ${f.name}`);
        const r = await fetch(`/api/ad-analysis/files?download=${encodeURIComponent(f.path)}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? '다운로드 URL 실패');
        const blob = await fetch(j.url).then(x => { if (!x.ok) throw new Error(`${f.name} 다운로드 실패 (${x.status})`); return x.blob(); });
        out.push(new File([blob], f.name, { type: blob.type }));
      }
      setBusy('브라우저에서 다시 읽는 중… (파일이 크면 수십 초)');
      await onRestore(out);
      toast.success(`${out.length}개 파일 복원 완료 — 기존 데이터와 합쳐졌습니다`);
      setOpen(false);
    } catch (e: any) {
      toast.error(`복원 실패: ${e?.message ?? e}`);
    } finally { setBusy(null); }
  }

  async function backupLocal() {
    if (!localRows?.length) { toast.warning('이 PC 에 백업할 데이터가 없습니다'); return; }
    if (!(await confirmDialog(`이 PC 의 광고 raw ${localRows.length.toLocaleString()}행을 월별 CSV 로 서버에 백업할까요?\n크기에 따라 1~3분 걸립니다. 화면을 닫지 마세요.`))) return;
    setBusy('준비 중');
    try {
      const { ok, failed } = await backupLocalRows(localRows, setBusy);
      if (failed.length) toast.error(`백업 실패 ${failed.length}건: ${failed[0]}`); else toast.success(`${ok}개 월별 CSV 백업 완료`);
      load();
    } finally { setBusy(null); }
  }

  async function remove(f: BackupFile) {
    if (!(await confirmDialog(`백업 파일 '${f.name}' 을 삭제할까요?\n되돌릴 수 없습니다. 브라우저에 이미 읽어 둔 데이터는 그대로입니다.`))) return;
    const r = await fetch(`/api/ad-analysis/files?path=${encodeURIComponent(f.path)}`, { method: 'DELETE' });
    if (!r.ok) { toast.error('삭제 실패'); return; }
    load();
  }

  return (
    <>
      <Button variant="outline" size="lg" onClick={() => setOpen(true)} disabled={disabled} title="서버에 백업된 원본 보고서를 내려받아 이 PC 에 복원합니다"><CloudDownload /> 백업에서 복원</Button>
      <AppDialog open={open} onClose={() => !busy && setOpen(false)} title="백업 파일에서 복원" description="올린 원본 보고서는 서버 저장소에 자동 백업됩니다. 다른 PC 에서는 여기서 내려받아 복원하세요. 이미 있는 행은 중복 없이 합쳐집니다." wide>
        {files === null ? (
          <div className="py-8 text-center text-[13px] text-fg-4"><Loader2 className="inline h-4 w-4 animate-spin mr-1" /> 목록 불러오는 중</div>
        ) : files.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-fg-4 space-y-3">
            <div>백업된 파일이 없습니다. 이 화면에서 "데이터 추가"로 올린 파일부터 자동 백업됩니다.</div>
            {!!localRows?.length && <Button variant="outline" onClick={backupLocal} disabled={!!busy}>{busy ? <Loader2 className="animate-spin" /> : null} {busy ?? `이 PC 데이터 ${localRows.length.toLocaleString()}행을 월별 CSV 로 백업`}</Button>}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[12px] text-fg-3">
              <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" className="accent-brand" checked={sel.size === files.length} onChange={e => setSel(e.target.checked ? new Set(files.map(f => f.path)) : new Set())} /> 전체 선택</label>
              <span className="ml-auto">{sel.size}/{files.length}개 · {fmtSize(files.filter(f => sel.has(f.path)).reduce((s, f) => s + (f.size ?? 0), 0))}</span>
            </div>
            <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-line divide-y divide-line-2">
              {files.map(f => (
                <label key={f.path} className="flex items-center gap-3 px-3 py-2 text-[12px] hover:bg-card-2 cursor-pointer">
                  <input type="checkbox" className="accent-brand" checked={sel.has(f.path)} onChange={e => setSel(prev => { const n = new Set(prev); e.target.checked ? n.add(f.path) : n.delete(f.path); return n; })} />
                  <span className="truncate text-fg" title={f.name}>{f.name}</span>
                  <span className="ml-auto shrink-0 text-fg-4 tabular-nums">{fmtSize(f.size)}{f.created_at ? ` · ${f.created_at.slice(0, 10)}` : ''}</span>
                  <button onClick={(e) => { e.preventDefault(); remove(f); }} className="text-fg-5 hover:text-danger" title="백업 삭제"><Trash2 className="h-3.5 w-3.5" /></button>
                </label>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <span className="text-[12px] text-fg-4 mr-auto">{busy}</span>
              {!!localRows?.length && <Button variant="outline" onClick={backupLocal} disabled={!!busy} title="원본 파일 없이도 이 PC 의 현재 데이터를 월별 CSV 로 백업">이 PC 데이터 백업</Button>}
              <Button variant="outline" onClick={() => setOpen(false)} disabled={!!busy}>닫기</Button>
              <Button onClick={restore} disabled={!!busy || sel.size === 0}>{busy ? <Loader2 className="animate-spin" /> : <CloudDownload />} 선택 파일 복원</Button>
            </div>
          </div>
        )}
      </AppDialog>
    </>
  );
}
