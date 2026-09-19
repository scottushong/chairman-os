import { RailSidebar } from '@/components/layout/rail-sidebar'
import { currentUser } from '@/lib/auth/session'

/**
 * 아침 루틴(/ai) 전용 셸. (dashboard) 셸의 형제다 — 그쪽은 한 줄도 건드리지 않았다.
 *
 * 이 셸이 이 코드베이스에서 처음으로 [data-theme='dark']를 화면 전체에 켠다.
 * 지금까지 다크가 붙은 곳은 대시보드의 브리핑 카드 한 장뿐이었다(P5-2).
 * 토큰 이름은 그대로고 값만 뒤집히므로 안쪽 컴포넌트는 다크를 모른 채 따라온다.
 * 최상위 div가 배경을 직접 칠한다 — body는 여전히 라이트 그라데이션이라
 * 이 트리가 덮지 못한 자리로 라이트가 샌다(globals.css의 [data-theme='dark'] 배경 규칙).
 *
 * 골격은 (dashboard)와 같다: flex h-full → 레일 → flex-1 flex-col → main.
 * 다른 점은 둘이다.
 *   1. 사이드바(212px 라벨 메뉴) 대신 76px 아이콘 레일이다. 아침에 읽는 화면이라
 *      가로를 본문에 더 준다 — 본문이 2단(560px + 나머지)이라 136px이 그대로 오른쪽 칸으로 간다.
 *   2. **헤더도 시스템바도 없다.** 헤더가 하던 일(시계·날씨·계정)은 이 화면에서
 *      상단 3칸이 훨씬 크게 한다. 시스템바(Layer 2 바로가기)는 아침 루틴에 낄 자리가 아니다.
 *
 * 그래서 <main>의 높이가 곧 100vh다. /ai의 sticky 왼쪽 칸이 이 사실에 걸려 있다 —
 * 아래 <main>에 붙은 경고 주석과 page.tsx의 max-h 주석을 같이 읽어야 한다.
 *
 * 세션은 여기서 한 번만 읽어 레일에 내려 준다((dashboard)/layout.tsx와 같은 이유).
 * currentUser()는 요청 단위로 캐시되므로 page.tsx가 다시 불러도 왕복이 늘지 않는다.
 */
export default async function MorningLayout({ children }: LayoutProps<'/'>) {
  const user = await currentUser()

  return (
    <div data-theme="dark" className="flex h-full">
      <RailSidebar user={user} />
      {/* 세로 칸을 한 겹 둔다. 지금은 main 하나뿐이지만 (dashboard)와 같은 골격이라야
          나중에 이 셸에 바가 붙을 때 자리가 분명하고, 그때 아래 높이 계산도 여기서부터 다시 센다. */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/*
         * 스크롤 컨테이너는 창(window)이 아니라 이 <main>이다.
         * 셸이 화면에 고정되고 본문만 흐르는 구조라, 안쪽의 sticky 칸은 창 높이가 아니라
         * 이 요소의 높이를 기준으로 붙잡힌다. 이 셸에는 헤더도 푸터도 없으므로
         * 지금 <main>의 높이는 100vh 그대로다 — /ai의 max-h-[calc(100vh-2rem)]이 그 숫자다.
         * **이 칸 위아래에 바를 하나라도 붙이면 그 높이만큼 page.tsx의 max-h도 같이 줄여야 한다.**
         * 안 줄이면 sticky 칸이 <main>보다 커져 스크롤 끝에서 조용히 고정이 풀린다.
         */}
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}
