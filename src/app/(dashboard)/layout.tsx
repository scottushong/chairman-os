import { Header } from '@/components/layout/header'
import { Sidebar } from '@/components/layout/sidebar'
import { SystemBar } from '@/components/layout/system-bar'
import { currentUser } from '@/lib/auth/session'

/**
 * 로그인한 사람만 보는 셸.
 *
 * 라우트 그룹으로 나눈 이유는 /login이 이 셸을 쓰면 안 되기 때문이다 —
 * 로그인 화면에 사이드바와 검색창이 떠 있으면 '이미 들어와 있다'로 읽힌다.
 *
 * 여기서 세션을 한 번만 읽어 헤더에 내려 준다. 화면마다 다시 물으면
 * 같은 요청 안에서 Auth 왕복이 여러 번 생긴다.
 */
export default async function DashboardLayout({ children }: LayoutProps<'/'>) {
  const user = await currentUser()

  return (
    // 셸은 화면에 고정하고 본문만 스크롤한다. 관제 화면에서 헤더가 밀리면 안 된다.
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header user={user} />
        <main className="flex-1 overflow-y-auto">{children}</main>
        <SystemBar />
      </div>
    </div>
  )
}
