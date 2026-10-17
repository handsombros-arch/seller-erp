import { NextRequest, NextResponse } from 'next/server';
import { runFullVerification, readFullVerification } from '@/lib/coupang/full-snapshot';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== 'Bearer '+secret) {
    return NextResponse.json({ state:'BLOCKED',error_code:'UNAUTHORIZED' },{status:401});
  }
  const requestKey = 'scheduled:'+new Date().toISOString().slice(0,10);
  let summary: Record<string,unknown>;
  try {
    summary = await runFullVerification(null,requestKey,'scheduled');
    if (summary.state==='COMPLETE') summary = await readFullVerification(requestKey,null);
  } catch { summary={state:'WRITE_UNCERTAIN',error_code:'USE_INDEPENDENT_READ'}; }
  const result={event:'RG_VERIFICATION_SCHEDULED',checked_utc:new Date().toISOString(),
    commit:process.env.VERCEL_GIT_COMMIT_SHA??null,...summary};
  console.log(JSON.stringify(result));
  return NextResponse.json(result,{status:summary.state==='COMPLETE'&&summary.matches===true?200:503,
    headers:{'Cache-Control':'no-store'}});
}
