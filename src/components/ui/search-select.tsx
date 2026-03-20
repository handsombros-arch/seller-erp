'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { ChevronDown, X } from 'lucide-react';

export interface SelectOption {
  id: string;
  label: string;   // 주 표시 텍스트
  sub?: string;    // 보조 텍스트 (sku코드, 옵션 등)
  extra?: string;  // 추가 정보 (원가 등)
}

interface SearchSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  className?: string;
  maxItems?: number;
}

export function SearchSelect({
  options,
  value,
  onChange,
  placeholder = '검색하여 선택...',
  className = '',
  maxItems = 60,
}: SearchSelectProps) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.id === value);

  const filtered = useMemo(() => {
    if (!search.trim()) return options.slice(0, maxItems);
    const q = search.toLowerCase();
    return options
      .filter((o) => `${o.label} ${o.sub ?? ''} ${o.extra ?? ''}`.toLowerCase().includes(q))
      .slice(0, maxItems);
  }, [options, search, maxItems]);

  // 검색어 바뀔 때 하이라이트 초기화
  useEffect(() => { setHighlighted(0); }, [filtered]);

  // 하이라이트 항목 스크롤
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.children[highlighted] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  // 외부 클릭 시 닫기
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function openDropdown() {
    setOpen(true);
    setHighlighted(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function select(id: string) {
    onChange(id);
    setOpen(false);
    setSearch('');
    setHighlighted(0);
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange('');
    setSearch('');
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        setOpen(true);
        setHighlighted(0);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlighted((h) => (h + 1) % Math.max(filtered.length, 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlighted((h) => (h - 1 + Math.max(filtered.length, 1)) % Math.max(filtered.length, 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (filtered[highlighted]) select(filtered[highlighted].id);
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* 선택됐을 때 */}
      {selected ? (
        <div
          className="flex items-center justify-between gap-2 h-10 px-3 rounded-xl border border-[#3182F6]/30 bg-[#EBF1FE] cursor-pointer"
          onClick={openDropdown}
        >
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-[#191F28] truncate">{selected.label}</p>
            {(selected.sub || selected.extra) && (
              <p className="text-[11px] text-[#3182F6] truncate">
                {selected.sub}
                {selected.sub && selected.extra && ' · '}
                {selected.extra && <span className="text-[#6B7684]">{selected.extra}</span>}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={clear}
            className="shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-red-100 text-[#B0B8C1] hover:text-red-500 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        /* 검색 인풋 */
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setOpen(true); setHighlighted(0); }}
            onFocus={() => { setOpen(true); setHighlighted(0); }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            autoComplete="off"
            className="w-full h-10 pl-3 pr-8 rounded-xl border border-[#E5E8EB] text-[13px] text-[#191F28] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors bg-white"
          />
          <ChevronDown className={`absolute right-2.5 top-3 h-4 w-4 text-[#B0B8C1] pointer-events-none transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      )}

      {/* 드롭다운 목록 */}
      {open && !selected && (
        <div
          ref={listRef}
          className="absolute z-30 w-full mt-1 bg-white border border-[#E5E8EB] rounded-xl shadow-lg max-h-52 overflow-y-auto"
        >
          {filtered.length === 0 ? (
            <p className="px-3 py-3 text-[12.5px] text-[#B0B8C1] text-center">검색 결과 없음</p>
          ) : (
            filtered.map((opt, i) => (
              <button
                key={opt.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()} // input blur 방지
                onClick={() => select(opt.id)}
                className={`w-full text-left px-3 py-2 transition-colors first:rounded-t-xl last:rounded-b-xl ${
                  i === highlighted ? 'bg-[#EBF1FE]' : 'hover:bg-[#F2F4F6]'
                }`}
              >
                <p className="text-[13px] font-medium text-[#191F28]">{opt.label}</p>
                {(opt.sub || opt.extra) && (
                  <p className="text-[11.5px] text-[#6B7684]">
                    {opt.sub}
                    {opt.sub && opt.extra && ' · '}
                    {opt.extra}
                  </p>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
