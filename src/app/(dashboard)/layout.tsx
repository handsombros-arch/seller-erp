import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen bg-[#F2F4F6]">
      <Sidebar />
      <div className="md:pl-[220px]">
        <Header email={user?.email} />
        <main className="p-4 md:p-6 max-w-[1200px] mx-auto">{children}</main>
      </div>
    </div>
  );
}
