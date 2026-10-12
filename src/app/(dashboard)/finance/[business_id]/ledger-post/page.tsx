import Link from 'next/link'
import { notFound } from 'next/navigation'

import { decideLedgerPost, stageLedgerPost } from '@/app/actions/ledger-post'
import { PageHeader } from '@/components/layout/page-header'
import { canKeepBooks } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { kstToday } from '@/lib/chairman-project'
import { featureOn } from '@/lib/features-server'
import { ledgerPostError } from '@/lib/ledger/post-text'
import { getRepository } from '@/lib/repository'
import type { LedgerQueueRow } from '@/types'

/**
 * PHASE 7 원장 → 장부 반영(0079). 자료 올리기의 ⑤ 계정별 원장 줄을 «반영 대기 → 반영» 2단계로 장부 전표(0016)에 넣는다.
 * 같은 거래(0072 same 묶음) 줄은 DB가 함께 넣고(한 번만), 중복 의심(suspect) 줄은 고를 수 없다. 마감 달은 대표 · 그룹 CFO + 이유.
 * 되돌리기는 무효 처리 — 대기는 풀기, 반영은 역분개(원 전표는 남는다). 지우지 않는다.
 * 4510 원재료비 줄도 그대로 넣는다 — 0075 월별 손익(재고 반영)은 장부 원재료비를 교체하므로 두 번 들어가지 않는다.
 * 문: 장부 쓰기(canKeepBooks) · 스위치 'ledger_post'(기본 대표만) — 꺼지면 404.
 */
export default async function LedgerPostPage(props: PageProps<'/finance/[business_id]/ledger-post'>) {
  const { business_id } = await props.params
  const sp = await props.searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const [repo, user] = await Promise.all([getRepository(), currentUser()])
  const business = (await repo.listBusinesses()).find((b) => b.business_id === business_id)
  if (!business || !user || !canKeepBooks(user, business_id)) notFound()
  if (!(await featureOn(user, 'ledger_post', business_id))) notFound()
  const today = kstToday()
  const raw = one(sp.period) ?? ''
  const prev = new Date(`${today.slice(0, 7)}-01T00:00:00Z`)
  prev.setUTCMonth(prev.getUTCMonth() - 1)
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : prev.toISOString().slice(0, 7)

  let rows: LedgerQueueRow[] = []
  let error: string | null = null
  try {
    rows = await repo.ledgerPostQueue(business_id, period)
  } catch (e) {
    console.error('[ledger-post] queue', e instanceof Error ? e.message : String(e))
    error = ledgerPostError(e)
  }
  const free = rows.filter((r) => r.post_id === null)
  const posts = [...new Map(rows.filter((r) => r.post_id).map((r) => [r.post_id!, r])).values()]
  const closed = rows.some((r) => r.closed_month)
  const stage = stageLedgerPost.bind(null, business_id)
  const decide = decideLedgerPost.bind(null, business_id)
  const won = (n: number | null) => (n === null ? '' : n.toLocaleString('ko-KR'))
  const field = 'rounded-md border border-line bg-panel px-2 py-1'
  const msg = one(sp.msg)
  const err = one(sp.err)
  const groupKo = (g: LedgerQueueRow['group_status']) => (g === 'same' ? '같은 거래(함께 반영)' : g === 'suspect' ? '중복 의심 — 먼저 정하기' : g === 'rejected' ? '다른 거래' : '')

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 px-4 py-5 sm:px-6">
      <PageHeader
        icon="grid"
        title={`${business.name} 원장 → 장부 반영`}
        code="FIN-L1"
        description="계정별 원장 줄을 반영 대기에 넣고, 확인한 뒤 장부 전표로 반영합니다. 되돌리기는 무효 처리(역분개)입니다."
      />
      <form method="get" className="flex flex-wrap items-end gap-2 text-t12">
        <label className="flex flex-col gap-1">
          <span className="text-ink-muted">달</span>
          <input type="month" name="period" defaultValue={period} className={field} />
        </label>
        <button type="submit" className="min-h-11 rounded-md border border-line bg-panel px-3 hover:border-accent lg:min-h-0 lg:py-1">
          보기
        </button>
        <Link href={`/finance/${business_id}/upload`} className="text-accent hover:underline">
          자료 올리기
        </Link>
        <Link href={`/finance/${business_id}/journal`} className="text-accent hover:underline">
          전표
        </Link>
      </form>
      {msg ? <p className="rounded-md border border-line-soft bg-panel px-3 py-2 text-t12">{msg}</p> : null}
      {err ? <p className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-t12 text-danger">{err}</p> : null}
      {error ? <p className="text-t12 text-danger">{error}</p> : null}
      {closed ? <p className="text-t12 text-warn">마감된 달입니다 — 대표 · 그룹 CFO만 이유를 적고 반영할 수 있고, 전표 날짜는 열린 달로 고릅니다.</p> : null}

      <section className="space-y-2">
        <h2 className="text-t13 font-semibold">반영 대기 전 ({free.length}줄)</h2>
        {free.length === 0 ? <p className="text-t12 text-ink-muted">남은 원장 줄이 없습니다.</p> : null}
        {free.length > 0 ? (
          <form action={stage} className="space-y-2 text-t12">
            <input type="hidden" name="period" value={period} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left">
                <thead className="text-ink-muted">
                  <tr>
                    <th className="p-1">고르기</th>
                    <th className="p-1">일자</th>
                    <th className="p-1">계정</th>
                    <th className="p-1">거래처 · 적요</th>
                    <th className="p-1 text-right">차변</th>
                    <th className="p-1 text-right">대변</th>
                    <th className="p-1">같은 거래</th>
                  </tr>
                </thead>
                <tbody>
                  {free.map((r) => (
                    <tr key={r.line_id} className="border-t border-line-soft">
                      <td className="p-1">
                        <input type="checkbox" name="line" value={r.line_id} disabled={r.group_status === 'suspect'} aria-label={`줄 ${r.line_id}`} />
                      </td>
                      <td className="p-1">{r.tx_date ?? '—'}</td>
                      <td className="p-1">
                        {r.account_code} {r.account_name}
                      </td>
                      <td className="p-1">
                        {r.counterparty ?? ''} {r.memo ?? ''}
                      </td>
                      <td className="p-1 text-right">{won(r.debit)}</td>
                      <td className="p-1 text-right">{won(r.credit)}</td>
                      <td className="p-1 text-ink-dim">{groupKo(r.group_status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-ink-muted">상대 계정(차대가 안 맞을 때)</span>
                <input name="counter" maxLength={40} placeholder="예: 2010" className={field} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-ink-muted">전표 날짜(비우면 원장 일자)</span>
                <input type="date" name="entry_date" className={field} />
              </label>
              <label className="flex min-w-[220px] flex-1 flex-col gap-1">
                <span className="text-ink-muted">이유(마감 달은 꼭)</span>
                <input name="reason" maxLength={300} className={field} />
              </label>
              <button type="submit" className="min-h-11 rounded-md border border-line bg-panel px-3 hover:border-accent lg:min-h-0 lg:py-1">
                반영 대기에 넣기
              </button>
            </div>
          </form>
        ) : null}
      </section>

      <section className="space-y-2">
        <h2 className="text-t13 font-semibold">반영 대기 · 반영됨 ({posts.length}건)</h2>
        <ul className="space-y-2">
          {posts.map((p) => {
            const lines = rows.filter((r) => r.post_id === p.post_id)
            return (
              <li key={p.post_id} className="rounded-lg border border-line bg-panel p-3 text-t12">
                <div className="flex flex-wrap gap-x-3">
                  <span className="font-semibold">{p.post_status === 'posted' ? `반영됨 · 전표 ${p.slip_no}` : '반영 대기'}</span>
                  <span className="text-ink-muted">
                    {lines.length}줄 · 차변 {won(lines.reduce((t, r) => t + (r.debit ?? 0), 0))} · 대변 {won(lines.reduce((t, r) => t + (r.credit ?? 0), 0))}
                  </span>
                </div>
                <form action={decide} className="mt-2 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="period" value={period} />
                  <input type="hidden" name="post" value={p.post_id!} />
                  <select name="what" defaultValue={p.post_status === 'pending' ? 'apply' : 'void'} className={field}>
                    {p.post_status === 'pending' ? <option value="apply">장부에 반영</option> : null}
                    <option value="void">{p.post_status === 'posted' ? '무효 처리(역분개)' : '대기 풀기'}</option>
                  </select>
                  <input name="reason" maxLength={300} placeholder="이유(무효 · 마감 달은 꼭)" className={`${field} min-w-[220px] flex-1`} />
                  <button type="submit" className="min-h-11 rounded-md border border-line bg-panel px-3 hover:border-accent lg:min-h-0 lg:py-1">
                    정하기
                  </button>
                </form>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
