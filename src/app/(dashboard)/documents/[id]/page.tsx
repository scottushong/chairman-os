import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageHeader } from '@/components/layout/page-header'
import { AuditTimeline } from '@/components/shared/audit-timeline'
import { SharePanel } from '@/components/shared/share-panel'
import { Icon } from '@/components/ui/icon'
import { formatDateTime } from '@/lib/format'
import { businessName } from '@/lib/lookup'
import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'
import { SECURITY_CLASS_LABEL_KO } from '@/types'

/**
 * CH-042 문서 단건 화면 (Phase 6-1 블록 C-1).
 *
 * 이 화면이 생긴 이유는 공유다. 회장 지시 블록 C는 "문서·업무·프로젝트 **상세**에 공유
 * 버튼"인데, 업무와 프로젝트에는 단건 화면이 있었고(D-12) 문서에는 목록뿐이었다.
 * 공유 버튼을 목록 줄에 달면 '무엇을 여는지'가 줄 하나로 좁혀져, 누르는 사람이 제목만
 * 보고 등급도 출처도 모른 채 남에게 문을 열게 된다.
 *
 * 파일은 여기에도 없다. 사내 스토리지의 주소만 있다(CLAUDE.md 데이터 원칙).
 *
 * 없는 문서와 볼 수 없는 문서를 구분하지 않는다 — 0002/0026의 documents_read가 둘 다
 * 내주지 않으므로 둘 다 404다. 회사 상세·업무 상세와 같은 규칙이다.
 */
export default async function DocumentDetailPage(props: PageProps<'/documents/[id]'>) {
  const { id } = await props.params

  const repo = await getRepository()
  const viewer = await currentUser()
  const [documents, businesses, audit, shares] = await Promise.all([
    repo.listDocuments(),
    repo.listBusinesses(),
    repo.listEntityAudit('documents', id),
    repo.listShares('documents', id),
  ])

  const doc = documents.find((d) => d.document_id === id)
  if (!doc) notFound()

  const scope = doc.business_id === 'group' ? '그룹 공통' : businessName(businesses, doc.business_id)

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      <PageHeader icon="book" title={doc.title} code="CH-042" description={`${scope} · ${doc.document_id}`}>
        <Link
          href="/documents"
          className="rounded-lg border border-line px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          문서 목록
        </Link>
        <a
          href={doc.storage_url}
          target="_blank"
          rel="noreferrer noopener"
          title={doc.storage_url}
          className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          <Icon name="file-text" className="size-3.5" />
          열기
        </a>
      </PageHeader>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <section className="rounded-xl border border-line-soft bg-panel p-4">
            <h2 className="text-[13px] font-semibold">문서</h2>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
              <Field label="소속">{scope}</Field>
              <Field label="유형">{doc.doc_type}</Field>
              <Field label="등급">{SECURITY_CLASS_LABEL_KO[doc.security_class]}</Field>
              <Field label="버전">v{doc.version}</Field>
              <Field label="등록자">{doc.uploaded_by}</Field>
              <Field label="등록">{formatDateTime(doc.created_at)}</Field>
            </dl>
            <p className="mt-3 text-[11px] leading-relaxed text-ink-muted">
              파일은 이 시스템에 없습니다. 사내 스토리지의 주소만 보관합니다 — Vault 등급일수록
              실체가 여기 없어야 합니다.
              {doc.security_class === 'Public'
                ? ' 이 문서는 공개 등급이라 같은 회사면 누구 밑인지와 무관하게 보입니다(0026).'
                : ''}
            </p>
          </section>

          <section className="rounded-xl border border-line-soft bg-panel p-4">
            <h2 className="flex items-baseline gap-2 text-[13px] font-semibold">
              이력
              <span className="text-[9px] font-normal text-ink-muted tnum">CH-051</span>
              <span className="text-[11px] font-normal text-ink-muted tnum">{audit.length}건</span>
            </h2>
            <div className="mt-3">
              <AuditTimeline records={audit} emptyMessage="아직 이 문서를 고친 기록이 없습니다." />
            </div>
          </section>
        </div>

        <aside className="xl:sticky xl:top-4 xl:self-start">
          <SharePanel
            entityTable="documents"
            entityId={doc.document_id}
            title={doc.title}
            shares={shares}
            viewerId={viewer?.user_id ?? null}
          />
        </aside>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] text-ink-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-[12.5px] text-ink-dim tnum">{children}</dd>
    </div>
  )
}
