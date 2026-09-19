import Link from 'next/link'
import { notFound } from 'next/navigation'

import { KeymenPanel } from '@/components/business/keymen-panel'
import { EventPanel } from '@/components/initiatives/event-panel'
import { InitiativeDocsPanel } from '@/components/initiatives/initiative-docs-panel'
import { InitiativeNotePanel, InitiativePanel, InitiativeSidePanel } from '@/components/initiatives/initiative-panel'
import { LogoUpload } from '@/components/initiatives/logo-upload'
import { PageHeader } from '@/components/layout/page-header'
import { AuditTimeline } from '@/components/shared/audit-timeline'
import { currentUser } from '@/lib/auth/session'
import { kstToday } from '@/lib/chairman-project'
import { getRepository } from '@/lib/repository'
import { INITIATIVE_KIND_LABEL_KO, INITIATIVE_STAGE_LABEL_KO, INITIATIVE_STATUS_LABEL_KO } from '@/types'

/**
 * Task 7 — `/initiatives/[id]` 상세. `business/[id]/page.tsx`가 본이다.
 *
 * 화면 순서는 그 화면과 같다: 읽기 카드(개요) → 칸별 편집 → 키맨 → 문서 → 이벤트 → 이력.
 * 오른쪽 <aside>는 단계·상태·유형을 바꾸는 자리다 — 그 셋은 자유 입력이 아니라 <select>다.
 *
 * 세 목록(키맨·문서·이벤트)은 계약이 전건을 준다(Task 3). 화면에서 이 건의 것만 거른다.
 *
 * 없는 건과 볼 수 없는 건을 구분하지 않는다. initiatives_read(0017)가 권한 밖의 건을
 * 아예 내주지 않으므로 둘 다 목록에 없고 둘 다 404다.
 *
 * 회장 메모는 isChairman일 때만 그린다 — canEdit(Chairman·GroupCFO)과는 다른 값이다.
 * getInitiativeNote는 메모가 없을 때도, RLS가 가렸을 때도 똑같이 null을 준다.
 * 값으로 분기하면 GroupCFO에게 빈 '메모 없음' 섹션이 보이는데, 그건 거짓말이거나
 * (회장이 써 놨는데 안 보이는 것) 정보 누출이다(써 놨다는 사실 자체가 드러남).
 */
export default async function InitiativePage(props: PageProps<'/initiatives/[id]'>) {
  const { id } = await props.params

  const repo = await getRepository()
  const [initiative, note, keymen, docs, events, businesses, audit, user] = await Promise.all([
    repo.getInitiative(id),
    repo.getInitiativeNote(id),
    repo.listInitiativeKeymen(),
    repo.listInitiativeDocs(),
    repo.listEvents(),
    repo.listBusinesses(),
    repo.listEntityAudit('initiatives', id),
    currentUser(),
  ])
  if (!initiative) notFound()

  const today = kstToday()
  const canEdit = user?.role === 'Chairman' || user?.role === 'GroupCFO'
  const isChairman = user?.role === 'Chairman'

  // 로고 한 장짜리도 signInitiativeLogos로 서명한다 — 별도 단건 서명 API를 새로 만들지 않는다.
  const logoUrls = initiative.logo_url ? await repo.signInitiativeLogos([initiative.logo_url]) : {}
  const logoUrl = initiative.logo_url ? logoUrls[initiative.logo_url] : undefined

  const ownKeymen = keymen.filter((k) => k.initiative_id === id)
  const ownDocs = docs.filter((d) => d.initiative_id === id)
  const ownEvents = events.filter((e) => e.initiative_id === id)

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      <PageHeader
        icon="target"
        title={initiative.title}
        code="Phase 4-A"
        description={`${INITIATIVE_KIND_LABEL_KO[initiative.kind]} · ${INITIATIVE_STAGE_LABEL_KO[initiative.stage]} · ${INITIATIVE_STATUS_LABEL_KO[initiative.status]}`}
      >
        <Link
          href="/initiatives"
          className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          목록으로
        </Link>
      </PageHeader>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-3.5 pb-6">
          <LogoUpload
            initiativeId={id}
            title={initiative.title}
            path={initiative.logo_url}
            url={logoUrl}
            canEdit={canEdit}
          />

          <InitiativePanel initiative={initiative} businesses={businesses} canEdit={canEdit} today={today} />

          {isChairman ? <InitiativeNotePanel initiativeId={id} note={note ?? ''} /> : null}

          <KeymenPanel scope={{ kind: 'initiative', initiativeId: id }} keymen={ownKeymen} canEdit={canEdit} />

          <InitiativeDocsPanel initiativeId={id} docs={ownDocs} canEdit={canEdit} />

          <EventPanel events={ownEvents} canEdit={canEdit} initiativeId={id} />

          <section className="rounded-xl border border-line-soft bg-panel p-4">
            <h2 className="text-[13px] font-semibold">이력</h2>
            <p className="mt-1 mb-3 text-[11px] text-ink-muted">
              감사 기록(audit_log)을 이 건으로 되짚은 것이다. 지워지지 않는다.
            </p>
            <AuditTimeline records={audit} emptyMessage="아직 이 건을 고친 기록이 없습니다." />
          </section>
        </div>

        <aside className="rounded-xl border border-line-soft bg-panel p-4 xl:sticky xl:top-4 xl:self-start">
          <h2 className="text-[13px] font-semibold">단계 · 상태</h2>
          <div className="mt-3">
            <InitiativeSidePanel initiative={initiative} canEdit={canEdit} />
          </div>
        </aside>
      </div>
    </div>
  )
}
