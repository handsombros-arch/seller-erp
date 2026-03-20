'use client';
import { createContext, useContext, useState, useCallback } from 'react';

interface VatContextType {
  vatOn: boolean;
  vatMult: number;
  toggleVat: () => void;
}

const VatContext = createContext<VatContextType>({ vatOn: false, vatMult: 1, toggleVat: () => {} });

export function VatProvider({ children }: { children: React.ReactNode }) {
  const [vatOn, setVatOn] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('vat_on') === 'true';
  });

  const toggleVat = useCallback(() => {
    setVatOn((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') localStorage.setItem('vat_on', String(next));
      return next;
    });
  }, []);

  return (
    <VatContext.Provider value={{ vatOn, vatMult: vatOn ? 1.1 : 1, toggleVat }}>
      {children}
    </VatContext.Provider>
  );
}

export const useVat = () => useContext(VatContext);
