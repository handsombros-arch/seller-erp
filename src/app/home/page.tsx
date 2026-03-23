'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { LVLogo } from '@/components/ui/lv-logo';
import { ArrowRight, ArrowUpRight } from 'lucide-react';

/* ─── Scroll fade-in hook ──────────────────────────────────────────────────── */
function useFadeIn() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) el.classList.add('home-visible'); },
      { threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return ref;
}

function FadeIn({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useFadeIn();
  return (
    <div ref={ref} className={`home-fade ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/* ─── Animated grid background ─────────────────────────────────────────────── */
function GridBg() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div className="absolute inset-0" style={{
        backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
        backgroundSize: '60px 60px',
      }} />
      {/* Glowing orbs */}
      <div className="absolute top-[-200px] left-[20%] w-[600px] h-[600px] rounded-full bg-[#3182F6]/[0.07] blur-[120px]" />
      <div className="absolute top-[100px] right-[10%] w-[400px] h-[400px] rounded-full bg-[#6554C0]/[0.05] blur-[100px]" />
      <div className="absolute bottom-[-100px] left-[40%] w-[500px] h-[500px] rounded-full bg-[#00B8D9]/[0.04] blur-[100px]" />
    </div>
  );
}

/* ─── Floating metric card ─────────────────────────────────────────────────── */
function MetricCard({ label, value, sub, delay }: { label: string; value: string; sub: string; delay: number }) {
  return (
    <FadeIn delay={delay}>
      <div className="relative group">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/[0.08] to-white/[0.02] backdrop-blur-xl border border-white/[0.08]" />
        <div className="relative p-6">
          <p className="text-[11px] uppercase tracking-[0.15em] text-white/40 mb-3">{label}</p>
          <p className="text-[32px] sm:text-[36px] font-extralight text-white tracking-[-0.03em] leading-none">{value}</p>
          <p className="text-[12px] text-white/30 mt-2">{sub}</p>
        </div>
      </div>
    </FadeIn>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
export default function HomePage() {
  const [scrolled, setScrolled] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const handler = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);

  return (
    <div className="bg-[#0A0A0B] text-white selection:bg-[#3182F6]/30">
      {/* Inline styles for animations */}
      <style>{`
        .home-fade {
          opacity: 0;
          transform: translateY(32px);
          transition: opacity 0.8s cubic-bezier(0.16,1,0.3,1), transform 0.8s cubic-bezier(0.16,1,0.3,1);
        }
        .home-visible {
          opacity: 1;
          transform: translateY(0);
        }
        .home-hero-enter {
          opacity: 0;
          transform: translateY(24px);
          animation: heroIn 1s cubic-bezier(0.16,1,0.3,1) forwards;
        }
        .home-hero-enter-d1 { animation-delay: 0.1s; }
        .home-hero-enter-d2 { animation-delay: 0.25s; }
        .home-hero-enter-d3 { animation-delay: 0.4s; }
        .home-hero-enter-d4 { animation-delay: 0.55s; }
        @keyframes heroIn {
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        .home-float { animation: float 6s ease-in-out infinite; }
        .home-float-d { animation: float 6s ease-in-out 2s infinite; }
        @keyframes pulse-line {
          0% { transform: scaleX(0); opacity: 0; }
          50% { transform: scaleX(1); opacity: 1; }
          100% { transform: scaleX(0); opacity: 0; }
        }
      `}</style>

      {/* ─── Nav ───────────────────────────────────────────────────────────── */}
      <nav className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ${
        scrolled
          ? 'bg-[#0A0A0B]/80 backdrop-blur-2xl border-b border-white/[0.06]'
          : 'bg-transparent'
      }`}>
        <div className="max-w-[1200px] mx-auto flex items-center justify-between h-[72px] px-6 sm:px-10">
          <div className="flex items-center gap-3">
            <LVLogo size={32} />
            <span className="text-[15px] font-semibold tracking-[-0.01em] text-white/90">LV ERP</span>
          </div>
          <Link href="/login"
            className="group h-10 px-6 rounded-full bg-white text-[#0A0A0B] text-[13px] font-semibold flex items-center gap-2 hover:bg-white/90 transition-all">
            로그인
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </nav>

      {/* ─── Hero ──────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
        <GridBg />

        <div className="relative max-w-[1200px] mx-auto px-6 sm:px-10 pt-32 pb-24 w-full">
          <div className="max-w-[720px]">
            {/* Badge */}
            {mounted && (
              <div className="home-hero-enter home-hero-enter-d1 inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] backdrop-blur-sm text-[12px] text-white/50 mb-8">
                <span className="w-1.5 h-1.5 rounded-full bg-[#36B37E] animate-pulse" />
                셀러를 위한 올인원 ERP 플랫폼
              </div>
            )}

            {/* Heading */}
            {mounted && (
              <h1 className="home-hero-enter home-hero-enter-d2 text-[44px] sm:text-[64px] lg:text-[76px] font-extralight leading-[1.05] tracking-[-0.04em] mb-8">
                재고부터 손익까지
                <br />
                <span className="bg-gradient-to-r from-[#3182F6] via-[#6C9BF6] to-[#3182F6] bg-clip-text text-transparent">
                  하나의 흐름
                </span>으로
              </h1>
            )}

            {/* Subtitle */}
            {mounted && (
              <p className="home-hero-enter home-hero-enter-d3 text-[16px] sm:text-[18px] text-white/35 leading-[1.7] max-w-[480px] mb-12 font-light">
                쿠팡, 네이버, 토스 — 흩어진 데이터를 하나로 모아
                <br className="hidden sm:block" />
                자동화된 재고 · 발주 · 분석 워크플로우를 경험하세요.
              </p>
            )}

            {/* CTA */}
            {mounted && (
              <div className="home-hero-enter home-hero-enter-d4 flex items-center gap-4">
                <Link href="/login"
                  className="group h-13 px-8 rounded-full bg-[#3182F6] text-white text-[14px] font-semibold flex items-center gap-2.5 hover:bg-[#4A9AF8] transition-all shadow-[0_0_40px_rgba(49,130,246,0.3)]">
                  시작하기
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
                <a href="#features"
                  className="h-13 px-6 rounded-full text-white/40 text-[14px] font-medium flex items-center gap-2 hover:text-white/70 transition-colors">
                  더 알아보기
                </a>
              </div>
            )}
          </div>

          {/* Floating dashboard preview (right side, desktop) */}
          {mounted && (
            <div className="hidden lg:block absolute top-1/2 -translate-y-1/2 right-10 w-[380px]">
              <div className="home-hero-enter home-hero-enter-d4 home-float">
                <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-xl p-5 shadow-[0_20px_80px_rgba(0,0,0,0.4)]">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-2 h-2 rounded-full bg-[#36B37E]" />
                    <span className="text-[11px] text-white/30 tracking-wider uppercase">Live Dashboard</span>
                  </div>
                  <div className="space-y-2.5">
                    {[
                      { label: '오늘 주문', val: '47건', bar: 72, color: '#3182F6' },
                      { label: '재고 차감', val: '38건', bar: 58, color: '#00B8D9' },
                      { label: '발주 필요', val: '8 SKU', bar: 25, color: '#FF5630' },
                      { label: 'RG 동기화', val: '105개', bar: 90, color: '#36B37E' },
                    ].map((row) => (
                      <div key={row.label} className="flex items-center gap-3 py-2">
                        <span className="text-[11px] text-white/30 w-[70px] shrink-0">{row.label}</span>
                        <div className="flex-1 h-1 rounded-full bg-white/[0.06] overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${row.bar}%`, background: row.color, opacity: 0.6 }} />
                        </div>
                        <span className="text-[12px] text-white/60 font-mono w-[50px] text-right">{row.val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="home-hero-enter home-hero-enter-d4 home-float-d mt-4 ml-8">
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-xl p-4 shadow-[0_10px_40px_rgba(0,0,0,0.3)]">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#FEBC2E]" />
                    <span className="text-[11px] text-white/40">알림</span>
                  </div>
                  <p className="text-[12px] text-white/50 mt-2">안전재고 이하 8개 SKU 감지</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
          <div className="w-px h-8 bg-gradient-to-b from-transparent to-white/20" />
        </div>
      </section>

      {/* ─── Metrics ───────────────────────────────────────────────────────── */}
      <section className="relative py-24 border-t border-white/[0.04]">
        <div className="max-w-[1200px] mx-auto px-6 sm:px-10">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard label="연동 채널" value="4" sub="쿠팡 · 네이버 · 토스" delay={0} />
            <MetricCard label="동기화" value="100%" sub="주문 자동 수집" delay={100} />
            <MetricCard label="모니터링" value="24h" sub="무중단 운영" delay={200} />
            <MetricCard label="리포트" value="30s" sub="일일 자동 생성" delay={300} />
          </div>
        </div>
      </section>

      {/* ─── Features ──────────────────────────────────────────────────────── */}
      <section id="features" className="relative py-32">
        <div className="max-w-[1200px] mx-auto px-6 sm:px-10">
          <FadeIn>
            <p className="text-[11px] uppercase tracking-[0.2em] text-[#3182F6] mb-4">Features</p>
            <h2 className="text-[32px] sm:text-[44px] font-extralight tracking-[-0.03em] leading-[1.15] mb-20">
              복잡한 운영을<br />
              <span className="text-white/40">단순하게</span>
            </h2>
          </FadeIn>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-white/[0.04] rounded-2xl overflow-hidden">
            {[
              {
                num: '01',
                title: '실시간 재고',
                desc: '창고별 현황을 한눈에. 안전재고 이하 시 자동 알림.',
                accent: '#3182F6',
              },
              {
                num: '02',
                title: '전 채널 동기화',
                desc: '쿠팡, 네이버, 토스 주문을 매일 자동으로 수집.',
                accent: '#00B8D9',
              },
              {
                num: '03',
                title: '발주 · 입출고',
                desc: '리드타임 자동 계산. 최적의 발주 시점을 놓치지 않도록.',
                accent: '#36B37E',
              },
              {
                num: '04',
                title: '판매 예측',
                desc: '7/30일 추이 분석과 재고 소진 예측.',
                accent: '#6554C0',
              },
              {
                num: '05',
                title: '대시보드',
                desc: '매출, 재고, 주문을 한 화면에. Slack 리포트 자동 발송.',
                accent: '#FF5630',
              },
              {
                num: '06',
                title: '안정적 인프라',
                desc: 'Vercel + Supabase. 빠르고 안전한 데이터 관리.',
                accent: '#8B95A1',
              },
            ].map((feat, i) => (
              <FadeIn key={feat.num} delay={i * 80}>
                <div className="group bg-[#0A0A0B] p-8 sm:p-10 hover:bg-white/[0.02] transition-colors duration-500 h-full">
                  <span className="text-[11px] font-mono tracking-wider mb-6 block" style={{ color: feat.accent }}>{feat.num}</span>
                  <h3 className="text-[18px] font-medium text-white/90 mb-3 tracking-[-0.01em]">{feat.title}</h3>
                  <p className="text-[13px] text-white/30 leading-[1.7]">{feat.desc}</p>
                  <div className="mt-6 h-px w-8 group-hover:w-16 transition-all duration-500" style={{ background: feat.accent, opacity: 0.4 }} />
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Workflow ──────────────────────────────────────────────────────── */}
      <section className="relative py-32 border-t border-white/[0.04]">
        <div className="max-w-[1200px] mx-auto px-6 sm:px-10">
          <div className="grid lg:grid-cols-[1fr_1.2fr] gap-20 items-start">
            <div>
              <FadeIn>
                <p className="text-[11px] uppercase tracking-[0.2em] text-[#3182F6] mb-4">Workflow</p>
                <h2 className="text-[32px] sm:text-[44px] font-extralight tracking-[-0.03em] leading-[1.15] mb-6">
                  매일 아침,<br />
                  <span className="text-white/40">자동으로 완료됩니다</span>
                </h2>
                <p className="text-[14px] text-white/25 leading-[1.8] mb-12 max-w-[380px]">
                  반복되는 수작업 대신 자동화된 워크플로우로 셀러가 본업에 집중할 수 있도록 합니다.
                </p>
              </FadeIn>

              <div className="space-y-0">
                {[
                  { time: '08:00', title: '주문 자동 수집', desc: '4개 채널 신규 주문 동기화' },
                  { time: '08:01', title: '재고 반영', desc: '배송건 차감, 반품 복구 자동 처리' },
                  { time: '08:02', title: '이상 감지', desc: '급증/급감, 안전재고 이하 알림' },
                  { time: '08:03', title: '리포트 발송', desc: 'Slack으로 일일 요약 전달' },
                ].map((step, i) => (
                  <FadeIn key={step.time} delay={i * 120}>
                    <div className="flex gap-5 group">
                      <div className="flex flex-col items-center">
                        <div className="w-2 h-2 rounded-full bg-white/20 group-hover:bg-[#3182F6] transition-colors mt-2" />
                        {i < 3 && <div className="w-px flex-1 bg-white/[0.06]" />}
                      </div>
                      <div className="pb-8">
                        <span className="text-[11px] font-mono text-white/20">{step.time}</span>
                        <h4 className="text-[15px] font-medium text-white/80 mt-1">{step.title}</h4>
                        <p className="text-[13px] text-white/25 mt-1">{step.desc}</p>
                      </div>
                    </div>
                  </FadeIn>
                ))}
              </div>
            </div>

            {/* Terminal-style card */}
            <FadeIn delay={200}>
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden shadow-[0_30px_100px_rgba(0,0,0,0.4)]">
                <div className="flex items-center gap-1.5 px-5 py-3.5 border-b border-white/[0.06]">
                  <div className="w-2.5 h-2.5 rounded-full bg-white/[0.08]" />
                  <div className="w-2.5 h-2.5 rounded-full bg-white/[0.08]" />
                  <div className="w-2.5 h-2.5 rounded-full bg-white/[0.08]" />
                  <span className="ml-3 text-[11px] text-white/20 font-mono">daily-sync — 2026.03.23</span>
                </div>
                <div className="p-6 font-mono text-[12px] leading-[2]">
                  <p className="text-white/20"><span className="text-[#36B37E]/60">$</span> sync-orders --all-channels</p>
                  <p className="text-white/40 pl-4">쿠팡 그로스 <span className="text-[#3182F6]">27건</span></p>
                  <p className="text-white/40 pl-4">쿠팡 Wing <span className="text-[#3182F6]">12건</span></p>
                  <p className="text-white/40 pl-4">스마트스토어 <span className="text-[#36B37E]">8건</span></p>
                  <p className="text-white/40 pl-4">토스 <span className="text-[#6554C0]">3건</span></p>
                  <p className="text-white/15 mt-2">──────────────────────────</p>
                  <p className="text-white/20"><span className="text-[#36B37E]/60">$</span> apply-inventory</p>
                  <p className="text-white/40 pl-4">차감 <span className="text-[#00B8D9]">42건</span> · 복구 <span className="text-[#36B37E]">3건</span></p>
                  <p className="text-white/20 mt-2"><span className="text-[#36B37E]/60">$</span> sync-rg-inventory</p>
                  <p className="text-white/40 pl-4">동기화 <span className="text-[#3182F6]">105개</span> SKU</p>
                  <p className="text-white/20 mt-2"><span className="text-[#FEBC2E]/60">!</span> <span className="text-[#FEBC2E]/50">발주 필요 8개 SKU (안전재고 이하)</span></p>
                  <p className="text-white/20 mt-2"><span className="text-[#36B37E]/60">$</span> notify --slack</p>
                  <p className="text-[#36B37E]/50 pl-4">리포트 전송 완료</p>
                  <p className="text-white/20 mt-1"><span className="inline-block w-1.5 h-3.5 bg-white/40 animate-pulse" /></p>
                </div>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ─── Channels ──────────────────────────────────────────────────────── */}
      <section className="relative py-32 border-t border-white/[0.04]">
        <div className="max-w-[1200px] mx-auto px-6 sm:px-10 text-center">
          <FadeIn>
            <p className="text-[11px] uppercase tracking-[0.2em] text-[#3182F6] mb-4">Integrations</p>
            <h2 className="text-[32px] sm:text-[44px] font-extralight tracking-[-0.03em] mb-16">
              연동된 채널
            </h2>
          </FadeIn>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-[800px] mx-auto">
            {[
              { name: '쿠팡 Wing', sub: '직배송 · 셀러 관리', letter: 'C' },
              { name: '쿠팡 그로스', sub: '로켓그로스 · RG', letter: 'RG' },
              { name: '네이버', sub: '스마트스토어', letter: 'N' },
              { name: '토스', sub: '토스쇼핑', letter: 'T' },
            ].map((ch, i) => (
              <FadeIn key={ch.name} delay={i * 80}>
                <div className="group relative rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 hover:bg-white/[0.04] hover:border-white/[0.12] transition-all duration-500 cursor-default">
                  <div className="w-12 h-12 rounded-xl bg-white/[0.04] flex items-center justify-center mx-auto mb-4">
                    <span className="text-[16px] font-bold text-white/30 group-hover:text-white/60 transition-colors">{ch.letter}</span>
                  </div>
                  <p className="text-[14px] font-medium text-white/70">{ch.name}</p>
                  <p className="text-[11px] text-white/25 mt-1">{ch.sub}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA ───────────────────────────────────────────────────────────── */}
      <section className="relative py-32">
        <div className="max-w-[1200px] mx-auto px-6 sm:px-10">
          <FadeIn>
            <div className="relative rounded-[28px] overflow-hidden">
              {/* Background */}
              <div className="absolute inset-0 bg-gradient-to-br from-[#3182F6]/20 via-[#0A0A0B] to-[#6554C0]/10" />
              <div className="absolute inset-0 border border-white/[0.06] rounded-[28px]" />
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-px bg-gradient-to-r from-transparent via-[#3182F6]/30 to-transparent" />

              <div className="relative px-10 py-20 sm:py-28 text-center">
                <h2 className="text-[32px] sm:text-[48px] font-extralight tracking-[-0.03em] mb-5">
                  지금 시작하세요
                </h2>
                <p className="text-[14px] sm:text-[16px] text-white/30 mb-10 max-w-[360px] mx-auto leading-[1.7]">
                  로그인 한 번이면 전 채널 통합 관리가 시작됩니다.
                </p>
                <Link href="/login"
                  className="group inline-flex items-center gap-3 h-14 px-10 rounded-full bg-white text-[#0A0A0B] text-[15px] font-semibold hover:bg-white/90 transition-all shadow-[0_0_60px_rgba(255,255,255,0.1)]">
                  로그인
                  <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </Link>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ─── Footer ────────────────────────────────────────────────────────── */}
      <footer className="border-t border-white/[0.04] py-10">
        <div className="max-w-[1200px] mx-auto px-6 sm:px-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <LVLogo size={22} />
            <span className="text-[13px] font-medium text-white/40">LV ERP</span>
          </div>
          <p className="text-[11px] text-white/20">&copy; {new Date().getFullYear()} LV ERP. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
