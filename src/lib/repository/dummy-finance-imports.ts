import { FINANCE_IMPORT_KIND, type FinanceImport, type FinanceImportPreviewPatch } from '@/types'

import { dummyCanKeepBooks, dummyCanReadBooks } from './dummy-books'
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

type Methods = Pick<
  ChairmanRepository,
  | 'createFinanceImport'
  | 'getFinanceImport'
  | 'listFinanceImports'
  | 'recordFinanceImportPreview'
  | 'cancelFinanceImport'
  | 'findLatestFinanceImportMapping'
  | 'commitFinanceImport'
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

  /** 0050 — 만든 사람의 draft에서만 · commit_shape(sha256 · 계정과목 아니면 period_key). */
  async commitFinanceImport(importId, summary, actor: AuditActor) {
    void actor
    const row = ownDraft(importId)
    if (!row.file_sha256 || (row.kind !== 'accounts' && !row.period_key)) throw new Error('finance_imports_commit_shape')
    const now = new Date().toISOString()
    row.status = 'committed'
    row.summary = { ...summary }
    row.committed_at = now
    row.updated_at = now
    return { ...row }
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
