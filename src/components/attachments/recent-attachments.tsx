import Link from 'next/link'

import { ATTACHMENT_CLASS_LABEL, entityPath, formatBytes } from '@/lib/attachments/rules'
import { ATTACHMENT_STATUS_LABEL_KO, type Attachment } from '@/types'

/**
 * /documents의 «첨부 · AI 요약» — 상세 화면들(이니셔티브 · 회사 · 문서 · 결재)에 붙은 파일을 한곳에서.
 * 링크 방식 문서 목록 옆에 둔다(회장 지시: «기존 링크 방식과 나란히»). 올리기는 각 상세 화면에서 한다 —
 * 첨부의 권한이 «붙은 대상»에서 오므로 대상 없이 올리는 길을 만들지 않는다.
 */

const ENTITY_LABEL: Record<Attachment['entity_table'], string> = {
  initiatives: '이니셔티브',
  businesses: '회사',
  documents: '문서',
  decisions: '결재',
}

export function RecentAttachments({ attachments, scopeName }: { attachments: Attachment[]; scopeName: (id: string | null) => string }) {
  return (
    <section className="mt-3 rounded-xl border border-line-soft bg-panel p-4" aria-label="첨부 · AI 요약">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-t13 font-semibold">
          첨부 · AI 요약 <span className="text-t11 font-normal text-ink-muted">최근 {attachments.length}건</span>
        </h2>
        <p className="text-t10h text-ink-muted">파일은 각 상세 화면의 «첨부»에서 올립니다 · 요약은 결정 아님</p>
      </div>
      {attachments.length === 0 ? (
        <p className="mt-3 text-t11 text-ink-muted">아직 붙인 파일이 없습니다.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line-soft">
          {attachments.map((a) => {
            const s = a.ai_summary
            const href = a.entity_table === 'decisions' ? `/approvals?id=${encodeURIComponent(a.entity_id)}` : entityPath(a.entity_table, a.entity_id)
            return (
              <li key={a.attachment_id} className="py-2.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link href={href} className="min-w-0 truncate text-t12h font-semibold text-ink hover:underline">
                    {a.file_name}
                  </Link>
                  <span className="text-t10h text-ink-muted">
                    {ENTITY_LABEL[a.entity_table]} · {scopeName(a.business_id)} · {formatBytes(a.size_bytes)} · {a.created_at.slice(0, 10)}
                  </span>
                  <span className={`rounded px-1.5 py-0.5 text-t10h ${a.security_class === 'Vault' ? 'bg-gold/15 text-gold' : 'bg-raised text-ink-dim'}`}>
                    {ATTACHMENT_CLASS_LABEL[a.security_class]}
                  </span>
                  <span className={`text-t10h ${a.status === 'failed' ? 'text-critical' : 'text-ink-muted'}`}>{ATTACHMENT_STATUS_LABEL_KO[a.status]}</span>
                  {s?.dummy ? <span className="rounded bg-warning/15 px-1.5 py-0.5 text-t10h text-warning">DUMMY 요약</span> : null}
                </div>
                {s ? (
                  <div className="mt-1 text-t11h leading-relaxed text-ink-dim">
                    <p>{s.summary_ko?.[0] ?? s.summary[0]}</p>
                    {s.decisions_needed.length ? (
                      <p className="text-t10h text-ink-muted">결정 필요 {s.decisions_needed.length}건 · {s.decisions_needed[0]}</p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
