import Link from 'next/link'
import { redirect } from 'next/navigation'

import { PageHeader } from '@/components/layout/page-header'
import { FeatureSwitchCard, type FeatureScopeRow } from '@/components/settings/feature-switch-card'
import { currentUser } from '@/lib/auth/session'
import { FEATURES, switchFor } from '@/lib/features'
import { formatDateTime } from '@/lib/format'
import { getRepository } from '@/lib/repository'

/**
 * /settings/features — 기능 스위치(0073 · «빼기 쉬운 구조» PHASE 1). 대표만.
 *
 * 새 기능마다: 켜기 · 끄기 · 보는 범위(대표만 · 임원 이상 · 전원) · 이유(필수) · 마지막으로 바꾼 사람 · 때.
 * 그룹 기본값과 회사별 덮어쓰기. 판정 규칙은 lib/features.ts · 0073 feature_on — 이 화면은 줄을 바꿀 뿐이다.
 * 직원은 /me로 보낸다(회장 전용 화면 원칙 — 이름과 존재를 숨긴다).
 * 반영에서 아예 빼는 법은 docs/onboarding/feature-removal.md.
 */
export default async function FeatureSwitchesPage() {
  const user = await currentUser()
  if (!user) redirect('/login')
  if (user.role !== 'Chairman') redirect('/me')

  const repo = await getRepository()
  const [rows, businesses, people] = await Promise.all([
    repo.listFeatureSwitches().catch(() => null),
    repo.listBusinesses().catch(() => []),
    repo.listUserAccounts().catch(() => []),
  ])
  const names = new Map(people.map((p) => [p.user_id, p.display_name] as const))
  const companies = businesses.filter((b) => b.visible).map((b) => ({ business_id: b.business_id, name: b.name }))
  const who = (id: string | null) => (id ? (names.get(id) ?? '알 수 없는 사람') : '처음 값')

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-5 sm:px-6">
      <PageHeader
        icon="settings"
        title="기능 스위치"
        code="0073"
        description="새 기능을 끄거나 보는 범위를 좁힙니다. 바꿀 때마다 이유가 감사 기록에 남습니다."
      >
        <Link
          href="/settings"
          className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-t11h text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          설정으로
        </Link>
      </PageHeader>
      {rows === null ? (
        <p className="mb-4 rounded-lg border border-line bg-panel px-3 py-2 text-t12h text-ink-muted">
          아직 스위치 표(0073)가 DB에 없습니다 — 지금은 아래 기본값으로 동작하고, 바꾸기는 마이그레이션 반영 뒤에 됩니다.
        </p>
      ) : null}
      <div className="space-y-3">
        {FEATURES.map((f) => {
          const group = switchFor(rows, f.key)
          const scopes: FeatureScopeRow[] = [
            {
              business_id: null,
              label: '그룹 기본',
              enabled: group?.enabled ?? true,
              audience: group?.audience ?? f.defaultAudience,
              reason: group?.reason ?? '기본값',
              changed: group ? `${who(group.updated_by)} · ${formatDateTime(group.updated_at)}` : '기본값(DB 줄 없음)',
            },
            ...(rows ?? [])
              .filter((r) => r.feature_key === f.key && r.business_id !== null)
              .map((r) => ({
                business_id: r.business_id,
                label: companies.find((c) => c.business_id === r.business_id)?.name ?? r.business_id ?? '',
                enabled: r.enabled,
                audience: r.audience,
                reason: r.reason,
                changed: `${who(r.updated_by)} · ${formatDateTime(r.updated_at)}`,
              })),
          ]
          return (
            <FeatureSwitchCard
              key={f.key}
              feature={{ key: f.key, label: f.label, description: f.description, from: f.from, defaultAudience: f.defaultAudience }}
              scopes={scopes}
              companies={companies}
              disabled={rows === null}
            />
          )
        })}
      </div>
      <p className="mt-6 text-t11h text-ink-muted">
        스위치는 화면 · 메뉴 · 동작을 막습니다. 반영에서 아예 빼는 법(브랜치 · 마이그레이션)은 저장소의 docs/onboarding/feature-removal.md에 있습니다.
      </p>
    </div>
  )
}
