'use client'

import Link from 'next/link'
import { useState } from 'react'

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

  if (withCharts.length === 0) {
    return (
      <GlassCard as="section" padding="p-3.5" className="flex h-full flex-col">
        <h2 className="text-[13px] font-semibold">프로세스차트</h2>
        <p className="mt-3 text-[12px] text-ink-dim">
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
        <h2 className="text-[13px] font-semibold">프로세스차트</h2>
        {current ? (
          <Link
            href={`/process/${current.id}`}
            className="shrink-0 rounded-md border border-line bg-panel px-2 py-0.5 text-[11px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
          >
            전체 화면
          </Link>
        ) : null}
      </div>

      {/* 회사·팀 탭을 한 줄에 둔다. 전폭이라 두 줄로 나눌 이유가 없다.
          회사가 한 곳뿐이면 회사 탭은 그리지 않는다 — 고를 것이 없는 탭은 자리만 먹는다. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
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
              className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
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
            className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
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

      {current ? (
        <>
          {/* 700px는 '표가 읽히는 최소'다. 그 아래로 내리면 시트의 머리글과 첫 몇 행만 남는다. */}
          <SheetFrame
            src={embedSrc(current.embed_url)}
            title={current.title}
            className="mt-2 min-h-[700px] flex-1 rounded-md border border-line-soft"
          />
          <p className="mt-1.5 flex items-center justify-between gap-2 text-[10.5px] text-ink-muted">
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
          </p>
        </>
      ) : null}
    </GlassCard>
  )
}
