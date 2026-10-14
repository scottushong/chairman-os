import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageHeader } from '@/components/layout/page-header'
import { FeedbackInbox } from '@/components/settings/feedback-inbox'
import { currentUser } from '@/lib/auth/session'
import { featureOn } from '@/lib/features-server'
import { kstToday } from '@/lib/chairman-project'
import { TRIAGE_FEATURES } from '@/lib/feedback/triage'
import { getRepository } from '@/lib/repository'

/**
 * /settings/feedback — 회장 «시스템 보완함»(0069, 회장 결정 5). 대표만.
 *
 * AI 어시스턴트 답마다 남긴 «시스템 보완 의견»을 모아 본다: 상태 · 쓴 사람 · 화면 · 날짜로 거르고, 의견마다 «AI 정리»
 * (요약 · 기대 결과 · Claude Code 지시문), 같은 화면의 비슷한 의견은 «묶음 지시문» 하나로. 밤에는 night-brief가 새 의견을 정리해 둔다.
 * **지시문은 복사만 된다** — 자동 실행 · 저장소 변경 없음. 대표가 복사해 직접 Claude Code에 붙인다.
 * 404로 막는 것은 안내다 — 실제 문은 0069 정책(ai_feedback_chairman_read)이다.
 */
export default async function FeedbackInboxPage() {
  const user = await currentUser()
  if (!user || user.role !== 'Chairman') notFound()
  // 0073 기능 스위치 «AI 어시스턴트 보강» — 꺼져 있으면 보완함도 없는 화면.
  if (!(await featureOn(user, 'ai_assist'))) notFound()

  const repo = await getRepository()
  const [rows, bundles, usage] = await Promise.all([
    repo.listAiFeedback().catch(() => []),
    repo.listAiFeedbackBundles().catch(() => []),
    repo.listAiUsageDays(32).catch(() => []),
  ])
  const monthStart = `${kstToday().slice(0, 7)}-01`
  const features = new Set<string>(TRIAGE_FEATURES)
  const month = usage.filter((u) => u.day >= monthStart && features.has(u.feature))
  const cost = {
    usd: Math.round(month.reduce((a, u) => a + u.cost_usd, 0) * 10_000) / 10_000,
    calls: month.reduce((a, u) => a + u.calls, 0),
    month: monthStart.slice(0, 7),
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6">
      <PageHeader
        icon="sparkles"
        title="시스템 보완함"
        code="0069"
        description="AI 어시스턴트 답마다 남긴 보완 의견. AI 정리 → 지시문 복사 → Claude Code에 직접 붙이기. 자동 실행은 없습니다."
      >
        <Link
          href="/settings"
          className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-t11h text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          설정으로
        </Link>
      </PageHeader>
      <FeedbackInbox rows={rows} bundles={bundles} cost={cost} aiConnected={!!process.env.ANTHROPIC_API_KEY} />
    </div>
  )
}
