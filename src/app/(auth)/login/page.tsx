'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Warehouse, Loader2 } from 'lucide-react';

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
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError('이메일 또는 비밀번호가 올바르지 않습니다.');
      setLoading(false);
    } else {
      router.push('/');
      router.refresh();
    }
  };

  return (
    <div className="min-h-screen bg-[#F2F4F6] flex items-center justify-center px-4">
      <div className="w-full max-w-[400px]">
        {/* 로고 */}
        <div className="flex flex-col items-center mb-10">
          <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center shadow-lg shadow-primary/20 mb-4">
            <Warehouse className="h-8 w-7 text-white" strokeWidth={2.5} />
          </div>
          <h1 className="text-[24px] font-bold text-foreground tracking-[-0.03em]">셀러 ERP</h1>
          <p className="mt-1.5 text-[13px] text-[#6B7684]">재고 · 발주 · 예측 통합 관리</p>
        </div>

        <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-7">
          <form onSubmit={handleLogin} className="space-y-4">
            {error && (
              <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-[13px] text-red-600">
                {error}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-[#6B7684]">이메일</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                required
                className="w-full h-11 px-4 rounded-xl border border-[#E8EAED] text-[13px] text-foreground placeholder:text-[#B0B8C1] focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-[#6B7684]">비밀번호</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full h-11 px-4 rounded-xl border border-[#E8EAED] text-[13px] text-foreground placeholder:text-[#B0B8C1] focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all"
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

        <p className="text-center text-[12px] text-[#B0B8C1] mt-6">
          계정이 없으신가요? 관리자에게 문의하세요.
        </p>
      </div>
    </div>
  );
}
