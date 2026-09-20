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
            value: "frame-src 'self' https://docs.google.com",
          },
        ],
      },
    ]
  },
  // 야간 브리핑 프롬프트는 코드가 아니라 파일이다(lib/ai/anthropic.ts). fs로 읽어서 추적기가 못 따라가므로
  // 이 라우트 번들에 직접 싣는다. 빠지면 Vercel에서만 ENOENT로 회사 전부가 Failed가 된다.
  outputFileTracingIncludes: {
    '/api/cron/night-brief': ['./src/lib/ai/prompts/**/*'],
  },
}

export default nextConfig
