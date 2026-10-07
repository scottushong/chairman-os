import type {
  AiUsageInput,
  Attachment,
  AttachmentEntity,
  AttachmentSummaryPatch,
  AttachmentViewer,
  NewAttachment,
  UserAccount,
} from '@/types'

import { dummyFinanceImportIsDraft, dummyFinanceImportOwnedDraft } from './dummy-finance-imports'
import {
  dummyIntakeAiBlocked,
  dummyIntakeAttachmentLoaded,
  dummyIntakeDropByAttachment,
  dummyIntakeOwnsAttachment,
  dummyIntakeSealed,
} from './dummy-intake-store'
import { dummyPerson, dummyViewer } from './dummy-org'
import type { AuditActor, ChairmanRepository } from './types'

/**
 * 0045 첨부의 dummy 자리. 파일은 메모리에만 산다(서버를 다시 켜면 사라진다).
 *
 * **DB가 막는 것을 여기서도 막는다** — 대상이 보이고 AND 등급(Vault = 회장 + 지정자), 올리기 ·
 * 요약 고치기 · 지우기는 올린 사람 또는 회장, Vault는 요약 칸을 못 적는다. dummy에서 통과한 것이
 * live에서 막히면 dummy로 본 화면의 뜻이 없다(dummy-groupware.ts와 같은 원칙).
 *
 * 저장소를 globalThis에 둔다 — dev 서버는 모듈을 다시 읽을 때(HMR · 서버 액션 번들) 모듈 변수를
 * 새로 만든다. 올린 파일이 화면을 한 번 고칠 때마다 사라지면 요약을 검증할 수가 없다.
 */

interface Store {
  rows: Attachment[]
  bytes: Map<string, { data: ArrayBuffer; contentType: string }>
  viewers: { attachment_id: string; user_id: string }[]
  audit: { at: string; action: string; attachment_id: string; actor: string; note: string }[]
  usage: (AiUsageInput & { user_id: string; created_at: string })[]
}

const g = globalThis as unknown as { __chairmanDummyAttachments?: Store }
const store: Store = (g.__chairmanDummyAttachments ??= { rows: [], bytes: new Map(), viewers: [], audit: [], usage: [] })

/**
 * 0052 ecount_monthly_import의 원본 확인 자리 — 그 업로드의 첨부 줄(보는 사람과 상관없이 전부) · Storage 바이트가 있는가.
 * DB는 첨부 줄을 for update로 잡고 «정확히 하나 · 올린 사람 = 만든 사람 · 같은 회사 · xlsx · 객체 있음»을 본다.
 */
export function dummyFinanceImportOriginals(importId: string): { uploaded_by: string; business_id: string | null; mime: string; hasObject: boolean }[] {
  return store.rows
    .filter((a) => a.entity_table === 'finance_imports' && a.entity_id === importId)
    .map((a) => ({ uploaded_by: a.uploaded_by, business_id: a.business_id, mime: a.mime, hasObject: store.bytes.has(a.storage_path) }))
}

/**
 * 0058 적재 · 되돌리기의 첨부 재지정(입구 → 문서 · 문서 → 입구). 경로(storage_path)는 처음 자리 그대로다 — DB와 같다.
 * dummy-intake.ts만 부른다(DB의 attachments_entity_guard가 두 길만 여는 것과 같은 자리).
 */
export function dummyRepointAttachment(attachmentId: string, table: AttachmentEntity, entityId: string): void {
  const row = store.rows.find((a) => a.attachment_id === attachmentId)
  if (!row) throw new Error('attachments: 첨부가 없다')
  row.entity_table = table
  row.entity_id = entityId
}

/** 0058 dummy 시드(dummy-intake.ts seedDummyIntake) — 원본 줄과 바이트를 그대로 심는다. */
export function dummySeedAttachment(row: Attachment, bytes: ArrayBuffer): void {
  if (store.rows.some((a) => a.attachment_id === row.attachment_id)) return
  store.rows.push(row)
  store.bytes.set(row.storage_path, { data: bytes, contentType: row.mime })
}

/** 입구 목록이 원본 이름 · 형식을 붙이는 자리(dummy-intake.ts) — 보는 사람 판정은 그쪽이 한다. */
export function dummyAttachmentRaw(attachmentId: string): Attachment | undefined {
  return store.rows.find((a) => a.attachment_id === attachmentId)
}

/** Phase 11 /settings 일별 비용이 읽는다(dummy-assistant.ts). 줄을 고치지 못하게 사본을 준다. */
export function dummyUsageRows(): (AiUsageInput & { user_id: string; created_at: string })[] {
  return store.usage.map((u) => ({ ...u }))
}

const CLASS_RANK: Record<string, number> = { Public: 0, Normal: 1, Restricted: 2, Vault: 3 }

function audit(action: string, a: Attachment, note: string) {
  const actor = dummyViewer().user_id
  store.audit.push({ at: new Date().toISOString(), action, attachment_id: a.attachment_id, actor, note })
  if (process.env.NODE_ENV !== 'production') console.warn(`[dummy] audit ${action} ${a.file_name} — ${note}`)
}

function classOk(viewer: UserAccount, a: Pick<Attachment, 'attachment_id' | 'security_class'>): boolean {
  if (viewer.revoked_at || viewer.role === 'Integration') return false
  if (a.security_class === 'Vault') {
    return viewer.role === 'Chairman' || store.viewers.some((v) => v.attachment_id === a.attachment_id && v.user_id === viewer.user_id)
  }
  return CLASS_RANK[a.security_class] <= CLASS_RANK[viewer.max_security_class]
}

const mineOrChairman = (viewer: UserAccount, a: Attachment) => viewer.role === 'Chairman' || a.uploaded_by === viewer.user_id
const NO_WRITE = new Set(['AIAgent', 'Integration'])

/** 대상이 보이는가 — dummy.ts가 자기 목록(RLS를 옮겨 적은 것)으로 답한다. */
export type EntityLookup = (table: AttachmentEntity, id: string) => Promise<{ visible: boolean; business_id: string | null }>

type Methods = Pick<
  ChairmanRepository,
  | 'listAttachments'
  | 'listRecentAttachments'
  | 'getAttachment'
  | 'createAttachment'
  | 'putAttachmentObject'
  | 'readAttachmentObject'
  | 'updateAttachmentSummary'
  | 'deleteAttachment'
  | 'downloadAttachment'
  | 'recordAttachmentAiSend'
  | 'listAttachmentViewers'
  | 'setAttachmentViewer'
  | 'logAiUsage'
>

export function dummyAttachments(entity: EntityLookup): Methods {
  async function visibleRows(): Promise<Attachment[]> {
    const viewer = dummyViewer()
    const out: Attachment[] = []
    for (const a of store.rows) {
      if (!classOk(viewer, a)) continue
      if (!(await entity(a.entity_table, a.entity_id)).visible) continue
      out.push(a)
    }
    return out
  }

  async function get(id: string): Promise<Attachment | null> {
    return (await visibleRows()).find((a) => a.attachment_id === id) ?? null
  }

  return {
    async listAttachments(entityTable, entityId) {
      return (await visibleRows())
        .filter((a) => a.entity_table === entityTable && a.entity_id === entityId)
        .sort((x, y) => y.created_at.localeCompare(x.created_at))
        .map((a) => ({ ...a }))
    },

    async listRecentAttachments(since, limit) {
      return (await visibleRows())
        .filter((a) => !since || a.created_at >= since)
        .sort((x, y) => y.created_at.localeCompare(x.created_at))
        .slice(0, limit)
        .map((a) => ({ ...a }))
    },

    async getAttachment(id) {
      const a = await get(id)
      return a ? { ...a } : null
    },

    async createAttachment(input: NewAttachment, actor: AuditActor) {
      const viewer = dummyViewer()
      if (NO_WRITE.has(viewer.role)) throw new Error('row-level security: attachments — AIAgent · Integration은 올리지 않는다')
      const target = await entity(input.entity_table, input.entity_id)
      if (!target.visible) throw new Error('row-level security: attachments — 대상이 보이지 않는다')
      // 0050 attachments_finance_import_owner — 업로드 원본은 그 draft를 만든 본인만 올린다.
      if (input.entity_table === 'finance_imports' && !dummyFinanceImportOwnedDraft(input.entity_id, viewer.user_id)) {
        throw new Error('row-level security: attachments — 업로드 원본은 그 draft를 만든 본인만 올린다(0050)')
      }
      const id = input.attachment_id ?? crypto.randomUUID()
      // 0058 attachments_intake_owner — 입구 원본은 그 줄을 만든 본인이, 그 줄의 첨부 id · 등급으로만.
      if (input.entity_table === 'intake_items' && !dummyIntakeOwnsAttachment(input.entity_id, id, viewer.user_id, input.security_class)) {
        throw new Error('row-level security: attachments — 입구 원본은 그 입구 줄을 만든 본인만 올린다(0058)')
      }
      // Vault는 지정자가 아직 없으므로 회장만 통과한다(0045 attachments_insert와 같다).
      if (!classOk(viewer, { attachment_id: id, security_class: input.security_class })) {
        throw new Error('row-level security: attachments — 이 등급을 올릴 수 없다')
      }
      const { attachment_id: _ignored, ...fields } = input
      void _ignored
      const row: Attachment = {
        attachment_id: id,
        ...fields,
        business_id: input.entity_table === 'businesses' ? input.entity_id : target.business_id,
        storage_path: `${input.entity_table}/${input.entity_id}/${id}`,
        uploaded_by: viewer.user_id,
        status: input.security_class === 'Vault' ? 'skipped_vault' : 'uploaded',
        ai_summary: null,
        ai_model: null,
        ai_error: null,
        summarized_at: null,
        created_at: new Date().toISOString(),
      }
      store.rows.push(row)
      audit('upload', row, `첨부 올림 by ${actor.role}`)
      return { ...row }
    },

    async putAttachmentObject(path, bytes, contentType) {
      const viewer = dummyViewer()
      const row = store.rows.find((a) => a.storage_path === path)
      if (!row || row.uploaded_by !== viewer.user_id) throw new Error('storage: 줄을 올린 본인만 그 경로에 올린다(0045)')
      // 0050 attachment_object_uploadable — 끝난 업로드의 원본 자리에는 다시 못 올린다.
      if (row.entity_table === 'finance_imports' && !dummyFinanceImportIsDraft(row.entity_id)) {
        throw new Error('storage: 끝난 업로드의 원본은 바꾸지 않는다(0050)')
      }
      // 0058 — 입구 원본은 읽기 전(uploaded)에만 올린다.
      if (dummyIntakeSealed(row.attachment_id)) throw new Error('storage: 읽기 시작한 입구 원본은 바꾸지 않는다(0058)')
      if (store.bytes.has(path)) throw new Error('storage: 이미 있는 객체 — 원본은 덮어쓰지 않는다')
      store.bytes.set(path, { data: bytes, contentType })
    },

    async readAttachmentObject(path) {
      const viewer = dummyViewer()
      if (NO_WRITE.has(viewer.role)) throw new Error('storage: AIAgent는 첨부 파일을 열지 않는다')
      const visible = (await visibleRows()).some((a) => a.storage_path === path)
      const obj = store.bytes.get(path)
      if (!visible || !obj) throw new Error('storage: 파일이 없거나 볼 수 없다')
      return obj.data
    },

    async updateAttachmentSummary(id, patch: AttachmentSummaryPatch) {
      const viewer = dummyViewer()
      const a = await get(id)
      if (!a || !mineOrChairman(viewer, a) || NO_WRITE.has(viewer.role)) {
        throw new Error('row-level security: attachments 요약을 고칠 권한이 없다(올린 사람 · 회장만)')
      }
      const next = { ...a, ...patch }
      if (a.security_class === 'Vault' && (next.status !== 'skipped_vault' || next.ai_summary || next.ai_model)) {
        throw new Error('attachments_vault_check: Vault 첨부에는 요약을 적지 않는다')
      }
      if (next.status === 'summarized' && !next.ai_summary) throw new Error('attachments_summarized_check')
      const statusChanged = next.status !== a.status || JSON.stringify(next.ai_summary) !== JSON.stringify(a.ai_summary)
      if (JSON.stringify(next.ai_summary) !== JSON.stringify(a.ai_summary)) {
        next.summarized_at = next.ai_summary ? new Date().toISOString() : null
      }
      Object.assign(store.rows.find((r) => r.attachment_id === id)!, next)
      if (statusChanged) audit('ai_summarize', next, next.status === 'summarized' ? 'AI 요약' : `AI 요약 상태 ${next.status}`)
    },

    async deleteAttachment(id, actor) {
      const viewer = dummyViewer()
      const a = await get(id)
      if (!a) throw new Error('attachments: 지울 첨부가 없다(없거나 볼 권한이 없다)')
      if (!mineOrChairman(viewer, a) || NO_WRITE.has(viewer.role)) throw new Error('row-level security: attachments 삭제 권한이 없다')
      // 0050 attachments_finance_import_delete — committed · cancelled 업로드의 원본은 증빙이다(리뷰 I-2).
      if (a.entity_table === 'finance_imports' && !dummyFinanceImportIsDraft(a.entity_id)) {
        throw new Error('row-level security: attachments — 끝난 업로드의 원본은 지우지 않는다(0050)')
      }
      // 0058 attachments_intake_loaded_delete — 문서로 적재 중인 원본은 못 지운다(문서를 지워 되돌린 뒤에).
      if (dummyIntakeAttachmentLoaded(a.attachment_id)) throw new Error('row-level security: attachments — 문서로 적재된 입구 원본은 지우지 않는다(0058)')
      store.bytes.delete(a.storage_path)
      dummyIntakeDropByAttachment(a.attachment_id)
      store.rows.splice(store.rows.findIndex((r) => r.attachment_id === id), 1)
      store.viewers = store.viewers.filter((v) => v.attachment_id !== id)
      audit('delete_request', a, `첨부 삭제 by ${actor.role}`)
    },

    async downloadAttachment(id) {
      const a = await get(id)
      if (!a) return null
      const obj = store.bytes.get(a.storage_path)
      if (!obj) return null
      audit('download', a, '첨부 내려받기')
      // dummy에는 서명 URL이 없다. 브라우저가 바로 여는 data URL로 준다(20MB 안).
      return `data:${obj.contentType};base64,${Buffer.from(obj.data).toString('base64')}`
    },

    async recordAttachmentAiSend(id, model) {
      const a = await get(id)
      if (!a) return false
      // 0058 — AI 제외 대상(ECOUNT 원본) · 입구 차단(끈적) · no_ai · 확인 없는 사진. 감사를 적기 전에 던진다.
      if (a.entity_table === 'finance_imports' || dummyIntakeAiBlocked(a.attachment_id, a.mime)) throw new Error('ai_excluded (42501)')
      if (a.security_class === 'Vault') throw new Error('attachment_vault_no_ai')
      audit('ai_external_send', a, `${a.security_class === 'Restricted' ? '외부 AI 전송 (제한 등급)' : '외부 AI 전송'} · ${model}`)
      return true
    },

    async listAttachmentViewers(id): Promise<AttachmentViewer[]> {
      const viewer = dummyViewer()
      return store.viewers
        .filter((v) => v.attachment_id === id && (viewer.role === 'Chairman' || v.user_id === viewer.user_id))
        .map((v) => ({ user_id: v.user_id, display_name: dummyPerson(v.user_id)?.display_name ?? '이름 없음' }))
    },

    async setAttachmentViewer(id, userId, on, actor) {
      if (dummyViewer().role !== 'Chairman') throw new Error('row-level security: Vault 지정자는 회장만 정한다')
      const a = store.rows.find((r) => r.attachment_id === id)
      if (!a) throw new Error('attachments: 첨부가 없다')
      store.viewers = store.viewers.filter((v) => !(v.attachment_id === id && v.user_id === userId))
      if (on) store.viewers.push({ attachment_id: id, user_id: userId })
      audit('permission_change', a, `${on ? 'Vault 지정자 추가' : 'Vault 지정자 해제'} ${userId} by ${actor.role}`)
    },

    async logAiUsage(input) {
      const viewer = dummyViewer()
      if (viewer.role === 'Integration') throw new Error('row-level security: ai_usage_log')
      store.usage.push({ ...input, user_id: viewer.user_id, created_at: new Date().toISOString() })
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[dummy] ai_usage ${input.feature} ${input.model} in=${input.input_tokens} out=${input.output_tokens} $${input.estimated_cost_usd.toFixed(4)}`)
      }
    },
  }
}

/** 검색(CH-043)의 dummy 갈래 — 보이는 첨부 중 파일 이름 · 요약 문장이 맞는 것. */
export function attachmentSearchText(a: Attachment): string {
  const s = a.ai_summary
  return [a.file_name, ...(s ? [...s.summary, ...(s.summary_ko ?? []), ...s.key_numbers, ...s.decisions_needed, ...s.next_actions] : [])]
    .join(' ')
    .toLowerCase()
}
