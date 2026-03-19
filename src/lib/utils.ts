import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(n: number) {
  return n.toLocaleString('ko-KR');
}

export function formatCurrency(n: number) {
  return '₩' + n.toLocaleString('ko-KR');
}

export function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
}

export function skuOptionLabel(optionValues: Record<string, string>) {
  const entries = Object.entries(optionValues);
  if (entries.length === 0) return '기본';
  return entries.map(([, v]) => v).join(' / ');
}
