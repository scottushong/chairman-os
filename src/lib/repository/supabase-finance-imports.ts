import type { SupabaseClient } from '@supabase/supabase-js'

import type { FinanceImport, FinanceImportKind, FinanceImportPreviewPatch } from '@/types'

import type { AuditActor, ChairmanRepository, EcountMonthlyResult, FinanceImportSlip } from './types'

/**
 * 0050 finance_imports(ECOUNT 엑셀 업로드 한 건)의 live 어댑터 조각. supabase.ts가 펼쳐 넣는다.
 *
 * 권한은 보지 않는다 — 0050 RLS가 본다: 읽기 can_read_books · 넣기 can_keep_books 본인 draft ·
 * 고치기 만든 사람의 draft. 믿지 않는 칸(created_by · 시각)은 finance_imports_guard 트리거가 적는다.
 *
 * **읽기는 0050이 없는 DB를 견딘다**(supabase-attachments.ts와 같은 이유 — master push가 production 앱을
 * DB보다 먼저 내보낸다). 표가 없다는 오류(PGRST205 · 42P01)만 빈 값으로 삼키고 나머지는 던진다.
 * 쓰기는 견디지 않는다 — 표 없이 «만들었다»고 말하면 거짓말이다.
 *
 * 상태 전이는 늘 `status = 'draft'` 조건을 같이 건다 — 끝난 업로드를 건드리는 길이 앱에 없게(트리거가 한 번 더 막는다).
 * **committed는 여기서 못 만든다**(0051 — 사람의 update with check가 draft · cancelled뿐). 등록은 대상별 RPC 한 번이다:
 *   계정과목 ecount_accounts_import · 연간 official_statement_import_ecount · 월별 ecount_monthly_import(0052).
 *   판정 · 감사 · committed가 그 안에서 한 트랜잭션이다.
 */

const COLUMNS =
  'import_id,business_id,kind,period_key,status,file_name,file_sha256,summary,created_by,created_at,updated_at,committed_at,cancelled_at'

const MISSING = new Set(['PGRST205', '42P01'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Err = { code?: string; message: string } | null

function missing(where: string, error: Err): boolean {
  if (error && MISSING.has(error.code ?? '')) {
    console.warn(`[${where}] finance_imports가 없다(${error.code}) — 0050 적용 전. 업로드 없음으로 그린다.`)
    return true
  }
  return false
}

function fail(error: NonNullable<Err>): never {
  throw new Error(`Supabase finance_imports ${error.code ?? '?'}: ${error.message}`)
}

type Methods = Pick<
  ChairmanRepository,
  | 'createFinanceImport'
  | 'getFinanceImport'
  | 'listFinanceImports'
  | 'recordFinanceImportPreview'
  | 'cancelFinanceImport'
  | 'findLatestFinanceImportMapping'
  | 'registerEcountAccounts'
  | 'registerEcountAnnual'
  | 'registerEcountMonthly'
  | 'listFinanceImportSlips'
>

/** RPC 오류를 거부 낱말(message)이 보이게 던진다 — 액션이 lib/ecount/import-errors.ts로 문장을 고른다. */
function rpcFail(fn: string, error: { code?: string; message: string; details?: string | null }): never {
  throw new Error(`Supabase ${fn} ${error.code ?? '?'}: ${error.message}${error.details ? ` — ${error.details}` : ''}`)
}

export function financeImportMethods(sb: SupabaseClient): Methods {
  /** draft 한 줄을 고친다. 0줄이면(남의 것 · 끝난 것 · 안 보임) 던진다 — 조용히 넘어가면 «취소했다»가 거짓이 된다. */
  async function updateDraft(importId: string, patch: Record<string, unknown>): Promise<FinanceImport> {
    if (!UUID.test(importId)) throw new Error('finance_import_not_found')
    const { data, error } = await sb
      .from('finance_imports')
      .update(patch)
      .eq('import_id', importId)
      .eq('status', 'draft')
      .select(COLUMNS)
    if (error) fail(error)
    const row = (data ?? [])[0]
    if (!row) throw new Error('finance_import_closed: 진행 중인 본인 업로드가 아니다(없거나 · 끝났거나 · 남의 것)')
    return row as unknown as FinanceImport
  }

  return {
    async createFinanceImport(input, actor: AuditActor): Promise<FinanceImport> {
      // created_by · status · 시각은 DB가 정한다(기본값 + 트리거). 보내지 않는다.
      void actor
      const { data, error } = await sb
        .from('finance_imports')
        .insert({ business_id: input.business_id, kind: input.kind, file_name: input.file_name })
        .select(COLUMNS)
        .single()
      if (error) fail(error)
      return data as unknown as FinanceImport
    },

    async getFinanceImport(importId: string): Promise<FinanceImport | null> {
      if (!UUID.test(importId)) return null
      const { data, error } = await sb.from('finance_imports').select(COLUMNS).eq('import_id', importId).maybeSingle()
      if (error) {
        if (missing('getFinanceImport', error)) return null
        fail(error)
      }
      return (data as unknown as FinanceImport | null) ?? null
    },

    async listFinanceImports(businessId: string, status?: FinanceImport['status']): Promise<FinanceImport[]> {
      let q = sb
        .from('finance_imports')
        .select(COLUMNS)
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
        .limit(100)
      if (status) q = q.eq('status', status)
      const { data, error } = await q
      if (error) {
        if (missing('listFinanceImports', error)) return []
        fail(error)
      }
      return (data ?? []) as unknown as FinanceImport[]
    },

    async recordFinanceImportPreview(importId: string, patch: FinanceImportPreviewPatch, actor: AuditActor): Promise<FinanceImport> {
      void actor
      const row: Record<string, unknown> = { file_sha256: patch.file_sha256, summary: patch.summary }
      if (patch.period_key !== undefined) row.period_key = patch.period_key
      return updateDraft(importId, row)
    },

    /** summary->mapping이 있는 가장 최근 업로드 한 줄. 0050 전 DB면 null(열 지정을 다시 쓰지 못할 뿐이다). */
    async findLatestFinanceImportMapping(businessId: string, kind: FinanceImportKind, exceptImportId: string): Promise<FinanceImport | null> {
      let q = sb
        .from('finance_imports')
        .select(COLUMNS)
        .eq('business_id', businessId)
        .eq('kind', kind)
        .neq('status', 'cancelled')
        .not('summary->mapping', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
      if (UUID.test(exceptImportId)) q = q.neq('import_id', exceptImportId)
      const { data, error } = await q
      if (error) {
        if (missing('findLatestFinanceImportMapping', error)) return null
        fail(error)
      }
      return ((data ?? [])[0] as unknown as FinanceImport | undefined) ?? null
    },

    /** 0051 ecount_accounts_import — 한 트랜잭션(감사 → 새 코드 → 이름 → committed). 행위자는 DB가 auth.uid()로 적는다. */
    async registerEcountAccounts(importId, input, actor: AuditActor) {
      void actor
      const { data, error } = await sb.rpc('ecount_accounts_import', {
        p_import_id: importId,
        p_file_sha256: input.file_sha256,
        p_creates: input.creates.map((c) => ({
          account_code: c.account_code,
          name: c.name,
          category: c.category,
          section: c.section,
          cash_flow: c.cash_flow,
          active: c.active,
        })),
        p_renames: input.renames.map((r) => ({ account_code: r.account_code, from: r.from, to: r.to })),
      })
      if (error) rpcFail('ecount_accounts_import', error)
      const r = (data ?? {}) as { added?: unknown; renamed?: unknown }
      if (typeof r.added !== 'number' || typeof r.renamed !== 'number') throw new Error('ecount_accounts_import: 결과가 오지 않았다.')
      return { added: r.added, renamed: r.renamed }
    },

    /** 0051 official_statement_import_ecount — 한 트랜잭션(확정 해 · 균형 · supersede · 감사 · 헤더 · 줄 · committed). */
    async registerEcountAnnual(importId, input, actor: AuditActor) {
      void actor
      const { data, error } = await sb.rpc('official_statement_import_ecount', {
        p_import_id: importId,
        p_file_sha256: input.file_sha256,
        p_period_key: input.period_key,
        p_lines: input.lines.map((l) => ({ account_code: l.account_code, amount: l.amount })),
      })
      if (error) rpcFail('official_statement_import_ecount', error)
      const id = Number(data)
      if (!Number.isFinite(id)) throw new Error('official_statement_import_ecount: id가 오지 않았다.')
      return id
    },

    /** 0052/0056 ecount_monthly_import — 한 트랜잭션(마감 · 확정 달 · 손익만 · 달마다 전표 + 대응 · 재업로드는 정정 전표 · 금액 없는 달은 역분개 · committed). */
    async registerEcountMonthly(importId, input, actor: AuditActor): Promise<EcountMonthlyResult> {
      void actor
      const { data, error } = await sb.rpc('ecount_monthly_import', {
        p_import_id: importId,
        p_file_sha256: input.file_sha256,
        p_period_key: input.period_key,
        p_basis: input.basis,
        p_months: input.months.map((m) => ({ month: m.month, lines: m.lines.map((l) => ({ account_code: l.account_code, amount: l.amount })) })),
      })
      if (error) rpcFail('ecount_monthly_import', error)
      const r = (data ?? {}) as Partial<EcountMonthlyResult>
      if (typeof r.posted !== 'number' || typeof r.corrected !== 'number' || typeof r.unchanged !== 'number' || !Array.isArray(r.months)) {
        throw new Error('ecount_monthly_import: 결과가 오지 않았다.')
      }
      // 0056 전 DB(0052)는 reversed를 주지 않는다 — 그 DB는 빈 달을 ecount_plan_invalid로 거부하므로 0이 맞다.
      return { posted: r.posted, corrected: r.corrected, unchanged: r.unchanged, reversed: typeof r.reversed === 'number' ? r.reversed : 0, months: r.months }
    },

    /** 0050 finance_import_slips — 회사의 업로드 전표 줄 전부. 0050 전 DB면 빈 목록(꼬리표가 «자체»로 남을 뿐이다). */
    async listFinanceImportSlips(businessId: string): Promise<FinanceImportSlip[]> {
      const { data, error } = await sb
        .from('finance_import_slips')
        .select('business_id,month,slip_no,import_id,superseded_at')
        .eq('business_id', businessId)
        .order('month')
        .limit(5000)
      if (error) {
        if (missing('listFinanceImportSlips', error)) return []
        fail(error)
      }
      return (data ?? []) as unknown as FinanceImportSlip[]
    },

    async cancelFinanceImport(importId: string, actor: AuditActor): Promise<FinanceImport> {
      void actor
      return updateDraft(importId, { status: 'cancelled' })
    },
  }
}
