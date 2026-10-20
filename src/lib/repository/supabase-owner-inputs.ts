import type { SupabaseClient } from '@supabase/supabase-js'

import { OWNER_INPUT_KEYS, type OwnerInputKey, type OwnerInputRow } from '@/lib/owner-inputs'

import type { ChairmanRepository } from './types'

/**
 * 0089 5절 «받을 것»의 live 어댑터 조각. supabase.ts가 펼쳐 넣는다.
 * **0089 전 DB를 견딘다**: 읽기는 null, 쓰기는 'owner_input_unavailable'.
 * 오류는 낱말(owner_input_*)만 다시 던진다 — DB 원문(DETAIL · CONTEXT)을 옮기지 않는다(구글 키 본문이 섞일 여지를 없앤다).
 */

const MISSING = new Set(['PGRST202', '42883', 'PGRST205', '42P01'])

type Methods = Pick<ChairmanRepository, 'listOwnerInputs' | 'markOwnerInput' | 'saveGoogleServiceAccount'>

function word(error: { code?: string; message?: string }): Error {
  if (MISSING.has(error.code ?? '')) return new Error('owner_input_unavailable')
  const w = /owner_input_[a-z_]+/.exec(error.message ?? '')?.[0]
  return new Error(w ?? `owner_input_failed ${error.code ?? '?'}`)
}

export function ownerInputMethods(sb: SupabaseClient): Methods {
  return {
    async listOwnerInputs() {
      const { data, error } = await sb.from('owner_inputs').select('item_key,scope,summary,received_by,received_at')
      if (error) {
        if (MISSING.has(error.code ?? '')) return null
        throw new Error(`Supabase owner_inputs ${error.code ?? '?'}`)
      }
      return (data ?? [])
        .filter((r) => (OWNER_INPUT_KEYS as readonly string[]).includes(r.item_key as string))
        .map((r) => ({
          item_key: r.item_key as OwnerInputKey,
          scope: String(r.scope),
          summary: (r.summary ?? {}) as Record<string, unknown>,
          received_by: (r.received_by as string | null) ?? null,
          received_at: String(r.received_at),
        })) satisfies OwnerInputRow[]
    },
    async markOwnerInput(item, scope, summary) {
      const { error } = await sb.rpc('owner_input_mark', { p_item: item, p_scope: scope, p_summary: summary })
      if (error) throw word(error)
    },
    async saveGoogleServiceAccount(json) {
      const { data, error } = await sb.rpc('owner_input_google_sa_save', { p_json: json })
      if (error) throw word(error)
      const r = (data ?? {}) as Record<string, unknown>
      return { client_email: String(r.client_email ?? ''), project_id: String(r.project_id ?? '') }
    },
  }
}
