import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;

  // 홈(랜딩) · 로그인 페이지는 통과
  if (pathname === '/home' || pathname.startsWith('/login')) {
    if (user && pathname.startsWith('/login')) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    return supabaseResponse;
  }

  // API 라우트는 각자 인증 처리
  if (pathname.startsWith('/api')) {
    return supabaseResponse;
  }

  // 미인증 → 홈 랜딩 페이지
  if (!user) {
    return NextResponse.redirect(new URL('/home', request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
