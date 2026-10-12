import type { SupabaseClient } from '@supabase/supabase-js'

import type {
  AiFeedback,
  AiFeedbackBundle,
  AiFeedbackMine,
  FeedbackExcludeReason,
  FeedbackTriage,
  PersonAccess,
} from '@/types'

import type { ChairmanRepository } from './types'

/**
 * 0069 AI 어시스턴트 보강(권한 · 조직 조회 · 보완 의견 · 보완함)의 live 어댑터 조각. supabase.ts가 펼쳐 넣는다.
 *
 * **0069가 없는 DB를 견딘다** — master push가 production 앱을 마이그레이션보다 먼저 내보낼 수 있다.
 *   · 함수가 없다(PGRST202 · 42883) / 표가 없다(PGRST205 · 42P01): 조회는 null(도구가 사용자 화면을 안내), 목록은 빈 목록.
 *   · 의견 남기기는 견디지 않는다 — 'ai_feedback_unavailable'을 던지고 화면이 «아직 준비 중»으로 말한다.
 * 판정은 전부 DB다(0069 머리 주석). 여기서 범위 · 원가 줄을 다시 자르지 않는다.
 */

const MISSING = new Set(['PGRST202', '42883', 'PGRST205', '42P01'])

type Err = { code?: string; message: string } | null

function fail(what: string, error: NonNullable<Err>): never {
  // 0069 오류 키(ai_feedback_*)는 문장 그대로 위로 — 화면이 키로 문장을 고른다.
  const key = /ai_feedback_[a-z_]+|org_access_[a-z_]+/.exec(error.message)?.[0]
  throw new Error(key ?? `Supabase ${what} ${error.code ?? '?'}: ${error.message}`)
}

type Methods = Pick<
  ChairmanRepository,
  | 'orgAccessLookup'
  | 'submitAiFeedback'
  | 'listMyAiFeedback'
  | 'cancelAiFeedback'
  | 'listAiFeedback'
  | 'listAiFeedbackBundles'
  | 'setAiFeedbackStatus'
  | 'setAiFeedbackBundleStatus'
  | 'saveAiFeedbackTriage'
  | 'saveAiFeedbackBundle'
>

const FEEDBACK_COLUMNS =
  'feedback_id,created_at,author_id,author_name,author_role,business_id,path,message_id,question,answer,body,ai_excluded,excluded_reasons,cancelled_at,status,triage,triaged_at,bundle_id'

function toFeedback(r: Record<string, unknown>): AiFeedback {
  return {
    ...(r as unknown as AiFeedback),
    message_id: Number(r.message_id),
    excluded_reasons: (Array.isArray(r.excluded_reasons) ? r.excluded_reasons : []) as FeedbackExcludeReason[],
    triage: (r.triage ?? null) as FeedbackTriage | null,
  }
}

export function feedbackMethods(sb: SupabaseClient): Methods {
  return {
    async orgAccessLookup(query) {
      const { data, error } = await sb.rpc('org_access_lookup', { p_query: query })
      if (error && MISSING.has(error.code ?? '')) return null
      if (error) fail('org_access_lookup', error)
      return (Array.isArray(data) ? data : []) as PersonAccess[]
    },

    async submitAiFeedback(input) {
      const { data, error } = await sb.rpc('ai_feedback_submit', {
        p_message_id: input.message_id,
        p_body: input.body,
        p_path: input.path,
        p_business: input.business_id,
        p_excluded: input.ai_excluded,
        p_reasons: input.excluded_reasons,
      })
      if (error && MISSING.has(error.code ?? '')) throw new Error('ai_feedback_unavailable')
      if (error) fail('ai_feedback_submit', error)
      return String(data)
    },

    async listMyAiFeedback() {
      const { data, error } = await sb.rpc('ai_feedback_mine')
      if (error && MISSING.has(error.code ?? '')) return []
      if (error) fail('ai_feedback_mine', error)
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({ ...(r as unknown as AiFeedbackMine), message_id: Number(r.message_id) }))
    },

    async cancelAiFeedback(feedbackId) {
      const { data, error } = await sb.rpc('ai_feedback_cancel', { p_id: feedbackId })
      if (error) fail('ai_feedback_cancel', error)
      return data === true
    },

    async listAiFeedback() {
      const { data, error } = await sb.from('ai_feedback').select(FEEDBACK_COLUMNS).order('created_at', { ascending: false }).limit(500)
      if (error && MISSING.has(error.code ?? '')) return []
      if (error) fail('ai_feedback', error)
      return ((data ?? []) as unknown as Record<string, unknown>[]).map(toFeedback)
    },

    async listAiFeedbackBundles() {
      const { data, error } = await sb
        .from('ai_feedback_bundles')
        .select('bundle_id,created_at,title,screen,feedback_ids,triage,status')
        .order('created_at', { ascending: false })
        .limit(200)
      if (error && MISSING.has(error.code ?? '')) return []
      if (error) fail('ai_feedback_bundles', error)
      return (data ?? []) as unknown as AiFeedbackBundle[]
    },

    async setAiFeedbackStatus(feedbackId, status) {
      const { data, error } = await sb.rpc('ai_feedback_set_status', { p_id: feedbackId, p_status: status })
      if (error) fail('ai_feedback_set_status', error)
      return data === true
    },

    async setAiFeedbackBundleStatus(bundleId, status) {
      const { data, error } = await sb.rpc('ai_feedback_bundle_set_status', { p_bundle: bundleId, p_status: status })
      if (error) fail('ai_feedback_bundle_set_status', error)
      return data === true
    },

    async saveAiFeedbackTriage(feedbackId, triage) {
      const { data, error } = await sb.rpc('ai_feedback_save_triage', { p_id: feedbackId, p_triage: triage })
      if (error) fail('ai_feedback_save_triage', error)
      return data === true
    },

    async saveAiFeedbackBundle(ids, title, triage) {
      const { data, error } = await sb.rpc('ai_feedback_save_bundle', { p_ids: ids, p_title: title, p_triage: triage })
      if (error) fail('ai_feedback_save_bundle', error)
      return String(data)
    },
  }
}
