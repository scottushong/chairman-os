import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // 야간 브리핑 프롬프트는 코드가 아니라 파일이다(lib/ai/anthropic.ts). fs로 읽어서 추적기가 못 따라가므로
  // 이 라우트 번들에 직접 싣는다. 빠지면 Vercel에서만 ENOENT로 회사 전부가 Failed가 된다.
  outputFileTracingIncludes: {
    '/api/cron/night-brief': ['./src/lib/ai/prompts/**/*'],
  },
}

export default nextConfig
