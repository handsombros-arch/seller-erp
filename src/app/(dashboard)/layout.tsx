import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { VatProvider } from '@/components/layout/vat-provider';
import { ToastProvider } from '@/components/ui/toast';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { TaxAlert } from '@/components/layout/tax-alert';
import { WideProvider, MainShell } from '@/components/layout/wide-provider';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Vercel 빌드 시 자동 주입되는 환경변수 (production/preview).
  // 로컬 dev 에선 없음 → Header 가 알아서 숨김 처리.
  const deployedSha = process.env.VERCEL_GIT_COMMIT_SHA ?? null;

  return (
    <VatProvider>
    <ToastProvider>
    <ConfirmProvider>
      <WideProvider>
      <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-app)' }}>
        <Sidebar />
        <div className="md:pl-[var(--sidebar-w)]">
          <Header email={user?.email} deployedSha={deployedSha} />
          <MainShell>{children}</MainShell>
          <TaxAlert />
        </div>
      </div>
      </WideProvider>
    </ConfirmProvider>
    </ToastProvider>
    </VatProvider>
  );
}
