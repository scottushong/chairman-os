import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /**
   * CSP는 frame-src **하나만** 건다 (Phase 5-D).
   *
   * 이 앱에는 지금까지 CSP가 없었다. 전체 정책(default-src 등)을 한 번에 켜면 Next의
   * 인라인 스크립트·스타일이 걸려 화면이 통째로 깨진다. 지금 필요한 것은 프로세스차트
   * iframe 하나를 허용하는 것뿐이라, 그 지시어만 둔다 — 다른 지시어는 여전히 제한이 없다.
   *
   * 'self'를 같이 두는 이유는 frame-src를 선언하는 순간 **선언하지 않은 출처가 전부 막히기**
   * 때문이다. docs.google.com만 적으면 이 앱 자신의 iframe도 막힌다.
   *
   * 출처는 lib/process-chart.ts의 EMBED_ORIGIN과 같아야 한다 —
   * scripts/check-process-charts.ts가 이 파일을 읽어 대조한다.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            // Phase 9 블록 5 — 화상회의(Jitsi) 임베드. lib/meet.ts의 JITSI_ORIGIN과 같다.
            value: "frame-src 'self' https://docs.google.com https://meet.jit.si",
          },
        ],
      },
    ]
  },
  /**
   * 빌드 시각을 번들에 굽는다 (Phase 5-E 4절, /settings의 '이 웹에 대해').
   *
   * Next에는 '이 빌드가 언제 만들어졌나'를 알려 주는 표준 값이 없다. Vercel의 환경변수도
   * 커밋 해시(VERCEL_GIT_COMMIT_SHA)와 환경(VERCEL_ENV)까지고 시각은 없다. 여기서 한 번
   * 읽어 두면 그 값이 상수로 굳어 요청마다 달라지지 않는다 — 화면이 "지금 시각"을
   * "배포 시각"이라고 부르는 것이 이 칸에서 가장 흔한 거짓말이다.
   *
   * NEXT_PUBLIC_ 접두사를 붙이지 않는다. 비밀은 아니지만 서버 컴포넌트만 읽으면 되는 값이고,
   * 이 저장소는 필요 없는 값을 브라우저 번들로 내보내지 않는다.
   */
  env: {
    APP_BUILD_TIME: new Date().toISOString(),
  },
  // 야간 브리핑 프롬프트는 코드가 아니라 파일이다(lib/ai/anthropic.ts). fs로 읽어서 추적기가 못 따라가므로
  // 이 라우트 번들에 직접 싣는다. 빠지면 Vercel에서만 ENOENT로 회사 전부가 Failed가 된다.
  outputFileTracingIncludes: {
    '/api/cron/night-brief': ['./src/lib/ai/prompts/**/*'],
    // Phase 10 — 첨부 요약 · «AI로 정리»는 서버 액션이라 그 액션을 부르는 화면의 번들에서 돈다.
    // 첨부 칸이 선 화면 전부에 프롬프트를 싣는다(빠지면 Vercel에서만 ENOENT → 요약 실패).
    '/initiatives/*': ['./src/lib/ai/prompts/attachment-summary.md'],
    '/business/*': ['./src/lib/ai/prompts/attachment-summary.md'],
    '/documents': ['./src/lib/ai/prompts/attachment-summary.md'],
    '/documents/*': ['./src/lib/ai/prompts/attachment-summary.md'],
    '/approvals': ['./src/lib/ai/prompts/attachment-summary.md'],
  },
  /**
   * Phase 10 — 첨부 추출 도구 셋은 번들하지 않고 node_modules에서 그대로 부른다. unpdf는 PDF.js 번들을
   * 동적 import로 읽고, exceljs · mammoth는 큰 CJS 묶음이라 번들러가 옮기면 깨지거나 느려진다.
   */
  serverExternalPackages: ['unpdf', 'mammoth', 'exceljs'],
  experimental: {
    serverActions: {
      /**
       * dummy 모드의 첨부는 서버 액션으로 바이트를 받는다(20MB + multipart 여유). live는 브라우저가
       * Storage로 바로 올리므로 이 한도를 타지 않는다 — Vercel 함수 요청 한도(4.5MB)가 그 이유다.
       */
      bodySizeLimit: '21mb',
    },
  },
}

export default nextConfig
