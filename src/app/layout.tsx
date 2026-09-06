import type { Metadata } from 'next'
import localFont from 'next/font/local'

import './globals.css'

/** Pretendard Variable. 자체 호스팅이라 외부 요청 없이 로드된다. */
const pretendard = localFont({
  src: './fonts/PretendardVariable.woff2',
  variable: '--font-pretendard',
  weight: '45 920',
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
    <html lang="ko" className={`${pretendard.variable} h-full antialiased`}>
      <body className="h-full font-sans">{children}</body>
    </html>
  )
}
