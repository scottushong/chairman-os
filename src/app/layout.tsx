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
 */
export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ko" className={`${notoSerifKR.variable} h-full antialiased`}>
      <body className="h-full font-sans">{children}</body>
    </html>
  )
}
