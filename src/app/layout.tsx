import type { Metadata } from 'next'
import { Noto_Serif_KR } from 'next/font/google'

import './globals.css'

/**
 * Noto Serif KR. next/font/google가 빌드 때 받아서 자체 호스팅하므로
 * 실행 중에는 외부 요청이 없다(Pretendard 때와 같은 성질을 유지한다).
 *
 * 400·500 두 굵기만 받는다. 관제 화면에 필요한 대비는 본문/강조 두 단이면 충분하고,
 * 한글 명조는 굵기 하나가 곧 파일 하나라 더 받으면 그만큼 무거워진다.
 * subsets에 'korean'이 없는 것은 정상이다 — Google이 한글을 unicode-range로 잘게 쪼개
 * 내려 주고 next/font가 그 조각을 전부 받아 둔다. latin만 preload 대상으로 잡는다.
 */
const notoSerifKR = Noto_Serif_KR({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-noto-serif-kr',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Chairman OS',
  description: '그룹 통합 관제 + Business 전용 OS 연동 + AI Overnight Workforce',
}

/**
 * 루트에는 문서 껍데기만 둔다.
 * 사이드바·헤더가 붙은 관제 셸은 (dashboard) 그룹의 레이아웃이 갖고,
 * /login은 그 셸 없이 뜬다.
 *
 * data-theme="light"가 루트에 붙는 이유(Phase 5).
 * 이 앱은 낮에 사무실에서 보는 관제 화면이다. 밝은 방에서 다크 화면은 유리에 방이 비치고
 * 종이 보고서와 나란히 놓았을 때 밝기가 튄다 — 그래서 기본을 라이트 웜 글래스로 잡았다.
 * 다크는 아침 루틴을 위한 것이고, **이 줄 아래 두 군데에서 실제로 켜진다**:
 * (morning)/layout.tsx의 최상위 div가 /ai 화면 전체를, (dashboard)/page.tsx가 야간 AI
 * 브리핑 카드 한 장을 다크 트리로 만든다. 토큰 이름은 그대로고 값만 뒤집히므로
 * 그 안쪽 컴포넌트는 테마를 모른 채 따라온다(globals.css의 [data-theme='dark'] 블록).
 *
 * 값을 명시해 두는 편이 안전하다. 루트에 아무것도 없어도 @theme의 라이트가 기본으로 서지만,
 * 그러면 '라이트가 기본'이 마크업 어디에도 안 적혀 있어 다음 사람이 토글을 붙일 자리를 못 찾는다.
 * 그리고 globals.css의 color-scheme 규칙이 [data-theme='light']를 직접 보므로
 * 이 속성이 없으면 라이트 트리가 명시적으로 선언되지 않는다.
 */
export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ko" data-theme="light" className={`${notoSerifKR.variable} h-full antialiased`}>
      <body className="h-full font-sans">{children}</body>
    </html>
  )
}
