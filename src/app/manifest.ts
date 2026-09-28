import type { MetadataRoute } from 'next'

/**
 * PWA manifest (Phase 6-2 블록 1). 폰에서 «홈 화면에 추가»하면 직원 홈(/me)으로 바로 열린다.
 * 회장 · 임원은 /me에서 역할에 맞는 첫 화면으로 가지 않는다 — 그들은 브라우저로 /를 연다.
 * 오프라인 캐시(service worker)는 두지 않는다: 이 앱의 화면은 전부 로그인 · 권한이 걸린 실시간 데이터다.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Chairman OS',
    short_name: 'Chairman OS',
    description: '그룹 업무 · 결재 · 채팅',
    start_url: '/me',
    scope: '/',
    display: 'standalone',
    background_color: '#1c1a17',
    theme_color: '#1c1a17',
    lang: 'ko',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
