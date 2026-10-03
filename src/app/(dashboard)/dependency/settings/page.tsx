import Link from 'next/link'
import { redirect } from 'next/navigation'

import { Missing, Section } from '@/components/dependency/pieces'
import { PageHeader } from '@/components/layout/page-header'
import { recordScreenRead } from '@/lib/activity-record'
import { currentUser } from '@/lib/auth/session'
import { kstToday } from '@/lib/chairman-project'
import {
  BACKFILL_RULES_KO,
  BACKFILL_UNREACHED_KO,
  DEPENDENCY_LADDER,
  DEPENDENCY_TARGET,
  IMPORTANT_DECISION_RULE_KO,
  recentPeriods,
} from '@/lib/dependency'
import { getRepository } from '@/lib/repository'
import {
  AUTONOMY_CRITERIA_KO,
  AUTONOMY_LEVEL,
  AUTONOMY_TAG_EN,
  DECIDED_BY_KIND,
  DECIDED_BY_KIND_HINT_KO,
  DECIDED_BY_KIND_LABEL_KO,
} from '@/types'

/**
 * /dependency/settings — 세는 규칙 (§7 · §9).
 *
 * ■ 왜 화면이 필요한가 ■ 이 블록의 Ruling 하나가 "'중요한 의사결정'의 정의를 화면에 글로
 * 적어 회장이 보고 고칠 수 있게 하라"였다. 정의가 코드 안에만 있으면 회장은 숫자만 보고,
 * 그 숫자가 무엇을 센 것인지 물을 자리가 없다.
 *
 * ■ 역산 도달률도 여기 있다 ■ 지금 몇 %가 역산으로 채워졌고 몇 %가 비어 있는지를 **센다.**
 * 이 숫자는 시간이 지나면 저절로 좋아진다(0033 이후의 결정은 트리거가 채운다) — 그 개선을
 * 볼 수 있어야 "언제부터 이 지표를 믿을 수 있나"에 답할 수 있다.
 *
 * ■ 분기 평가 «알림» ■ 스위치를 두지 않았다. 이 저장소에는 아직 알림을 만드는 코드가
 * 없고(0030 notifications는 비어 있다), 눌러도 아무 일 없는 스위치는 특히 나쁜 종류의
 * 거짓말이다. 대신 **이번 분기에 평가가 없는 회사 목록**을 여기 둔다 — 그 목록이 곧 알림이다.
 */
export default async function DependencySettingsPage() {
  // 회장 메모(2026-10) — 세는 규칙은 회장 화면이다. 의존 화면 전체가 회장 전용이 되어(2026-10-02) 다른 역할은 /me로.
  // 기록보다 먼저 — 들르지 않은 화면을 «열었다»로 남기지 않는다.
  const viewer = await currentUser()
  if (viewer?.role !== 'Chairman') redirect('/me')

  await recordScreenRead({ path: '/dependency/settings', kind: 'page' })

  const repo = await getRepository()
  const [businesses, dependency, autonomy] = await Promise.all([
    repo.listBusinesses(),
    repo.listFounderDependency(),
    repo.listAutonomyAssessments(),
  ])

  const months = recentPeriods(12)
  const window = dependency.filter((r) => months.includes(r.period))
  const known = window.reduce((a, r) => a + Number(r.total_count), 0)
  const unknown = window.reduce((a, r) => a + Number(r.unknown_count), 0)
  const reach = known + unknown === 0 ? null : Math.round((known / (known + unknown)) * 1000) / 10

  const today = kstToday()
  const quarter = `${today.slice(0, 4)}-Q${Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1}`
  const visible = businesses.filter((b) => b.visible)
  const assessedThisQuarter = new Set(
    autonomy.filter((a) => a.quarter === quarter).map((a) => a.business_id),
  )
  const missing = visible.filter((b) => !assessedThisQuarter.has(b.business_id))

  return (
    <div className="mx-auto max-w-[980px] px-6 py-5">
      <PageHeader
        icon="settings"
        title="의존 — 세는 규칙"
        code="§7 · §9"
        description="이 화면의 숫자가 무엇을 센 것인지, 그리고 세지 못한 것이 무엇인지 적어 둡니다."
      >
        <Link
          href="/dependency"
          className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-t11h text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          의존으로
        </Link>
      </PageHeader>

      {/* ───────── 식 ───────── */}
      <Section icon="target" title="Founder Dependency는 이렇게 셉니다 (§7)">
        <p className="rounded-lg bg-raised px-3 py-2.5 text-t12 leading-relaxed text-ink">
          회장이 관여한 중요한 의사결정 ÷ 전체 중요한 의사결정 × 100
        </p>
        <p className="mt-2 text-t11 leading-relaxed text-ink-dim">
          목표는 {DEPENDENCY_LADDER.map((v, i) => (i === DEPENDENCY_LADDER.length - 1 ? `<${v}%` : `${v}% → `)).join('')}
          입니다. 마지막 {DEPENDENCY_TARGET}%가 §7이 적은 TARGET이고, 첫 칸 37%는 문서 §35의 예시
          화면 숫자입니다 — 이 저장소가 잰 값이 아닙니다.
        </p>
      </Section>

      {/* ───────── '중요한 결정'의 정의 ───────── */}
      <Section icon="book" title="무엇을 «중요한 의사결정»으로 세는가">
        <p className="rounded-lg bg-raised px-3 py-2.5 text-t11h leading-relaxed text-ink">
          {IMPORTANT_DECISION_RULE_KO}
        </p>
        <p className="mt-2 text-t10h leading-relaxed text-ink-muted">
          아직 처리되지 않은 결정(결재 대기)은 세지 않습니다 — «누가 정했나»가 아직 없는 건이라,
          세면 처리 전에 이미 의존도가 움직입니다.
        </p>
      </Section>

      {/* ───────── 분류 세 값 ───────── */}
      <Section icon="grid" title="결정을 셋으로 나눕니다">
        <dl className="space-y-1">
          {DECIDED_BY_KIND.map((k) => (
            <div key={k} className="rounded-lg bg-raised px-3 py-2">
              <dt className="text-t11h font-semibold text-ink">{DECIDED_BY_KIND_LABEL_KO[k]}</dt>
              <dd className="mt-0.5 text-t10h leading-relaxed text-ink-muted">
                {DECIDED_BY_KIND_HINT_KO[k]}
              </dd>
            </div>
          ))}
          <div className="rounded-lg bg-raised px-3 py-2">
            <dt className="text-t11h font-semibold text-ink">비어 있음 (역산 미도달)</dt>
            <dd className="mt-0.5 text-t10h leading-relaxed text-ink-muted">
              이 셋 중 무엇인지 알아낼 근거가 없는 건입니다. **값이 아니라 «모른다»는 사실입니다.**
              분자에서도 분모에서도 빠집니다.
            </dd>
          </div>
        </dl>
      </Section>

      {/* ───────── 역산 ───────── */}
      <Section icon="clock" title="옛 결정은 이렇게 역산했습니다" note="0033 3절과 같은 규칙">
        <p className="text-t10h leading-relaxed text-ink-muted">
          0033 이전의 결정에는 «회장이 정했는가»를 말해 주는 칸이 없었습니다. 그래서 이미 남아 있는
          기록으로 되짚었고, 되짚을 수 없는 건은 비워 두었습니다.
        </p>
        <ol className="mt-2 space-y-1">
          {BACKFILL_RULES_KO.map((rule) => (
            <li key={rule} className="rounded-lg bg-raised px-3 py-2 text-t11 leading-relaxed text-ink-dim">
              {rule}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-t10h leading-relaxed text-ink-muted">{BACKFILL_UNREACHED_KO}</p>

        <div className="mt-2 rounded-lg bg-raised px-3 py-2.5">
          <p className="text-t10h text-ink-dim">최근 12개월 역산 도달률</p>
          {reach === null ? (
            <p className="mt-0.5 text-t11 text-ink-muted">
              처리된 결정이 아직 한 건도 없어 도달률을 낼 수 없습니다. (0건 중 0건)
            </p>
          ) : (
            <>
              <p className="mt-0.5 text-t20 font-bold leading-none text-ink tnum">{reach}%</p>
              <p className="mt-1 text-t10h text-ink-muted tnum">
                처리된 결정 {known + unknown}건 중 {known}건을 분류했고 {unknown}건은 비어 있습니다.
              </p>
            </>
          )}
          <p className="mt-1.5 text-t10 leading-relaxed text-ink-muted">
            0033 이후에 처리되는 결정은 DB가 곧바로 분류하므로, 이 비율은 시간이 지나면 저절로
            올라갑니다. 지금 낮다면 그것은 고장이 아니라 «옛 기록이 그만큼밖에 안 남아 있다»는 뜻입니다.
          </p>
        </div>
      </Section>

      {/* ───────── §9 기준표 ───────── */}
      <Section icon="crown" title="CEO 자율성 L1~L5 기준 (§9)" note="문서 원문 그대로">
        <dl className="space-y-1">
          {AUTONOMY_LEVEL.map((l) => (
            <div key={l} className="flex gap-3 rounded-lg bg-raised px-3 py-2">
              <dt className="w-8 shrink-0 text-t12 font-bold text-ink tnum">{l}</dt>
              <dd className="text-t11 leading-relaxed text-ink-dim">
                {AUTONOMY_CRITERIA_KO[l]}
                <span className="mt-0.5 block text-t10 text-ink-muted">{AUTONOMY_TAG_EN[l]}</span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-t10h leading-relaxed text-ink-muted">
          §12의 부재 테스트가 365일을 통과하기 전에는 CEO를 진짜 L5로 보지 않습니다. 등급과 부재
          테스트는 같은 질문의 두 측면입니다.
        </p>
      </Section>

      {/* ───────── 분기 평가 ───────── */}
      <Section icon="bell" title={`${quarter} 평가가 아직 없는 회사`} note="이 목록이 곧 분기 평가 알림입니다">
        {missing.length === 0 ? (
          <Missing>이번 분기에는 모든 회사의 자율성 평가가 끝났습니다.</Missing>
        ) : (
          <ul className="space-y-1">
            {missing.map((b) => (
              <li key={b.business_id} className="rounded-lg bg-raised px-3 py-2 text-t11h">
                <Link href={`/dependency/${b.business_id}`} className="font-semibold text-ink underline-offset-2 hover:underline">
                  {b.name}
                </Link>
                <span className="ml-2 text-t10h text-ink-muted">평가하러 가기</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-t10 leading-relaxed text-ink-muted">
          알림을 켜고 끄는 스위치를 두지 않았습니다. 알림을 만들어 보내는 코드가 이 저장소에 아직
          없어서(야간 Job은 블록 B가 들고 옵니다), 스위치를 두면 켜 놓고도 아무것도 오지 않습니다.
        </p>
      </Section>

      <div className="pb-6" />
    </div>
  )
}
