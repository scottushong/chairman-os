import type { SupabaseClient } from '@supabase/supabase-js'

import { kstDate } from '@/lib/ai/night-brief'
import { signInServiceAccount } from '@/lib/supabase/service-account'
import type { Closing, JournalLine, PeriodKey } from '@/types'

import { ecountSetup } from './config'
import { defaultWindow, ingestCompany, type IngestedLedger } from './ingest'
import { EcountUnsupportedError } from './types'

/**
 * ECOUNT 동기화 Job (Phase 2-A, CH-052).
 *
 * 부르는 곳
 *   /api/cron/night-brief GET   Vercel Hobby는 Cron이 하루 1개라, 야간 브리핑 Cron이 이걸 먼저 돌린다.
 *                               브리핑이 방금 가져온 원장으로 요약하게 된다.
 *   /api/cron/ecount-sync       단독 입구. CRON_SECRET(외부 스케줄러) 또는 회장 세션(수동).
 *   요구는 1시간 주기였지만 Hobby에서는 불가능하다 → DEFERRED D-20.
 *
 * mock일 때 DB에 **쓰지 않는다.** 가져오고 바꾸는 데까지(검증)만 하고 멈춘다.
 * live DB에 mock 전표가 들어가면 대시보드가 '잠정' 꼬리표를 단 가짜 숫자를 실적처럼 보여 준다 —
 * 그건 DUMMY DATA 뱃지 없이 시드 숫자를 띄우는 것과 같은 사고다(HANDOVER 5절).
 *
 * real일 때는 Integration 계정으로 로그인해서 RLS 안에서 쓴다(0015). service_role은 없다.
 *
 * night-brief와 같은 세 가지를 지킨다 — 던지지 않는다 / 회사 하나가 실패해도 다음 회사로 간다 /
 * 회사마다 바로 쓴다. 그리고 하나 더: **마감된 달은 건드리지 않는다.** 0015의 정책이 막기도 하지만,
 * 막히기 전에 보내지 않는다. 거부된 쓰기가 보고서를 오류로 채우면 진짜 오류가 묻힌다.
 */

export type EcountSyncTrigger = 'cron' | 'night-brief' | 'manual'

export interface EcountSyncReport {
  ok: boolean
  mode: 'mock' | 'real'
  /** DB에 썼나. mock이면 늘 false */
  wrote: boolean
  window: { from: PeriodKey; to: PeriodKey }
  companies: {
    business_id: string
    status: 'done' | 'failed' | 'unsupported' | 'dry-run'
    accounts?: number
    journal?: number
    closings?: number
    /** 이번에 새로 들어온 마감 칸(provisional_amount를 찍은 칸) */
    new_closings?: number
    removed_lines?: number
    last_closed_period?: PeriodKey | null
    error?: string
  }[]
  error?: string
}

const BATCH = 500

function errorText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 500)
}

async function inBatches<T>(rows: T[], fn: (chunk: T[]) => PromiseLike<{ error: { code?: string; message: string } | null }>, label: string) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await fn(rows.slice(i, i + BATCH))
    if (error) throw new Error(`${label} ${error.code ?? '?'}: ${error.message}`)
  }
}

/**
 * 끝까지 읽는다. PostgREST는 한 번에 1000행 남짓만 준다 — 잘린 목록으로 '이미 있는 마감'을 판정하면
 * 있는 칸을 새 칸으로 보고 INSERT하다 충돌하고, '없어진 전표'를 판정하면 지울 줄을 놓친다.
 */
async function readAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code?: string; message: string } | null }>,
  label: string,
): Promise<T[]> {
  const out: T[] = []
  for (;;) {
    const { data, error } = await page(out.length, out.length + BATCH - 1)
    if (error) throw new Error(`${label} ${error.code ?? '?'}: ${error.message}`)
    out.push(...(data ?? []))
    if (!data || data.length < BATCH) return out
  }
}

/** 회사 하나를 DB에 맞춘다. 순서: 계정 → 마감 → 전표. 전표와 마감이 계정을 FK로 문다. */
async function writeCompany(sb: SupabaseClient, ledger: IngestedLedger, window: { from: PeriodKey; to: PeriodKey }) {
  const id = ledger.business_id

  await inBatches(ledger.accounts, (chunk) => sb.from('accounts').upsert(chunk, { onConflict: 'business_id,account_code' }), 'accounts')

  // 마감: 이미 확정된 칸은 보내지 않는다. 가마감은 갱신하되 provisional_amount는 처음 찍은 값을 지킨다.
  const existing = await readAllPages(
    (from, to) =>
      sb
        .from('closings')
        .select('period,account_code,closed')
        .eq('business_id', id)
        .gte('period', window.from)
        .lte('period', window.to)
        .order('period')
        .order('account_code')
        .range(from, to)
        .returns<{ period: string; account_code: string; closed: boolean }[]>(),
    'closings read',
  )
  const known = new Map(existing.map((c) => [`${c.period}|${c.account_code}`, c.closed]))

  const fresh: Closing[] = []
  // 갱신 행에는 provisional_amount 키 자체가 없어야 한다. 값만 undefined로 두면 bulk upsert의 columns에
  // 그 키가 실려 NULL로 덮일 수 있다. 처음 마감을 본 순간 찍은 잠정치는 지킨다.
  const reopenable: Omit<Closing, 'provisional_amount'>[] = []
  for (const c of ledger.closings) {
    const k = `${c.period}|${c.account_code}`
    if (!known.has(k)) fresh.push(c)
    else if (known.get(k) === false) {
      reopenable.push(
        Object.fromEntries(Object.entries(c).filter(([key]) => key !== 'provisional_amount')) as Omit<
          Closing,
          'provisional_amount'
        >,
      )
    }
  }
  await inBatches(fresh, (chunk) => sb.from('closings').insert(chunk), 'closings insert')
  await inBatches(reopenable, (chunk) => sb.from('closings').upsert(chunk, { onConflict: 'business_id,period,account_code' }), 'closings update')

  // 전표: 마감된 달의 전표는 보내지 않는다. 열린 달은 ECOUNT에 없어진 라인을 지운다(전표 삭제·수정 반영).
  const closedInDb = new Set(existing.filter((c) => c.closed).map((c) => c.period))
  const open = ledger.journal.filter((j) => !closedInDb.has(j.entry_date.slice(0, 7)))
  await inBatches(open, (chunk) => sb.from('journal_lines').upsert(chunk, { onConflict: 'business_id,slip_no,line_no' }), 'journal_lines')

  const fetched = new Set(open.map((j: JournalLine) => `${j.slip_no}|${j.line_no}`))
  const stale = await readAllPages(
    (from, to) =>
      sb
        .from('journal_lines')
        .select('id,slip_no,line_no')
        .eq('business_id', id)
        .eq('closed', false)
        .gte('entry_date', `${window.from}-01`)
        .order('id')
        .range(from, to)
        .returns<{ id: number; slip_no: string; line_no: number }[]>(),
    'journal_lines read',
  )
  const remove = stale.filter((r) => !fetched.has(`${r.slip_no}|${r.line_no}`)).map((r) => r.id)
  await inBatches(remove, (chunk) => sb.from('journal_lines').delete().in('id', chunk), 'journal_lines delete')

  return { new_closings: fresh.length, removed_lines: remove.length }
}

export async function runEcountSync(opts: {
  trigger: EcountSyncTrigger
  requestedBy?: string
  now?: Date
}): Promise<EcountSyncReport> {
  const now = opts.now ?? new Date()
  const window = defaultWindow(kstDate(now).slice(0, 7))
  const fetchedAt = now.toISOString()

  let setup: ReturnType<typeof ecountSetup>
  try {
    setup = ecountSetup()
  } catch (e) {
    return { ok: false, mode: 'real', wrote: false, window, companies: [], error: errorText(e) }
  }

  const report: EcountSyncReport = { ok: false, mode: setup.source.mode, wrote: false, window, companies: [] }

  if (setup.source.mode === 'mock') {
    for (const c of setup.companies) {
      try {
        const l = await ingestCompany(setup.source, c, window, fetchedAt)
        report.companies.push({
          business_id: c.business_id, status: 'dry-run',
          accounts: l.accounts.length, journal: l.journal.length, closings: l.closings.length,
          last_closed_period: l.last_closed_period,
        })
      } catch (e) {
        report.companies.push({ business_id: c.business_id, status: 'failed', error: errorText(e) })
      }
    }
    report.ok = report.companies.every((c) => c.status === 'dry-run')
    report.error = 'mock — ECOUNT_COMPANIES가 없어 DB에 쓰지 않았다. 변환만 검증했다.'
    return report
  }

  let sb: SupabaseClient
  let userId: string
  try {
    ;({ sb, userId } = await signInServiceAccount({
      emailEnv: 'ECOUNT_SYNC_EMAIL',
      passwordEnv: 'ECOUNT_SYNC_PASSWORD',
      role: 'Integration',
    }))
  } catch (e) {
    report.error = errorText(e)
    console.error('[ecount-sync] sign-in', report.error)
    return report
  }

  try {
    for (const c of setup.companies) {
      try {
        const l = await ingestCompany(setup.source, c, window, fetchedAt)
        const written = await writeCompany(sb, l, window)
        report.wrote = true
        report.companies.push({
          business_id: c.business_id, status: 'done',
          accounts: l.accounts.length, journal: l.journal.length, closings: l.closings.length,
          last_closed_period: l.last_closed_period, ...written,
        })
      } catch (e) {
        const status = e instanceof EcountUnsupportedError ? 'unsupported' : 'failed'
        console.error('[ecount-sync] company', c.business_id, errorText(e))
        report.companies.push({ business_id: c.business_id, status, error: errorText(e) })
      }
    }
    report.ok = report.companies.every((c) => c.status === 'done')

    const { error: auditError } = await sb.from('audit_log').insert({
      actor_user_id: userId,
      actor_role: 'Integration',
      action: 'ecount_sync_completed',
      entity_table: 'journal_lines',
      entity_id: fetchedAt,
      after: { trigger: opts.trigger, window, companies: report.companies },
      note: `ECOUNT 동기화 ${opts.trigger}${opts.requestedBy ? ` (요청: ${opts.requestedBy})` : ''} — ${
        report.companies.filter((c) => c.status === 'done').length
      }/${report.companies.length}`,
    })
    if (auditError) {
      report.ok = false
      report.error = `audit_log 기록 실패: ${auditError.message}`
    }
  } finally {
    await sb.auth.signOut().catch(() => {})
  }
  return report
}
