import { PageHeader } from '@/components/layout/page-header'
import { RegisterDocument } from '@/components/documents/register-document'
import { FilterChips, type FilterOption } from '@/components/ui/filter-chips'
import { Icon } from '@/components/ui/icon'
import { formatDateTime } from '@/lib/format'
import { businessName } from '@/lib/lookup'
import { firstParam, oneOf, withParams } from '@/lib/query'
import { getRepository } from '@/lib/repository'
import {
  SECURITY_CLASS,
  SECURITY_CLASS_LABEL_KO,
  type DocumentRecord,
  type SecurityClass,
} from '@/types'

/**
 * CH-042 문서관리.
 *
 * 이 화면에는 파일이 없다. 사내 스토리지에 있는 문서의 주소만 모아 둔다
 * (CLAUDE.md 데이터 원칙 / supabase/vault_columns.md 선택지 B).
 * 그래서 '업로드'가 아니라 '링크 등록'이고, 목록의 마지막 칸은 미리보기가 아니라 바깥으로 나가는 링크다.
 *
 * 보안등급 필터는 '내가 볼 수 있는 것 중에서' 고르는 도구다. 등급이 모자란 문서는
 * 이 목록에 아예 오지 않는다 — 필터를 Vault로 놓아도 없는 것이 보이지는 않는다.
 * 그 판정은 0002의 documents_read가 하고, 앱은 그 결과를 받기만 한다.
 */

const BASE = '/documents'
const GROUP = 'group'

/** 등급 색. Vault만 색을 준다 — 색은 위험에만 쓴다(요구사항서 2번). */
const CLASS_TONE: Record<SecurityClass, string> = {
  Normal: 'bg-raised text-ink-muted',
  Restricted: 'bg-raised text-ink-dim',
  Vault: 'bg-gold/15 text-gold',
}

export default async function DocumentsPage(props: PageProps<'/documents'>) {
  const params = await props.searchParams
  const classFilter = oneOf(firstParam(params.class), SECURITY_CLASS)
  const businessFilter = firstParam(params.business)

  const repo = await getRepository()
  const [documents, businesses] = await Promise.all([repo.listDocuments(), repo.listBusinesses()])

  const byBusiness = businessFilter
    ? documents.filter((d) => d.business_id === businessFilter)
    : documents
  const byClass = classFilter
    ? documents.filter((d) => d.security_class === classFilter)
    : documents

  const shown = byBusiness.filter((d) => !classFilter || d.security_class === classFilter)

  const classOptions: FilterOption[] = [
    {
      label: '전체',
      href: withParams(BASE, { business: businessFilter }),
      active: !classFilter,
      count: byBusiness.length,
    },
    ...SECURITY_CLASS.map((c) => ({
      label: SECURITY_CLASS_LABEL_KO[c],
      href: withParams(BASE, { business: businessFilter, class: c }),
      active: classFilter === c,
      count: byBusiness.filter((d) => d.security_class === c).length,
    })),
  ]

  const businessOptions: FilterOption[] = [
    {
      label: '전체',
      href: withParams(BASE, { class: classFilter }),
      active: !businessFilter,
      count: byClass.length,
    },
    {
      label: '그룹 공통',
      href: withParams(BASE, { business: GROUP, class: classFilter }),
      active: businessFilter === GROUP,
      count: byClass.filter((d) => d.business_id === GROUP).length,
    },
    ...businesses.map((b) => ({
      label: b.name,
      href: withParams(BASE, { business: b.business_id, class: classFilter }),
      active: businessFilter === b.business_id,
      count: byClass.filter((d) => d.business_id === b.business_id).length,
    })),
  ]

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      <PageHeader
        icon="book"
        title="문서 / 지식"
        code="CH-042"
        description="사내 스토리지에 있는 문서의 링크와 보안등급을 모아 둔다. 파일 자체는 여기 없다."
      >
        <RegisterDocument businesses={businesses} />
      </PageHeader>

      <div className="mt-4 space-y-2 rounded-xl border border-line-soft bg-panel/60 px-3.5 py-3">
        <FilterChips label="등급" options={classOptions} />
        <FilterChips label="소속" options={businessOptions} />
      </div>

      <div className="mt-3 rounded-xl border border-line-soft bg-panel">
        {shown.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-[12.5px] text-ink-muted">
              {documents.length === 0
                ? '등록된 문서가 없습니다. 오른쪽 위 «링크 등록»으로 첫 문서를 올립니다.'
                : '조건에 맞는 문서가 없습니다.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse">
              <thead>
                <tr className="text-[10px] tracking-[0.08em] text-ink-muted">
                  <th className="px-3 py-2 text-left font-semibold">문서</th>
                  <th className="px-3 py-2 text-left font-semibold">소속</th>
                  <th className="px-3 py-2 text-left font-semibold">유형</th>
                  <th className="px-3 py-2 text-left font-semibold">등급</th>
                  <th className="px-3 py-2 text-right font-semibold">버전</th>
                  <th className="px-3 py-2 text-left font-semibold">등록</th>
                  <th className="px-3 py-2 text-center font-semibold">링크</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => (
                  <DocumentRow
                    key={d.document_id}
                    doc={d}
                    scopeName={
                      d.business_id === GROUP
                        ? '그룹 공통'
                        : businessName(businesses, d.business_id)
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-3 pb-6 text-[11px] text-ink-muted">
        {shown.length}건 표시 중. 열람 등급이 모자란 문서는 이 목록에 오지 않는다 — 필터를
        Vault로 놓아도 없는 것이 보이지는 않는다(0002 documents_read).
      </p>
    </div>
  )
}

function DocumentRow({ doc, scopeName }: { doc: DocumentRecord; scopeName: string }) {
  return (
    <tr className="border-t border-line-soft">
      <td className="px-3 py-2">
        <p className="text-[12.5px] leading-snug font-semibold">{doc.title}</p>
        <p className="mt-0.5 text-[10px] text-ink-muted tnum">{doc.document_id}</p>
      </td>
      <td className="px-3 py-2 text-[11.5px] text-ink-dim">{scopeName}</td>
      <td className="px-3 py-2 text-[11.5px] text-ink-dim">{doc.doc_type}</td>
      <td className="px-3 py-2">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${CLASS_TONE[doc.security_class]}`}
        >
          {SECURITY_CLASS_LABEL_KO[doc.security_class]}
        </span>
      </td>
      <td className="px-3 py-2 text-right text-[11.5px] text-ink-dim tnum">v{doc.version}</td>
      <td className="px-3 py-2 text-[11px] text-ink-muted tnum">
        {formatDateTime(doc.created_at)}
        <span className="block text-ink-muted">{doc.uploaded_by}</span>
      </td>
      <td className="px-3 py-2 text-center">
        {/* 바깥으로 나가는 링크다. noreferrer를 붙이는 이유는 사내 스토리지 주소에
            Chairman OS의 화면 주소가 Referer로 따라 나가지 않게 하기 위해서다. */}
        <a
          href={doc.storage_url}
          target="_blank"
          rel="noreferrer noopener"
          title={doc.storage_url}
          className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          <Icon name="file-text" className="size-3.5" />
          열기
        </a>
      </td>
    </tr>
  )
}
