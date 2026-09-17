import { BasisTag } from '@/components/finance/figure'
import type { SlipView } from '@/lib/ledger/journal'
import type { Account } from '@/types'

/**
 * 한 달의 전표 목록 (Phase 2-B 블록 2). 전표 한 장 = 헤더 한 줄 + 라인들.
 *
 * 꼬리표는 그 달이 마감됐나로 정한다(lib/ledger/basis.ts ledgerBasisOf와 같은 규칙).
 * 원천: '자체'는 이 화면에서 넣은 전표(헤더 있음), 'ECOUNT'는 가져온 전표다.
 */
export function SlipList({
  slips,
  accounts,
  actions,
}: {
  slips: SlipView[]
  accounts: Map<string, Account>
  /** 전표 한 장 옆에 붙는 동작(블록 4 정정). 서버가 만든 노드를 받는다 */
  actions?: (slip: SlipView) => React.ReactNode
}) {
  if (slips.length === 0) {
    return <p className="px-1 py-6 text-center text-[12px] text-ink-muted">이 달에는 전표가 없습니다.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-[12px]">
        <thead>
          <tr className="border-b border-line-soft text-left text-[10.5px] text-ink-muted">
            <th className="px-2 py-1.5 font-normal">일자 · 전표번호</th>
            <th className="px-2 py-1.5 font-normal">계정</th>
            <th className="px-2 py-1.5 text-right font-normal">차변</th>
            <th className="px-2 py-1.5 text-right font-normal">대변</th>
            <th className="px-2 py-1.5 font-normal">적요</th>
          </tr>
        </thead>
        {slips.map((s) => (
          <tbody key={s.slip_no} className="border-b border-line-soft">
            <tr className="bg-raised/40">
              <td className="px-2 py-1.5 whitespace-nowrap">
                <span className="tnum">{s.entry_date}</span>{' '}
                <span className="tnum text-[11px] text-ink-muted">{s.slip_no}</span>
              </td>
              <td className="px-2 py-1.5" colSpan={3}>
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold">{s.memo || '(적요 없음)'}</span>
                  <BasisTag basis={s.closed ? 'confirmed' : 'provisional'} />
                  <span className="rounded border border-line px-1 text-[9.5px] text-ink-muted">{s.own ? '자체' : 'ECOUNT'}</span>
                  {s.correction ? (
                    <span className="rounded border border-warning/40 px-1 text-[9.5px] text-warning">
                      {s.correction.kind === 'reversal' ? '역분개' : '정정'} ← <span className="tnum">{s.correction.corrects_id}</span>
                    </span>
                  ) : null}
                  {s.corrected_by.length > 0 ? (
                    <span className="rounded border border-line px-1 text-[9.5px] text-ink-muted">
                      정정됨 → <span className="tnum">{s.corrected_by.join(', ')}</span>
                    </span>
                  ) : null}
                  {s.evidence_url ? (
                    <a
                      href={s.evidence_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-ink-dim underline-offset-2 hover:text-ink hover:underline"
                    >
                      증빙
                    </a>
                  ) : null}
                </span>
              </td>
              <td className="px-2 py-1.5 text-right whitespace-nowrap">{actions?.(s)}</td>
            </tr>
            {s.lines.map((l) => {
              const a = accounts.get(l.account_code)
              return (
                <tr key={l.line_no}>
                  <td />
                  <td className="px-2 py-1">
                    <span className="tnum text-ink-muted">{l.account_code}</span> {a?.name ?? '(알 수 없는 계정)'}
                  </td>
                  <td className="px-2 py-1 text-right tnum">{l.side === 'debit' ? l.amount.toLocaleString('ko-KR') : ''}</td>
                  <td className="px-2 py-1 text-right tnum">{l.side === 'credit' ? l.amount.toLocaleString('ko-KR') : ''}</td>
                  <td className="px-2 py-1 text-[11px] text-ink-muted">{l.memo !== s.memo ? l.memo : ''}</td>
                </tr>
              )
            })}
          </tbody>
        ))}
      </table>
    </div>
  )
}
