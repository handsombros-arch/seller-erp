#!/bin/bash
# 프로덕션 + 테스트 서버 동시 배포

echo "=== 1. seller-erp (프로덕션) 배포 ==="
npx vercel --prod --yes

echo ""
echo "=== 2. lv-erp-test (테스트) 배포 ==="
cp -r .vercel .vercel-backup
rm -rf .vercel
npx vercel link --yes --project lv-erp-test
npx vercel --prod --yes
rm -rf .vercel
mv .vercel-backup .vercel

echo ""
echo "=== 배포 완료 ==="
echo "프로덕션: https://seller-erp.vercel.app"
echo "테스트:   https://lv-erp-test.vercel.app"
