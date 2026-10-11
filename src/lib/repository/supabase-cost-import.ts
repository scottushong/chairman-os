import type { SupabaseClient } from '@supabase/supabase-js'

import type { CostImportMethods } from './types'

/**
 * 0068 원가 엔진 엑셀 넣기의 live 어댑터. 판정은 DB(cost_import_check · cost_import_apply — invoker라 대상 표의 RLS · 트리거가 문).
 * 오류는 message + hint('item N')만 던진다 — details(«Failing row contains …»)는 줄 값을 실을 수 있어 버린다(BOM 평문 노출 막기).
 */
const MISSING = new Set(['42P01', '42883', 'PGRST202', 'PGRST205'])

export function costImportMethods(sb: SupabaseClient): CostImportMethods {
  return {
    async costImportCheck(businessId, target, sha256) {
      const { data, error } = await sb.rpc('cost_import_check', { p_business: businessId, p_target: target, p_sha: sha256 })
      if (error) {
        if (MISSING.has(error.code ?? '')) return null
        throw new Error(`Supabase cost_import_check ${error.code ?? '?'}: ${error.message}`)
      }
      const row = (Array.isArray(data) ? data[0] : data) as { stamp?: string; seen?: boolean } | null
      return row?.stamp ? { stamp: row.stamp, seen: row.seen === true } : null
    },

    async applyCostImport(input) {
      const { data, error } = await sb.rpc('cost_import_apply', {
        p_business: input.businessId,
        p_target: input.target,
        p_file_name: input.fileName,
        p_sha: input.sha256,
        p_stamp: input.stamp,
        p_rows: input.rows,
        p_edits: input.edits,
        p_skipped: input.skipped,
      })
      if (error) throw new Error(`Supabase cost_import_apply ${error.code ?? '?'}: ${error.message}${error.hint ? ` (${error.hint})` : ''}`)
      const r = (data ?? {}) as { import_id?: string; inserted?: number; replaced?: number }
      return { importId: String(r.import_id ?? ''), inserted: Number(r.inserted ?? 0), replaced: Number(r.replaced ?? 0) }
    },
  }
}
