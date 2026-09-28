'use client'

import Link from 'next/link'
import { useState } from 'react'

/**
 * 대시보드 상단 탭 (Phase 5-E 1-1절).
 *
 * 예전에는 `<button>` 다섯 개가 onClick 없이 서 있었다. 눌러도 아무 일이 없고, 첫 칸만
 * 늘 활성으로 칠해져 있어서 '여기를 눌렀는데 화면이 안 바뀐다'가 매일 반복됐다.
 * 죽은 버튼은 고장보다 나쁘다 — 고장은 고치면 되지만 죽은 버튼은 화면 전체를 못 믿게 만든다.
 *
 * **라우팅을 새로 만들지 않는다.** 대시보드 한 판에 이미 다 그려져 있으므로 탭이 할 일은
 * '그 자리로 데려다 주는 것'뿐이다. 앵커(id + scrollIntoView)면 충분하고, 탭마다 화면을
 * 새로 만들면 같은 데이터를 다섯 번 읽게 된다.
 *
 * 'AI 요약'만 <Link>다. 그것은 스크롤이 아니라 다른 화면(/ai)이고, 버튼+router.push로
 * 흉내 내면 가운데 클릭·새 탭·뒤로 가기가 전부 죽는다(calendar/page.tsx가 적어 둔 것과 같은 이유).
 *
 * '예산 vs 실적'은 뺐다. CH-027이 아직 없어서 갈 자리가 없다(DEFERRED.md Phase 5-E).
 * 화면이 없는 탭을 남겨 두는 것은 '준비 중'이라고 말하는 것과 다르다 — 탭은 언제나
 * '지금 볼 수 있는 것'의 목록이라, 그 안에 하나라도 빈 칸이 있으면 나머지 넷도 의심받는다.
 */

interface Tab {
  label: string
  /** 스크롤로 갈 자리. href가 있는 탭에는 없다. */
  anchor?: string
  /** 다른 화면으로 가는 탭. */
  href?: string
}

const TABS: readonly Tab[] = [
  { label: '전체 요약', anchor: 'dash-top' },
  { label: '중요 지표', anchor: 'kpi-strip' },
  { label: '리스크', anchor: 'alert-panel' },
  { label: 'AI 요약', href: '/ai' },
] as const

const BASE = 'rounded-t-md px-4 py-2 text-t13 transition-colors'
const ON = 'bg-panel font-semibold text-ink'
const OFF = 'text-ink-muted hover:bg-panel/60 hover:text-ink-dim'

export function DashboardTabs() {
  // 어느 탭을 마지막으로 눌렀나. 스크롤 위치를 되짚어 계산하지 않는다 —
  // IntersectionObserver로 '지금 보이는 절'을 따라가게 하면 스크롤 중에 탭이 혼자
  // 깜빡이고, 이 탭 줄은 자리 안내지 현재 위치 표시가 아니다.
  const [active, setActive] = useState(0)

  // m-tabs: 폰에서 탭이 좁아지면 «전체 요약»이 두 줄로 접혔다 — 줄은 접지 않고 옆으로 민다.
  return (
    <div className="m-tabs mt-4 flex gap-1 border-b border-line-soft">
      {TABS.map((tab, i) =>
        tab.href ? (
          <Link key={tab.label} href={tab.href} className={`${BASE} ${OFF}`}>
            {tab.label}
          </Link>
        ) : (
          <button
            key={tab.label}
            type="button"
            onClick={() => {
              setActive(i)
              // 못 찾으면 아무 일도 하지 않는다. 앵커가 사라진 화면에서 예외로 터지는 것보다
              // 조용히 제자리인 편이 낫다 — 이 줄은 안내지 기능이 아니다.
              document
                .getElementById(tab.anchor ?? '')
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
            className={`${BASE} ${i === active ? ON : OFF}`}
          >
            {tab.label}
          </button>
        ),
      )}
    </div>
  )
}
