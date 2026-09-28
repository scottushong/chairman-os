import { MobileTabs } from '@/components/layout/mobile-tabs'
import { Header } from '@/components/layout/header'
import { Sidebar } from '@/components/layout/sidebar'
import { SystemBar } from '@/components/layout/system-bar'
import { TimezoneBeacon } from '@/components/settings/timezone-beacon'
import { currentUser } from '@/lib/auth/session'
import { loadUiPrefs } from '@/lib/ui-prefs-server'

/**
 * 로그인한 사람만 보는 셸.
 *
 * 라우트 그룹으로 나눈 이유는 /login이 이 셸을 쓰면 안 되기 때문이다 —
 * 로그인 화면에 사이드바와 검색창이 떠 있으면 '이미 들어와 있다'로 읽힌다.
 *
 * 여기서 세션을 한 번만 읽어 헤더와 사이드바에 내려 준다. 화면마다 다시 물으면
 * 같은 요청 안에서 Auth 왕복이 여러 번 생긴다.
 * 사이드바는 클라이언트 컴포넌트지만 세션을 스스로 읽지 않는다 — 같은 값을 두 번 묻지 않으려고
 * 여기서 읽은 것을 prop으로 내린다(SessionUser는 평범한 객체라 그대로 직렬화된다).
 *
 * ■ 테마 (Phase 5-E 4절) ■
 * data-theme을 **이 div**에 건다. 루트 <html>이 아니다 — (morning) 셸이 자기 트리에
 * dark를 거는 것과 같은 자리이고, 그래서 아침 루틴(/ai)은 이 설정과 무관하게 늘 다크로
 * 남는다(회장 지시 원문: "테마(라이트/다크/자동 — /ai는 항상 다크)").
 * /login도 이 셸 밖이라 늘 라이트다.
 */
export default async function DashboardLayout({ children }: LayoutProps<'/'>) {
  const [user, prefs] = await Promise.all([currentUser(), loadUiPrefs()])

  /**
   * '자동'은 서버가 답할 수 없는 값이다 — prefers-color-scheme은 브라우저만 안다.
   * 서버는 라이트로 그리고, 아래 한 줄짜리 스크립트가 **HTML을 파싱하는 그 자리에서**
   * 다크로 올린다. 하이드레이션을 기다리는 클라이언트 컴포넌트로 하면 다크를 쓰는 기기에서
   * 첫 프레임이 밝게 번쩍인다 — 아침에 여는 화면에서 그 번쩍임이 제일 거슬린다.
   */
  const auto = prefs.app.theme === 'auto'
  const theme = auto ? 'light' : prefs.app.theme

  return (
    // 셸은 화면에 고정하고 본문만 스크롤한다. 관제 화면에서 헤더가 밀리면 안 된다.
    <div id="app-shell" data-theme={theme} className="flex h-full">
      {auto ? (
        <script
          // 파싱 시점에 동기로 돌아야 번쩍임이 없다. 값은 이 파일의 상수 문자열이고 바깥에서 오지 않는다.
          dangerouslySetInnerHTML={{
            __html:
              "try{var e=document.getElementById('app-shell');" +
              "if(e&&window.matchMedia('(prefers-color-scheme: dark)').matches)e.setAttribute('data-theme','dark')}catch(_){}",
          }}
        />
      ) : null}
      {/* 그려지는 것이 없다. 이 기기의 시간대를 하루 한 번 서버에 남긴다 —
          아침 알림의 ①이 그 값이다(Phase 3-C 현지 시간). */}
      <TimezoneBeacon />
      <Sidebar user={user} prefs={prefs.sidebar} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header user={user} />
        <main className="flex-1 overflow-y-auto">{children}</main>
        {/* 넓은 화면은 시스템 바, 폰은 하단 탭(Phase 9 블록 6). 둘은 서로의 breakpoint에서 숨는다. */}
        <div className="hidden md:block">
          <SystemBar />
        </div>
        <MobileTabs />
      </div>
    </div>
  )
}
