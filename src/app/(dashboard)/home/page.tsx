import Link from 'next/link'
import { redirect } from 'next/navigation'

import { C, Pill } from '@/components/home/ui'
import { HomeBoard } from '@/components/home/home-board'
import { currentUser } from '@/lib/auth/session'
import { kstToday } from '@/lib/chairman-project'
import { loadBoardProps } from '@/lib/home/board-server'
import { homeAccess, requiredNotices } from '@/lib/home/data'

/**
 * 0086 «내 홈»(/home) — 시안 docs/specs/2026-10-20-home-widgets-mock.png: 날짜 · 이름 · «편집 모드» · 필수 공지 · 개인 위젯.
 * 스위치 home_widgets(기본 대표만 · 회사 줄을 켜면 그 회사 전원). 꺼져 있으면 안내만(메뉴도 없다).
 * 배치는 서버(0086 home_layouts — 본인만)에서 읽고, 위젯 내용은 위젯마다 서버 액션으로 따로 부른다(기존 기능의 권한 그대로).
 * 직원 화면이다 — «회장»이 들어가지 않는다. 급여 · 원가 · BOM · 재무 숫자 · 원료 단가를 싣지 않는다(check:home-widgets).
 * 0097: 대표 첫 화면과 같은 구역 엔진(components/home/home-board) — 직원 기본은 구역 하나. 대표 · CFO 전용 위젯은 직원 목록에 없다.
 */
export const dynamic = 'force-dynamic'

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']

export default async function HomeWidgetsPage() {
  const user = await currentUser()
  if (!user) redirect('/login')
  const access = await homeAccess(user)
  if (!access.home) {
    return (
      <div className={`${C.bg} min-h-full p-4 sm:p-6`}>
        <div className={`${C.card} max-w-xl px-5 py-6`}>
          <h1 className="text-[18px] font-bold text-ink">내 홈</h1>
          <p className="mt-2 text-[14px] text-ink-muted">지금은 쓸 수 없는 기능입니다. 회사에서 «내 홈»을 켜면 이 자리에 내 위젯이 보입니다.</p>
          <Link href="/me" className="mt-3 inline-flex min-h-11 items-center text-[14px] text-link hover:underline">
            예전 직원 홈으로
          </Link>
        </div>
      </div>
    )
  }

  const [board, notices] = await Promise.all([loadBoardProps(user), requiredNotices(user)])

  const today = kstToday()
  const dow = WEEKDAY[new Date(`${today}T00:00:00Z`).getUTCDay()]

  return (
    <div className={`${C.bg} min-h-full pb-24 lg:pb-8`}>
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-4 py-5 sm:px-6">
        <HomeBoard
          initial={board.sections}
          revision={board.revision}
          usedDefault={board.usedDefault}
          library={board.library}
          addable={board.addable}
          defaults={board.defaults}
          favorites={board.favorites}
          loadFailed={board.loadFailed}
          businesses={board.businesses}
          projects={board.projects}
          title={`${user.name}님의 업무 공간`}
          sub={
            <>
              <span className="tnum">
                {today.replace(/-/g, '.')} {dow}요일
              </span>{' '}
              · 필요한 업무를, 보기 편한 자리에.{user.title_ko ? ` · ${user.title_ko}` : ''}
            </>
          }
          aside={board.mode === 'dummy' ? <Pill tone="orange">개발용 dummy — 예시 데이터</Pill> : null}
          /* 필수 공지 — 관리자(공지 쓰기 권한자)가 «맨 앞 고정»한 공지. 개인 편집으로 숨기거나 지우지 못한다(편집 도구 밖). */
          top={
          <section aria-label="필수 공지" data-testid="required-notices" className={`${C.card} flex flex-col gap-1.5 px-4 py-3`}>
            {!notices.ok ? (
              <p className="text-[14px] text-critical">필수 공지를 불러오지 못했습니다.</p>
            ) : notices.items.length === 0 ? (
              <p className="text-[14px] text-ink-muted">
                <span className="mr-2 font-semibold text-ink">필수 공지</span>지금 꼭 봐야 할 공지가 없습니다.
              </p>
            ) : (
              notices.items.map((n) => (
                <Link key={n.id} href="/groupware" className="flex min-h-11 min-w-0 items-center gap-2 text-[14px] text-ink hover:underline">
                  <Pill tone="red">필수 공지</Pill>
                  <span className="min-w-0 flex-1 truncate">{n.title}</span>
                  <span className="shrink-0 text-[13px] text-ink-muted tnum">{n.date}</span>
                </Link>
              ))
            )}
          </section>
          }
        />
      </div>
    </div>
  )
}
