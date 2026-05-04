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

async function fetchCurrentDeployedSha(): Promise<string | null> {
  try {
    const r = await fetch('/api/deploy-info', { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.sha ?? null;
  } catch {
    return null;
  }
}

export function DeployStatus({ deployedSha }: { deployedSha?: string | null }) {
  // 페이지 로드 시점의 deployedSha 는 HTML 에 박혀있어 stale 가능 →
  // 클라이언트에서 /api/deploy-info 로 실제 현재 배포 SHA 를 따로 추적.
  const [liveDeployed, setLiveDeployed] = useState<string | null>(deployedSha ?? null);
  const [latest, setLatest] = useState<RemoteCommit | null>(null);
  const [now, setNow] = useState(Date.now());
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 폴링: 동기화 안된 동안 10초 (GitHub + 배포 SHA 둘 다), 동기화되면 60초로 느슨히.
  useEffect(() => {
    let alive = true;
    const inSync =
      !!liveDeployed && !!latest && liveDeployed.slice(0, 7) === latest.sha.slice(0, 7);
    const interval = inSync ? 60000 : POLL_INTERVAL_MS;

    const tick = async () => {
      const [gh, dep] = await Promise.all([fetchLatestMainCommit(), fetchCurrentDeployedSha()]);
      if (!alive) return;
      if (gh) setLatest(gh);
      if (dep) {
        setLiveDeployed((prev) => {
          // 새 배포 완료 감지: 이전 SHA 와 다르면, 그리고 GitHub latest 와 매치되면
          // 페이지 자동 새로고침 (사용자가 직접 새로고침 안 해도 새 코드 로드됨)
          if (prev && dep !== prev && gh && dep.slice(0, 7) === gh.sha.slice(0, 7)) {
            setTimeout(() => window.location.reload(), 500);
          }
          return dep;
        });
      }
    };

    tick();
    const id = setInterval(tick, interval);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [liveDeployed, latest?.sha]);

  // 진행률 갱신용 1초 ticker (배포 중일 때만 의미있게)
  useEffect(() => {
    const inSync =
      !!liveDeployed && !!latest && liveDeployed.slice(0, 7) === latest.sha.slice(0, 7);
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
  }, [liveDeployed, latest?.sha]);

  if (!liveDeployed) return null;

  const short = liveDeployed.slice(0, 7);
  if (!latest) {
    return (
      <span
        title={`배포된 버전: ${short}`}
        className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] text-[#6E6E73] border border-black/[0.08] bg-white"
      >
        <Check className="w-3 h-3 text-emerald-500" />
        배포됨 {short}
      </span>
    );
  }

  const inSync = liveDeployed.slice(0, 7) === latest.sha.slice(0, 7);
  if (inSync) {
    return (
      <span
        title={`최신 — ${latest.message}`}
        className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] text-emerald-700 border border-emerald-200 bg-emerald-50"
      >
        <Check className="w-3 h-3" />
        배포됨 <span className="font-mono">{short}</span>
      </span>
    );
  }

  // 배포 중 — 진행률 추정
  const elapsed = Math.max(0, Math.floor((now - latest.pushedAt) / 1000));
  const pct = Math.min(99, Math.round((elapsed / EST_DEPLOY_SEC) * 100));
  const remaining = Math.max(0, EST_DEPLOY_SEC - elapsed);
  return (
    <span
      title={`배포 중 — 새 commit ${latest.sha.slice(0, 7)} (${latest.message})\n현재 배포: ${short}\n경과 ${elapsed}초 / 예상 ${EST_DEPLOY_SEC}초\n완료 후 자동으로 페이지를 새로고침합니다.`}
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
