'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, RefreshCw } from 'lucide-react';

// Vercel 빌드 시 주입된 commit SHA 와 GitHub main 의 최신 SHA 를 비교.
// 배포 중이면 진행률(elapsed / EST_DEPLOY_SEC) 표시.
const REPO_PATH = 'handsombros-arch/seller-erp';
const POLL_INTERVAL_MS = 10000;
const EST_DEPLOY_SEC = 90; // 평균 빌드+배포 ~60-90초

type RemoteCommit = {
  sha: string;
  pushedAt: number; // ms epoch
  message: string;
};

async function fetchLatestMainCommit(): Promise<RemoteCommit | null> {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO_PATH}/commits/main`, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
    });
    if (!r.ok) return null;
    const data = await r.json();
    return {
      sha: String(data.sha ?? ''),
      pushedAt: data.commit?.committer?.date ? new Date(data.commit.committer.date).getTime() : Date.now(),
      message: String(data.commit?.message ?? '').split('\n')[0],
    };
  } catch {
    return null;
  }
}

export function DeployStatus({ deployedSha }: { deployedSha?: string | null }) {
  const [latest, setLatest] = useState<RemoteCommit | null>(null);
  const [now, setNow] = useState(Date.now());
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 폴링: 동기화되지 않은 동안 10초 간격, 동기화되면 60초 간격으로 느슨히
  useEffect(() => {
    let alive = true;
    const inSync =
      !!deployedSha && !!latest && deployedSha.slice(0, 7) === latest.sha.slice(0, 7);
    const interval = inSync ? 60000 : POLL_INTERVAL_MS;

    fetchLatestMainCommit().then((r) => alive && r && setLatest(r));
    const id = setInterval(() => {
      fetchLatestMainCommit().then((r) => alive && r && setLatest(r));
    }, interval);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [deployedSha, latest?.sha]);

  // 진행률 갱신용 1초 ticker (배포 중일 때만 의미있게)
  useEffect(() => {
    const inSync =
      !!deployedSha && !!latest && deployedSha.slice(0, 7) === latest.sha.slice(0, 7);
    if (inSync) {
      if (tickerRef.current) {
        clearInterval(tickerRef.current);
        tickerRef.current = null;
      }
      return;
    }
    if (!tickerRef.current) {
      tickerRef.current = setInterval(() => setNow(Date.now()), 1000);
    }
    return () => {
      if (tickerRef.current) {
        clearInterval(tickerRef.current);
        tickerRef.current = null;
      }
    };
  }, [deployedSha, latest?.sha]);

  if (!deployedSha) return null;

  const short = deployedSha.slice(0, 7);
  if (!latest) {
    // GitHub API 응답 전 — deployed 만 표시
    return (
      <span
        title={`배포된 버전: ${short}`}
        className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] text-[#6E6E73] border border-black/[0.08] bg-white"
      >
        <Check className="w-3 h-3 text-emerald-500" />
        {short}
      </span>
    );
  }

  const inSync = deployedSha.slice(0, 7) === latest.sha.slice(0, 7);
  if (inSync) {
    const ageMin = Math.max(0, Math.floor((now - latest.pushedAt) / 60000));
    return (
      <span
        title={`배포 최신 — ${latest.message}`}
        className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] text-emerald-700 border border-emerald-200 bg-emerald-50"
      >
        <Check className="w-3 h-3" />
        {short}
        {ageMin > 0 && <span className="text-emerald-600/70">· {ageMin}분 전</span>}
      </span>
    );
  }

  // 배포 중 — 진행률 추정
  const elapsed = Math.max(0, Math.floor((now - latest.pushedAt) / 1000));
  const pct = Math.min(99, Math.round((elapsed / EST_DEPLOY_SEC) * 100));
  const remaining = Math.max(0, EST_DEPLOY_SEC - elapsed);
  return (
    <span
      title={`배포 중 — 새 commit ${latest.sha.slice(0, 7)} (${latest.message})\n현재 배포: ${short}\n경과 ${elapsed}초 / 예상 ${EST_DEPLOY_SEC}초`}
      className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[11px] text-amber-800 border border-amber-300 bg-amber-50"
    >
      <RefreshCw className="w-3 h-3 animate-spin" />
      배포 중 {pct}%
      <span className="text-amber-700/70">
        {elapsed >= EST_DEPLOY_SEC ? '곧 완료' : `~${remaining}s`}
      </span>
    </span>
  );
}
