import type { SupabaseClient } from '@supabase/supabase-js'

import type { ProcessChartItem, ProcessChartSync } from '@/types'

import type { ProcessSyncMethods } from './types'

/**
 * 0071 프로세스 차트 동기화의 live 읽기. 누가 무엇을 보는지는 0071 정책(can_read_process_chart)이 정한다 —
 * 여기서 다시 거르지 않는다. 0071 전 DB(표 없음)면 빈 목록 — master가 마이그레이션보다 먼저 배포돼도 화면이 서게.
 */
const MISSING = new Set(['42P01', '42703', 'PGRST205', 'PGRST204'])

export function processSyncMethods(sb: SupabaseClient): ProcessSyncMethods {
  return {
    async listProcessChartItems() {
      const { data, error } = await sb
        .from('process_chart_items')
        .select('id,business_id,team_name,chart_id,sheet_row_id,stage,title,assignee_email,owner_user_id,start_on,due_on,status,note,task_id,gone_at,last_synced_at')
        .order('business_id')
        .order('team_name')
        .order('sheet_row_id')
        .limit(5000)
        .returns<ProcessChartItem[]>()
      if (error) {
        if (MISSING.has(error.code ?? '')) return []
        throw new Error(`Supabase process_chart_items ${error.code ?? '?'}: ${error.message}`)
      }
      return data ?? []
    },

    async listProcessChartSyncs(limit = 50) {
      const { data, error } = await sb
        .from('process_chart_syncs')
        .select('id,business_id,team_name,chart_id,synced_at,actor_user_id,trigger,ok,error,read_count,new_count,changed_count,gone_count,skipped_count,warnings')
        .order('synced_at', { ascending: false })
        .limit(Math.max(1, Math.min(limit, 500)))
        .returns<ProcessChartSync[]>()
      if (error) {
        if (MISSING.has(error.code ?? '')) return []
        throw new Error(`Supabase process_chart_syncs ${error.code ?? '?'}: ${error.message}`)
      }
      return (data ?? []).map((s) => ({ ...s, warnings: Array.isArray(s.warnings) ? s.warnings : [] }))
    },
  }
}
