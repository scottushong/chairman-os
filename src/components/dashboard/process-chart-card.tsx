'use client'

import Link from 'next/link'
import { useState, useSyncExternalStore } from 'react'

import { GlassCard } from '@/components/ui/glass-card'
import { Icon } from '@/components/ui/icon'
import { SheetFrame } from '@/components/ui/sheet-frame'
import { embedSrc } from '@/lib/process-chart'
import type { Business, ProcessChart } from '@/types'

/**
 * 프로세스차트 카드 (Phase 5-D). 대시보드 3줄 전폭.
 *
 * 회사 탭 → 팀 탭 → 시트. 시트는 구글 '웹에 게시' 링크를 iframe으로 띄운다.
 *
 * **높이 700px, 폭은 전폭이다.** 처음엔 1/3 폭 320px 카드에 넣었는데 시트가
 * 몇 칸만 보여 아무것도 읽히지 않았다. 표는 가로로 긴 문서라 폭을 아끼면 쓸모가 사라진다.
 * 거기에 SheetFrame이 축소 렌더까지 해서(iframe을 넓게 만들고 scale로 줄인다)
 * 같은 넓이에 더 많은 칸을 넣는다.
 * **내용을 이 앱으로 옮기지 않는다** — 실무가 이미 시트에서 돌고, 베끼면 두 벌이 어긋난다.
 *
 * iframe이 뜨려면 CSP frame-src에 docs.google.com이 있어야 한다(next.config.ts).
 * 그 설정이 빠지면 브라우저가 조용히 빈 사각형을 그린다 — 코드에는 아무 오류도 안 난다.
 * scripts/check-process-charts.ts가 그 짝을 지킨다.
 *
 * 적재 상태는 SheetFrame이 본다 — 교차 출처라 안을 볼 수 없어서 onLoad와 제한 시간으로만
 * '뜨는 중'과 '못 뜬다'를 가른다. 그 구분이 없으면 불러오는 동안 실패 안내가 보인다.
 */
/**
 * 폰(세로 768px 미만 · 가로로 눕힌 폰은 높이 500px 이하)에서는 시트를 카드에 띄우지 않는다.
 * 700px 시트를 360px 폭에 0.75로 줄여 넣으면 칸 두세 개만 보이고 글자는 읽을 수 없다 —
 * 큰 빈 상자만 스크롤을 먹는다. 그 자리에는 «전체 화면» 단추 하나만 둔다(/process/[id]가 시트 전용 화면).
 *
 * CSS로 숨기지 않고 아예 그리지 않는 이유: display:none인 iframe도 브라우저는 내려받는다.
 * 폰 데이터로 구글 시트 한 장을 매번 받는 것은 보지도 않는 것에 값을 치르는 것이다.
 * 서버 렌더는 넓은 화면으로 가정한다 — 데스크톱이 처음 그리는 모양이 예전과 같아야 한다.
 */
const COMPACT_QUERY = '(max-width: 767.98px), (max-height: 500px)'

function subscribeCompact(onChange: () => void) {
  const mq = window.matchMedia(COMPACT_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

function useCompactScreen(): boolean {
  return useSyncExternalStore(
    subscribeCompact,
    () => window.matchMedia(COMPACT_QUERY).matches,
    () => false,
  )
}

export function ProcessChartCard({
  charts,
  businesses,
}: {
  charts: ProcessChart[]
  businesses: Business[]
}) {
  // 차트가 있는 회사만 탭으로 세운다. 빈 탭은 누를 이유가 없다.
  const withCharts = businesses.filter((b) => charts.some((c) => c.business_id === b.business_id))
  const [businessId, setBusinessId] = useState(withCharts[0]?.business_id ?? '')
  const teams = charts.filter((c) => c.business_id === businessId)
  const [teamId, setTeamId] = useState<number | null>(null)
  const current = teams.find((t) => t.id === teamId) ?? teams[0] ?? null
  const compact = useCompactScreen()

  if (withCharts.length === 0) {
    return (
      <GlassCard as="section" padding="p-3.5" className="flex h-full flex-col">
        <h2 className="text-t13 font-semibold">프로세스차트</h2>
        <p className="mt-3 text-t12 text-ink-dim">
          등록된 프로세스차트가 없습니다.{' '}
          <Link href="/settings/process-charts" className="text-accent underline">
            등록 화면
          </Link>
          에서 팀별 시트를 연결하세요.
        </p>
      </GlassCard>
    )
  }

  return (
    <GlassCard as="section" padding="p-3.5" className="flex h-full min-h-0 flex-col">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-t13 font-semibold">프로세스차트</h2>
        {current && !compact ? (
          <Link
            href={`/process/${current.id}`}
            className="shrink-0 rounded-md border border-line bg-panel px-2 py-0.5 text-t11 text-ink-dim transition-colors hover:border-accent hover:text-ink"
          >
            전체 화면
          </Link>
        ) : null}
      </div>

      {/* 회사·팀 탭을 한 줄에 둔다. 전폭이라 두 줄로 나눌 이유가 없다.
          회사가 한 곳뿐이면 회사 탭은 그리지 않는다 — 고를 것이 없는 탭은 자리만 먹는다. */}
      <div className="m-tabs mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {withCharts.length > 1 ? (
          <div className="flex flex-wrap gap-1">
          {withCharts.map((b) => (
            <button
              key={b.business_id}
              type="button"
              onClick={() => {
                setBusinessId(b.business_id)
                setTeamId(null)
              }}
              aria-pressed={b.business_id === businessId}
              className={`rounded px-2 py-0.5 text-t11 transition-colors ${
                b.business_id === businessId
                  ? 'bg-accent/15 font-semibold text-accent'
                  : 'text-ink-dim hover:bg-raised hover:text-ink'
              }`}
              >
                {b.name}
              </button>
            ))}
          </div>
        ) : null}

        {withCharts.length > 1 ? <span className="text-line" aria-hidden="true">|</span> : null}

        <div className="flex flex-wrap gap-1">
          {teams.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTeamId(t.id)}
            aria-pressed={t.id === current?.id}
            className={`rounded px-2 py-0.5 text-t11 transition-colors ${
              t.id === current?.id
                ? 'bg-white/80 font-semibold text-ink shadow-sm'
                : 'text-ink-dim hover:bg-raised hover:text-ink'
            }`}
            >
              {t.team_name}
            </button>
          ))}
        </div>
      </div>

      {current && compact ? (
        <>
          <p className="mt-2 truncate text-t12 text-ink-dim">{current.title}</p>
          <Link
            href={`/process/${current.id}`}
            className="mt-2 flex items-center justify-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-2.5 text-t13 font-semibold whitespace-nowrap text-ink transition-colors hover:border-accent"
          >
            <Icon name="grid" className="size-4" />
            전체 화면
          </Link>
        </>
      ) : null}

      {current && !compact ? (
        <>
          {/* 700px는 '표가 읽히는 최소'다. 그 아래로 내리면 시트의 머리글과 첫 몇 행만 남는다. */}
          <SheetFrame
            src={embedSrc(current.embed_url)}
            title={current.title}
            className="mt-2 min-h-[700px] flex-1 rounded-md border border-line-soft"
          />
          {/* p가 아니라 div — 44px 터치 규칙(globals.css)은 문단 속 링크를 글 링크로 보고 뺀다. 이 링크는 버튼 자리다. */}
          <div className="mt-1.5 flex items-center justify-between gap-2 text-t10h text-ink-muted">
            <span className="truncate">{current.title}</span>
            <a
              href={current.embed_url}
              target="_blank"
              rel="noreferrer noopener"
              className="flex shrink-0 items-center gap-0.5 text-ink-dim hover:text-ink"
            >
              시트에서 편집
              <Icon name="chevron-right" className="size-3" />
            </a>
          </div>
        </>
      ) : null}
    </GlassCard>
  )
}
