import type {
  AiUsageInput,
  Attachment,
  AttachmentEntity,
  AttachmentSummaryPatch,
  AttachmentViewer,
  NewAttachment,
  UserAccount,
} from '@/types'

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
      const id = crypto.randomUUID()
      // Vault는 지정자가 아직 없으므로 회장만 통과한다(0045 attachments_insert와 같다).
      if (!classOk(viewer, { attachment_id: id, security_class: input.security_class })) {
        throw new Error('row-level security: attachments — 이 등급을 올릴 수 없다')
      }
      const row: Attachment = {
        attachment_id: id,
        ...input,
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
      store.bytes.delete(a.storage_path)
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
