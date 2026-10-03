import type { SupabaseClient } from '@supabase/supabase-js'

import type { FinanceImport, FinanceImportKind, FinanceImportPreviewPatch } from '@/types'

import type { AuditActor, ChairmanRepository } from './types'

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
  | 'commitFinanceImport'
>

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

    /** draft → committed. committed_at은 finance_imports_guard가 적는다 · commit_shape는 DB가 본다. */
    async commitFinanceImport(importId: string, summary: Record<string, unknown>, actor: AuditActor): Promise<FinanceImport> {
      void actor
      return updateDraft(importId, { status: 'committed', summary })
    },

    async cancelFinanceImport(importId: string, actor: AuditActor): Promise<FinanceImport> {
      void actor
      return updateDraft(importId, { status: 'cancelled' })
    },
  }
}
