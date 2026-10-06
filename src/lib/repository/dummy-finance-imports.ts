import { ecountAuditNote } from '@/lib/ecount/excel/file-rules'
import { ECOUNT_CODE_BUSINESSES } from '@/lib/ledger/standard-chart'
import { FINANCE_IMPORT_KIND, type FinanceImport, type FinanceImportPreviewPatch } from '@/types'

import { dummyFinanceImportOriginals } from './dummy-attachments'
import {
  dummyApplyEcountAccounts,
  dummyCanKeepBooks,
  dummyCanReadBooks,
  dummyImportEcountAnnual,
  dummyImportEcountMonthly,
  dummyImportSlips,
} from './dummy-books'
import { dummyViewer } from './dummy-org'
import type { AuditActor, ChairmanRepository } from './types'

/**
 * 0050 finance_imports(ECOUNT 엑셀 업로드 한 건)의 dummy 자리. 메모리에만 산다(서버를 다시 켜면 사라진다).
 *
 * **DB가 막는 것을 여기서도 막는다**(dummy-attachments.ts와 같은 원칙):
 *   읽기   can_read_books(회사)
 *   넣기   can_keep_books(회사) · 본인 · draft — AIAgent · Integration은 못 넣는다
 *   고치기 만든 사람의 draft에서만 · sha256은 한 번 적히면 못 바꾼다(finance_imports_guard)
 *   지우기 없음
 *
 * 저장소를 globalThis에 둔다 — dev 서버가 모듈을 다시 읽어도(HMR · 서버 액션 번들) 업로드가 남게.
 */

interface Store {
  rows: FinanceImport[]
}

const g = globalThis as unknown as { __chairmanDummyFinanceImports?: Store }
const store: Store = (g.__chairmanDummyFinanceImports ??= { rows: [] })

const NO_WRITE = new Set(['AIAgent', 'Integration'])
const SHA256 = /^[0-9a-f]{64}$/

function visible(row: FinanceImport): boolean {
  const viewer = dummyViewer()
  return !viewer.revoked_at && viewer.role !== 'Integration' && dummyCanReadBooks(row.business_id)
}

/** 0050 finance_imports_update — 만든 사람의 draft + 그 회사 장부 권한. 아니면 RLS 거부와 같은 낱말로 던진다. */
function ownDraft(importId: string): FinanceImport {
  const viewer = dummyViewer()
  const row = store.rows.find((r) => r.import_id === importId)
  if (!row || !visible(row) || NO_WRITE.has(viewer.role)) throw new Error('finance_import_closed: 업로드가 없거나 볼 수 없다')
  if (row.status !== 'draft') throw new Error(`finance_import_closed: 업로드 ${row.import_id}는 이미 ${row.status}다`)
  if (row.created_by !== viewer.user_id || !dummyCanKeepBooks(row.business_id)) {
    throw new Error('finance_import_closed: 진행 중인 본인 업로드가 아니다(row-level security)')
  }
  return row
}

/** 첨부 대상 판정(dummy.ts) — 0050 attachment_entity_visible의 finance_imports 줄. */
export function dummyFinanceImportEntity(importId: string): { visible: boolean; business_id: string | null } {
  const row = store.rows.find((r) => r.import_id === importId)
  return row && visible(row) ? { visible: true, business_id: row.business_id } : { visible: false, business_id: row?.business_id ?? null }
}

/** 0050 finance_import_is_draft — 원본 첨부의 삭제 · 객체 올리기를 «draft일 때만»으로 좁힌다. */
export function dummyFinanceImportIsDraft(importId: string): boolean {
  return store.rows.some((r) => r.import_id === importId && r.status === 'draft')
}

/** 0050 attachments_finance_import_owner — 업로드 원본은 그 draft를 만든 본인만 올린다. */
export function dummyFinanceImportOwnedDraft(importId: string, userId: string): boolean {
  return store.rows.some((r) => r.import_id === importId && r.status === 'draft' && r.created_by === userId)
}

/**
 * 0051 finance_import_claim — 등록 RPC 둘이 같이 쓰는 판정. **순서와 낱말이 DB와 같다**(lib/ecount/import-errors.ts가
 * 같은 문장을 고른다): 사람 · 활성 → 없음(못 읽으면 없음) → 만든 사람 → 장부 쓰기 → ECOUNT 회사 → draft → 종류 → sha256.
 */
function claim(importId: string, kind: FinanceImport['kind'], sha: string): FinanceImport {
  const viewer = dummyViewer()
  if (viewer.revoked_at || NO_WRITE.has(viewer.role)) throw new Error('books_forbidden')
  const row = store.rows.find((r) => r.import_id === importId)
  if (!row || !dummyCanReadBooks(row.business_id)) throw new Error('finance_import_not_found')
  if (row.created_by !== viewer.user_id) throw new Error('finance_import_not_owner')
  if (!dummyCanKeepBooks(row.business_id)) throw new Error('books_forbidden')
  if (!ECOUNT_CODE_BUSINESSES.includes(row.business_id)) throw new Error('ecount_business_only')
  if (row.status !== 'draft') throw new Error(`finance_import_closed: 업로드 ${row.import_id}는 이미 ${row.status}다`)
  if (row.kind !== kind) throw new Error('finance_import_kind')
  if (!row.file_sha256 || typeof sha !== 'string' || row.file_sha256 !== sha.toLowerCase()) throw new Error('finance_import_hash_mismatch')
  return row
}

/** draft → committed. summary에 단계 · 결과를 더한다(0051 RPC와 같은 모양). */
function commit(row: FinanceImport, extra: Record<string, unknown>) {
  const now = new Date().toISOString()
  row.status = 'committed'
  row.summary = { ...(row.summary ?? {}), stage: 'committed', ...extra }
  row.committed_at = now
  row.updated_at = now
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

export const dummyFinanceImports: Methods = {
  async createFinanceImport(input, actor: AuditActor) {
    const viewer = dummyViewer()
    if (viewer.revoked_at || NO_WRITE.has(viewer.role) || !dummyCanKeepBooks(input.business_id)) {
      throw new Error('new row violates row-level security policy (0050 finance_imports_insert)')
    }
    if (!FINANCE_IMPORT_KIND.includes(input.kind)) throw new Error('finance_imports_kind_check')
    const file_name = input.file_name.trim()
    if (file_name.length < 1 || file_name.length > 255) throw new Error('finance_imports_file_name_check')
    const now = new Date().toISOString()
    const row: FinanceImport = {
      import_id: crypto.randomUUID(),
      business_id: input.business_id,
      kind: input.kind,
      period_key: null,
      status: 'draft',
      file_name,
      file_sha256: null,
      summary: null,
      created_by: viewer.user_id,
      created_at: now,
      updated_at: now,
      committed_at: null,
      cancelled_at: null,
    }
    store.rows.push(row)
    if (process.env.NODE_ENV !== 'production') console.warn(`[dummy] finance_import ${row.kind} ${row.business_id} by ${actor.role} — 메모리에만 남는다.`)
    return { ...row }
  },

  async getFinanceImport(importId) {
    const row = store.rows.find((r) => r.import_id === importId)
    return row && visible(row) ? { ...row } : null
  },

  async listFinanceImports(businessId, status) {
    return store.rows
      .filter((r) => r.business_id === businessId && visible(r) && (!status || r.status === status))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((r) => ({ ...r }))
  },

  async recordFinanceImportPreview(importId, patch: FinanceImportPreviewPatch, actor: AuditActor) {
    void actor
    const row = ownDraft(importId)
    if (!SHA256.test(patch.file_sha256)) throw new Error('finance_imports_file_sha256_check')
    if (row.file_sha256 && row.file_sha256 !== patch.file_sha256) throw new Error('finance_import_hash_immutable')
    row.file_sha256 = patch.file_sha256
    row.summary = { ...patch.summary }
    if (patch.period_key !== undefined) row.period_key = patch.period_key
    row.updated_at = new Date().toISOString()
    return { ...row }
  },

  async findLatestFinanceImportMapping(businessId, kind, exceptImportId) {
    const row = store.rows
      .filter(
        (r) =>
          r.business_id === businessId &&
          r.kind === kind &&
          r.import_id !== exceptImportId &&
          r.status !== 'cancelled' &&
          visible(r) &&
          !!r.summary &&
          typeof r.summary === 'object' &&
          r.summary.mapping != null,
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
    return row ? { ...row } : null
  },

  /** 0051 ecount_accounts_import — claim → 장부(확인 다 한 뒤 쓰기) → committed. 같은 거부 낱말. */
  async registerEcountAccounts(importId, input, actor: AuditActor) {
    const row = claim(importId, 'accounts', input.file_sha256)
    const note = ecountAuditNote({ kind: 'accounts', period: null, fileName: row.file_name, importId: row.import_id })
    const result = await dummyApplyEcountAccounts(row.business_id, { creates: input.creates, renames: input.renames }, actor, note)
    commit(row, { result })
    return result
  },

  /** 0051 official_statement_import_ecount — claim → 해 → 결산(확인 다 한 뒤 쓰기) → committed. */
  async registerEcountAnnual(importId, input, actor: AuditActor) {
    const row = claim(importId, 'annual', input.file_sha256)
    if (!row.period_key) throw new Error('finance_import_period')
    // 0051 리뷰 m-2 — 사람이 본 해와 업로드의 해가 다르면 멈춘다.
    if (input.period_key !== row.period_key) throw new Error('import_changed')
    const id = await dummyImportEcountAnnual(
      { business_id: row.business_id, period_key: row.period_key, import_id: row.import_id, file_name: row.file_name },
      input.lines,
      actor,
    )
    commit(row, { result: { statement_id: id, lines: input.lines.length } })
    return id
  },

  /** 0052 ecount_monthly_import — claim → 해 · 당월/누계 → 원본 → 장부(확인 다 한 뒤 쓰기) → committed. 같은 거부 낱말. */
  async registerEcountMonthly(importId, input, actor: AuditActor) {
    const row = claim(importId, 'monthly', input.file_sha256)
    if (!row.period_key) throw new Error('finance_import_period')
    if (input.period_key !== row.period_key) throw new Error('import_changed')
    const mapping = row.summary?.mapping as { basis?: unknown } | undefined
    if ((input.basis !== 'monthly' && input.basis !== 'ytd') || input.basis !== mapping?.basis) throw new Error('import_changed: 당월/누계')
    const originals = dummyFinanceImportOriginals(row.import_id)
    const o = originals[0]
    if (
      originals.length !== 1 || o.uploaded_by !== row.created_by || o.business_id !== row.business_id || !o.hasObject ||
      o.mime !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ) {
      throw new Error('ecount_original_missing')
    }
    const result = await dummyImportEcountMonthly(
      { business_id: row.business_id, period_key: row.period_key, import_id: row.import_id, file_name: row.file_name },
      input.months,
      actor,
    )
    commit(row, { result })
    return result
  },

  /** 0050 finance_import_slips_read — 그 회사 재무 읽기 권한자만(줄 없음 = 빈 목록). */
  async listFinanceImportSlips(businessId: string) {
    const viewer = dummyViewer()
    if (viewer.revoked_at || viewer.role === 'Integration' || !dummyCanReadBooks(businessId)) return []
    return dummyImportSlips(businessId)
  },

  async cancelFinanceImport(importId, actor: AuditActor) {
    void actor
    const row = ownDraft(importId)
    const now = new Date().toISOString()
    row.status = 'cancelled'
    row.cancelled_at = now
    row.updated_at = now
    return { ...row }
  },
}
