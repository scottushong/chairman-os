import type { Metadata } from 'next'
import localFont from 'next/font/local'

import { Header } from '@/components/layout/header'
import { Sidebar } from '@/components/layout/sidebar'
import { SystemBar } from '@/components/layout/system-bar'

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

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ko" className={`${pretendard.variable} h-full antialiased`}>
      <body className="h-full font-sans">
        {/* 셸은 화면에 고정하고 본문만 스크롤한다. 관제 화면에서 헤더가 밀리면 안 된다. */}
        <div className="flex h-full">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Header />
            <main className="flex-1 overflow-y-auto">{children}</main>
            <SystemBar />
          </div>
        </div>
      </body>
    </html>
  )
}
