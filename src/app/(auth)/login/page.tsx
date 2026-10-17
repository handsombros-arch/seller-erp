'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2 } from 'lucide-react';
import { LVLogo } from '@/components/ui/lv-logo';

function safeLoginError(value: unknown) {
  const error = value as { status?: unknown; code?: unknown } | null;
  const allowedStatus = [0,400,401,403,408,422,429,500,502,503,504];
  const status = typeof error?.status === 'number' && allowedStatus.includes(error.status) ? error.status : null;
  const code = typeof error?.code === 'string' ? error.code : '';
  let diagnostic = 'AUTH_UNKNOWN';
  let message = '로그인 요청을 완료하지 못했습니다.';
  if (code === 'invalid_credentials' && (status === 400 || status === 401)) {
    diagnostic = 'LOGIN_INVALID_CREDENTIALS'; message = '인증 서버가 로그인 정보를 거부했습니다.';
  } else if (code === 'request_timeout' || status === 408 || status === 504) {
    diagnostic = 'AUTH_TIMEOUT'; message = '인증 서버 응답 시간이 초과됐습니다.';
  } else if (code === 'over_request_rate_limit' || status === 429) {
    diagnostic = 'AUTH_RATE_LIMITED'; message = '인증 요청이 제한됐습니다. 잠시 후 다시 확인하세요.';
  } else if (code === 'unexpected_failure' || status === 500 || status === 502 || status === 503) {
    diagnostic = 'AUTH_SERVER_ERROR'; message = '인증 서버에서 오류가 발생했습니다.';
  } else if (status === 0) {
    diagnostic = 'AUTH_NETWORK_ERROR'; message = '인증 서버에 연결하지 못했습니다.';
  } else if (status !== null) {
    diagnostic = 'AUTH_REJECTED'; message = '인증 요청이 거부됐습니다. 원인은 아직 확인되지 않았습니다.';
  }
  return `${message} [${diagnostic} · HTTP ${status ?? 'UNKNOWN'}]`;
}

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(safeLoginError(error));
        setLoading(false);
      } else {
        router.push('/');
        router.refresh();
      }
    } catch (error: unknown) {
      setError(safeLoginError(error));
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-app flex items-center justify-center px-4">
      <div className="w-full max-w-[400px]">
        {/* 로고 */}
        <div className="flex flex-col items-center mb-10">
          <LVLogo size={56} className="mb-4 drop-shadow-lg" />
          <h1 className="text-[24px] font-bold text-foreground tracking-[-0.03em]">LV ERP</h1>
          <p className="mt-1.5 text-[13px] text-fg-3">재고 · 발주 · 예측 통합 관리</p>
        </div>

        <div className="bg-card rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-7">
          <form onSubmit={handleLogin} className="space-y-4">
            {error && (
              <div role="alert" className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-[13px] text-red-600">
                {error}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-fg-3">이메일</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                required
                className="w-full h-11 px-4 rounded-xl border border-[#E8EAED] text-[13px] text-foreground placeholder:text-fg-5 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-fg-3">비밀번호</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full h-11 px-4 rounded-xl border border-[#E8EAED] text-[13px] text-foreground placeholder:text-fg-5 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-[50px] rounded-xl bg-primary text-white font-semibold text-[15px] tracking-[-0.01em] hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              로그인
            </button>
          </form>
        </div>

        <p className="text-center text-[12px] text-fg-5 mt-6">
          계정이 없으신가요? 관리자에게 문의하세요.
        </p>
      </div>
    </div>
  );
}
