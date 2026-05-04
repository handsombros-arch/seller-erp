import { NextResponse } from 'next/server';

// 클라이언트가 현재 production 에 배포된 commit SHA 를 알 수 있게 해주는 엔드포인트.
// Vercel 빌드 시 자동 주입된 VERCEL_GIT_COMMIT_SHA 를 그대로 반환.
// 매 요청마다 새로 evaluate 되므로 새 배포가 ready 되면 그때부터 새 SHA 가 응답됨.
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    ref: process.env.VERCEL_GIT_COMMIT_REF ?? null,
  });
}
