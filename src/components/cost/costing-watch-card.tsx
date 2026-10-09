import { formatDateTime } from '@/lib/format'
import type { CostingWatchRow } from '@/types'

/**
 * 대표 화면 — «원가 관리 권한자» 감시(0061 cost_costing_watch). 대표에게만 그린다(부르는 화면이 막고, DB도 대표 외에는 cost_not_found).
 * 원가 관리는 원료별 값과 제품 원가를 같이 보므로 원리상 배합을 역산할 수 있다(설계서 16절 ③) — 막는 장치가 아니라 «누가 · 얼마나»를 보는 장치.
 */
export function CostingWatchCard({ rows, error }: { rows: CostingWatchRow[]; error?: string | null }) {
  const kstDate = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)) : '—'
  return (
    <section className="rounded-xl border border-line-soft bg-panel px-4 py-3" aria-label="원가 관리 권한자">
      <h2 className="text-t13 font-semibold">원가 관리 권한자 (최대 3명)</h2>
      <p className="mt-0.5 text-t11 text-ink-dim">
        원가 관리 권한자는 원료별 값과 제품 원가를 같이 보므로 원리상 배합을 역산할 수 있습니다 — 소수만 지정하고 조회는 모두 기록됩니다.
      </p>
      {error ? (
        <p className="mt-2 text-t12 text-critical">{error}</p>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-t12 text-ink-muted">지정된 사람이 없습니다. 사용자 화면(/settings/users)의 «원가 관리» 칸으로 켭니다.</p>
      ) : (
        <div className="mt-2 overflow-x-auto max-sm:overflow-visible">
          <table className="m-cards w-full text-t12 sm:min-w-[640px]">
            <thead>
              <tr className="border-b border-line-soft text-left text-t10h text-ink-muted">
                <th className="py-1.5 pr-3 font-normal">이름</th>
                <th className="py-1.5 pr-3 font-normal">권한 준 날</th>
                <th className="py-1.5 pr-3 text-right font-normal">최근 7일 원가 조회</th>
                <th className="py-1.5 pr-3 text-right font-normal">구매 · 영업 화면 열람</th>
                <th className="py-1.5 font-normal">마지막 조회</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_id} className="border-t border-line-soft">
                  <td className="py-1.5 pr-3 font-semibold">{r.display_name}</td>
                  <td className="py-1.5 pr-3 tnum" data-label="권한 준 날">
                    {kstDate(r.granted_at)}
                  </td>
                  <td className="py-1.5 pr-3 text-right tnum" data-label="최근 7일 원가 조회">
                    {r.cost_reads_7d}회
                  </td>
                  <td className="py-1.5 pr-3 text-right tnum" data-label="구매 · 영업 화면 열람">
                    {r.screen_reads_7d}회
                  </td>
                  <td className="py-1.5 tnum" data-label="마지막 조회">
                    {r.last_read_at ? formatDateTime(r.last_read_at) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
