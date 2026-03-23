'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Users } from 'lucide-react';

interface PresenceState {
  email: string;
  joinedAt: string;
}

export function PresenceIndicator({ currentEmail }: { currentEmail?: string }) {
  const [others, setOthers] = useState<PresenceState[]>([]);

  useEffect(() => {
    if (!currentEmail) return;

    const supabase = createClient();
    const channel = supabase.channel('online-users', {
      config: { presence: { key: currentEmail } },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<PresenceState>();
        const otherUsers: PresenceState[] = [];
        for (const [key, presences] of Object.entries(state)) {
          if (key !== currentEmail) {
            for (const p of presences as any[]) {
              otherUsers.push({ email: p.email, joinedAt: p.joinedAt });
            }
          }
        }
        setOthers(otherUsers);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            email: currentEmail,
            joinedAt: new Date().toISOString(),
          });
        }
      });

    return () => {
      channel.untrack();
      supabase.removeChannel(channel);
    };
  }, [currentEmail]);

  if (others.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-[#FFF8E1] border border-[#FFE082] text-[12px] text-[#F57C00] font-medium">
      <Users className="h-3.5 w-3.5" />
      <span>
        {others.map((u) => u.email.split('@')[0]).join(', ')} 접속 중
      </span>
    </div>
  );
}
