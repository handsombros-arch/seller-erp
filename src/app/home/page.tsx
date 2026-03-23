'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { LVLogo } from '@/components/ui/lv-logo';
import {
  Warehouse, TrendingUp, ShoppingCart, BarChart3,
  ArrowRight, Package, RefreshCw, Shield, Zap,
  ChevronDown,
} from 'lucide-react';

// ─── Animated counter ─────────────────────────────────────────────────────────
function Counter({ end, suffix = '', duration = 2000 }: { end: number; suffix?: string; duration?: number }) {
  const [count, setCount] = useState(0);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setStarted(true); },
      { threshold: 0.3 }
    );
    const el = document.getElementById(`counter-${end}`);
    if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [end]);

  useEffect(() => {
    if (!started) return;
    const step = Math.ceil(end / (duration / 16));
    const timer = setInterval(() => {
      setCount((prev) => {
        const next = prev + step;
        if (next >= end) { clearInterval(timer); return end; }
        return next;
      });
    }, 16);
    return () => clearInterval(timer);
  }, [started, end, duration]);

  return <span id={`counter-${end}`}>{count.toLocaleString()}{suffix}</span>;
}

// ─── Feature card ─────────────────────────────────────────────────────────────
function FeatureCard({ icon: Icon, title, desc, color }: {
  icon: any; title: string; desc: string; color: string;
}) {
  return (
    <div className="group relative bg-white rounded-2xl p-7 shadow-[0_1px_4px_rgba(0,0,0,0.06)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)] transition-all duration-300 hover:-translate-y-1">
      <div className={`w-12 h-12 rounded-xl ${color} flex items-center justify-center mb-5`}>
        <Icon className="h-6 w-6 text-white" />
      </div>
      <h3 className="text-[16px] font-bold text-[#191F28] mb-2">{title}</h3>
      <p className="text-[13px] text-[#6B7684] leading-relaxed">{desc}</p>
    </div>
  );
}

// ─── Workflow step ────────────────────────────────────────────────────────────
function Step({ num, title, desc }: { num: number; title: string; desc: string }) {
  return (
    <div className="flex gap-5">
      <div className="flex flex-col items-center">
        <div className="w-10 h-10 rounded-full bg-[#3182F6] text-white flex items-center justify-center text-[14px] font-bold shrink-0">
          {num}
        </div>
        {num < 4 && <div className="w-px flex-1 bg-[#E5E8EB] mt-2" />}
      </div>
      <div className="pb-8">
        <h4 className="text-[15px] font-bold text-[#191F28] mb-1">{title}</h4>
        <p className="text-[13px] text-[#6B7684] leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function HomePage() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);

  return (
    <div className="min-h-screen bg-white">
      {/* ─── Nav ─────────────────────────────────────────────────────────── */}
      <nav className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${scrolled ? 'bg-white/90 backdrop-blur-lg shadow-[0_1px_3px_rgba(0,0,0,0.06)]' : 'bg-transparent'}`}>
        <div className="max-w-[1100px] mx-auto flex items-center justify-between h-16 px-6">
          <div className="flex items-center gap-2.5">
            <LVLogo size={36} />
            <span className="text-[17px] font-bold tracking-[-0.02em] text-[#191F28]">LV ERP</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login"
              className="h-9 px-5 rounded-lg bg-[#191F28] text-white text-[13px] font-semibold flex items-center gap-1.5 hover:bg-[#333D4B] transition-colors">
              로그인 <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </nav>

      {/* ─── Hero ────────────────────────────────────────────────────────── */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#F8FAFC] to-white" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full bg-[#3182F6]/[0.03] blur-3xl" />

        <div className="relative max-w-[1100px] mx-auto px-6 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#EBF1FE] text-[#3182F6] text-[12px] font-semibold mb-6">
            <Zap className="h-3.5 w-3.5" />
            셀러를 위한 올인원 ERP
          </div>

          <h1 className="text-[40px] sm:text-[52px] font-extrabold text-[#191F28] leading-[1.15] tracking-[-0.03em] mb-5">
            재고부터 손익까지<br />
            <span className="text-[#3182F6]">하나로 관리</span>하세요
          </h1>

          <p className="text-[16px] sm:text-[18px] text-[#6B7684] leading-relaxed max-w-[520px] mx-auto mb-10">
            쿠팡 · 네이버 · 토스 전 채널 주문을 자동 동기화하고,<br className="hidden sm:block" />
            재고 · 발주 · 판매분석까지 한 곳에서 관리합니다.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-16">
            <Link href="/login"
              className="h-12 px-8 rounded-xl bg-[#3182F6] text-white text-[15px] font-semibold flex items-center gap-2 hover:bg-[#1B64DA] transition-colors shadow-[0_4px_14px_rgba(49,130,246,0.35)]">
              시작하기 <ArrowRight className="h-4 w-4" />
            </Link>
            <a href="#features"
              className="h-12 px-8 rounded-xl border border-[#E5E8EB] text-[#6B7684] text-[15px] font-semibold flex items-center gap-2 hover:bg-[#F2F4F6] transition-colors">
              기능 알아보기 <ChevronDown className="h-4 w-4" />
            </a>
          </div>

          {/* Dashboard preview mockup */}
          <div className="relative max-w-[900px] mx-auto">
            <div className="bg-[#191F28] rounded-t-2xl h-8 flex items-center px-4 gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-[#FF5F57]" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#FEBC2E]" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#28C840]" />
              <span className="text-[11px] text-[#6B7684] ml-3">seller-erp.vercel.app</span>
            </div>
            <div className="bg-[#F2F4F6] rounded-b-2xl p-6 shadow-[0_20px_60px_rgba(0,0,0,0.12)]">
              <div className="grid grid-cols-4 gap-3 mb-4">
                {[
                  { label: '총 재고', value: '12,847', color: '#3182F6' },
                  { label: '금일 주문', value: '34', color: '#00B8D9' },
                  { label: '발주 필요', value: '8', color: '#FF5630' },
                  { label: '월 매출', value: '₩14.2M', color: '#36B37E' },
                ].map((card) => (
                  <div key={card.label} className="bg-white rounded-xl p-4">
                    <p className="text-[11px] text-[#6B7684] mb-1">{card.label}</p>
                    <p className="text-[18px] font-bold" style={{ color: card.color }}>{card.value}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-[2fr_1fr] gap-3">
                <div className="bg-white rounded-xl p-4 h-[120px]">
                  <p className="text-[11px] text-[#6B7684] mb-3">판매 추이</p>
                  <div className="flex items-end gap-1.5 h-[70px]">
                    {[40, 55, 35, 65, 50, 75, 60, 80, 70, 90, 85, 95].map((h, i) => (
                      <div key={i} className="flex-1 rounded-sm bg-[#3182F6]" style={{ height: `${h}%`, opacity: 0.3 + (i / 12) * 0.7 }} />
                    ))}
                  </div>
                </div>
                <div className="bg-white rounded-xl p-4 h-[120px]">
                  <p className="text-[11px] text-[#6B7684] mb-3">채널별 비중</p>
                  <div className="flex items-center justify-center h-[70px] gap-2">
                    <div className="w-[70px] h-[70px] rounded-full border-[8px] border-[#3182F6] border-t-[#36B37E] border-r-[#FF5630]" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Stats ───────────────────────────────────────────────────────── */}
      <section className="py-16 bg-[#F8FAFC]">
        <div className="max-w-[1100px] mx-auto px-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 text-center">
            {[
              { end: 4, suffix: '개 채널', desc: '자동 연동' },
              { end: 100, suffix: '%', desc: '주문 자동 동기화' },
              { end: 24, suffix: '시간', desc: '무중단 모니터링' },
              { end: 30, suffix: '초', desc: '일일 리포트 생성' },
            ].map((stat) => (
              <div key={stat.desc}>
                <p className="text-[32px] sm:text-[40px] font-extrabold text-[#3182F6] tracking-[-0.03em]">
                  <Counter end={stat.end} suffix={stat.suffix} />
                </p>
                <p className="text-[13px] text-[#6B7684] mt-1">{stat.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Features ────────────────────────────────────────────────────── */}
      <section id="features" className="py-20">
        <div className="max-w-[1100px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-[13px] font-semibold text-[#3182F6] mb-2">FEATURES</p>
            <h2 className="text-[28px] sm:text-[36px] font-extrabold text-[#191F28] tracking-[-0.03em]">
              셀러에게 필요한 모든 것
            </h2>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <FeatureCard
              icon={Warehouse}
              title="실시간 재고 관리"
              desc="창고별 재고 현황을 한눈에 파악하고, 안전재고 이하 시 자동 알림을 받으세요."
              color="bg-[#3182F6]"
            />
            <FeatureCard
              icon={ShoppingCart}
              title="전 채널 주문 동기화"
              desc="쿠팡 Wing · 그로스, 네이버 스마트스토어, 토스 주문을 매일 자동으로 수집합니다."
              color="bg-[#00B8D9]"
            />
            <FeatureCard
              icon={Package}
              title="발주 · 입출고"
              desc="발주서 생성부터 입고 확인까지. 리드타임 자동 계산으로 적정 발주 시점을 놓치지 마세요."
              color="bg-[#36B37E]"
            />
            <FeatureCard
              icon={TrendingUp}
              title="판매 분석 · 예측"
              desc="7일/30일 판매 추이와 재고 소진 예측으로 데이터 기반 의사결정을 지원합니다."
              color="bg-[#6554C0]"
            />
            <FeatureCard
              icon={BarChart3}
              title="대시보드 · 리포트"
              desc="매출, 재고, 주문 현황을 한 화면에. 매일 아침 Slack으로 요약 리포트를 받아보세요."
              color="bg-[#FF5630]"
            />
            <FeatureCard
              icon={Shield}
              title="안정적 인프라"
              desc="Vercel + Supabase 기반으로 빠르고 안정적인 서비스. 데이터는 안전하게 암호화됩니다."
              color="bg-[#191F28]"
            />
          </div>
        </div>
      </section>

      {/* ─── How it works ────────────────────────────────────────────────── */}
      <section className="py-20 bg-[#F8FAFC]">
        <div className="max-w-[1100px] mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-16 items-start">
            <div>
              <p className="text-[13px] font-semibold text-[#3182F6] mb-2">HOW IT WORKS</p>
              <h2 className="text-[28px] sm:text-[36px] font-extrabold text-[#191F28] tracking-[-0.03em] mb-4">
                자동화된 워크플로우
              </h2>
              <p className="text-[15px] text-[#6B7684] leading-relaxed mb-10">
                매일 반복되는 수작업을 자동화하여<br />
                셀러가 본업에 집중할 수 있도록 돕습니다.
              </p>

              <div>
                <Step num={1} title="주문 자동 수집" desc="매일 오전 8시, 4개 채널의 신규 주문을 자동으로 동기화합니다." />
                <Step num={2} title="재고 자동 차감" desc="배송 시작된 주문은 자동으로 재고에서 차감, 반품은 복구됩니다." />
                <Step num={3} title="알림 · 분석" desc="안전재고 이하, 주문 급증/급감 등 이상 징후를 Slack으로 알려드립니다." />
                <Step num={4} title="발주 제안" desc="판매 속도와 리드타임 기반으로 최적의 발주 시점과 수량을 제안합니다." />
              </div>
            </div>

            <div className="bg-white rounded-2xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
              <div className="flex items-center gap-2 mb-5">
                <RefreshCw className="h-4 w-4 text-[#3182F6]" />
                <span className="text-[13px] font-semibold text-[#191F28]">일일 동기화 리포트</span>
                <span className="ml-auto text-[11px] text-[#B0B8C1]">오늘 08:00</span>
              </div>
              <div className="space-y-3 font-mono text-[12px]">
                {[
                  { label: '쿠팡 그로스', value: '27건', color: '#3182F6' },
                  { label: '쿠팡 Wing', value: '12건', color: '#3182F6' },
                  { label: '스마트스토어', value: '8건', color: '#36B37E' },
                  { label: '토스', value: '3건', color: '#6554C0' },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between py-2.5 px-4 rounded-xl bg-[#F8FAFC]">
                    <span className="text-[#6B7684]">{row.label}</span>
                    <span className="font-bold" style={{ color: row.color }}>{row.value}</span>
                  </div>
                ))}
                <div className="border-t border-[#F2F4F6] pt-3 mt-3">
                  <div className="flex items-center justify-between py-2 px-4">
                    <span className="text-[#191F28] font-semibold">재고 차감</span>
                    <span className="text-[#191F28] font-bold">42건</span>
                  </div>
                  <div className="flex items-center justify-between py-2 px-4">
                    <span className="text-[#191F28] font-semibold">RG 재고 동기화</span>
                    <span className="text-[#191F28] font-bold">105개</span>
                  </div>
                </div>
                <div className="mt-3 p-3 rounded-xl bg-[#FFF8E1] border border-[#FFE082]">
                  <p className="text-[#F57C00] font-semibold">특이점</p>
                  <p className="text-[#6B7684] mt-1">발주 필요 8개 SKU (안전재고 이하)</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Channels ────────────────────────────────────────────────────── */}
      <section className="py-20">
        <div className="max-w-[1100px] mx-auto px-6 text-center">
          <p className="text-[13px] font-semibold text-[#3182F6] mb-2">CHANNELS</p>
          <h2 className="text-[28px] sm:text-[36px] font-extrabold text-[#191F28] tracking-[-0.03em] mb-12">
            주요 판매 채널 연동
          </h2>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-5 max-w-[700px] mx-auto">
            {[
              { name: '쿠팡 Wing', sub: '직배송', bg: '#F2F4F6' },
              { name: '쿠팡 그로스', sub: 'RG (로켓그로스)', bg: '#F2F4F6' },
              { name: '네이버', sub: '스마트스토어', bg: '#F2F4F6' },
              { name: '토스', sub: '토스쇼핑', bg: '#F2F4F6' },
            ].map((ch) => (
              <div key={ch.name} className="rounded-2xl p-5 bg-[#F8FAFC] hover:bg-[#EBF1FE] transition-colors">
                <p className="text-[15px] font-bold text-[#191F28]">{ch.name}</p>
                <p className="text-[12px] text-[#6B7684] mt-1">{ch.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA ─────────────────────────────────────────────────────────── */}
      <section className="py-20">
        <div className="max-w-[1100px] mx-auto px-6">
          <div className="relative rounded-3xl bg-gradient-to-br from-[#191F28] to-[#333D4B] p-12 sm:p-16 text-center overflow-hidden">
            <div className="absolute top-0 right-0 w-[300px] h-[300px] rounded-full bg-[#3182F6]/10 blur-3xl" />
            <div className="absolute bottom-0 left-0 w-[200px] h-[200px] rounded-full bg-[#3182F6]/10 blur-3xl" />

            <div className="relative">
              <h2 className="text-[28px] sm:text-[36px] font-extrabold text-white tracking-[-0.03em] mb-4">
                지금 바로 시작하세요
              </h2>
              <p className="text-[15px] text-[#8B95A1] mb-8 max-w-[400px] mx-auto leading-relaxed">
                복잡한 설정 없이 로그인 한 번이면<br />
                전 채널 통합 관리가 시작됩니다.
              </p>
              <Link href="/login"
                className="inline-flex items-center gap-2 h-12 px-8 rounded-xl bg-[#3182F6] text-white text-[15px] font-semibold hover:bg-[#1B64DA] transition-colors shadow-[0_4px_14px_rgba(49,130,246,0.4)]">
                로그인 <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Footer ──────────────────────────────────────────────────────── */}
      <footer className="py-10 border-t border-[#F2F4F6]">
        <div className="max-w-[1100px] mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <LVLogo size={24} />
            <span className="text-[13px] font-semibold text-[#191F28]">LV ERP</span>
          </div>
          <p className="text-[12px] text-[#B0B8C1]">&copy; {new Date().getFullYear()} LV ERP. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
