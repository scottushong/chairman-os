import type { MetadataRoute } from 'next'

import { STAFF_BRAND } from '@/lib/brand'

/**
 * PWA manifest (Phase 6-2 블록 1). 폰에서 «홈 화면에 추가»하면 직원 홈(/me)으로 바로 열린다.
 * 회장 · 임원은 /me에서 역할에 맞는 첫 화면으로 가지 않는다 — 그들은 브라우저로 /를 연다.
 * 오프라인 캐시(service worker)는 두지 않는다: 이 앱의 화면은 전부 로그인 · 권한이 걸린 실시간 데이터다.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // 홈 화면 이름은 직원 이름 하나다 — manifest는 누가 설치하는지 모른다(lib/brand.ts). 회장 폰에도 «DY 그룹웨어»로 깔린다.
    // short_name도 같은 글자(공백 포함 7자)다 — 홈 화면 아이콘 밑 12자 안팎에 들어간다.
    name: STAFF_BRAND,
    short_name: STAFF_BRAND,
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
