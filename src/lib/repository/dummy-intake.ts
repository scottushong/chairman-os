import type { Attachment, DocumentRecord, IntakeItem, IntakeRow, NewAttachment, UserAccount } from '@/types'

import { dummyRepointAttachment } from './dummy-attachments'
import { intakeStore } from './dummy-intake-store'
import { dummyCanWriteDocuments, dummyHasBusiness, dummyViewer } from './dummy-org'
import type { AuditActor, ChairmanRepository, NewDocument } from './types'

/**
 * 0058 자료 받는 입구의 dummy 자리. 메모리에만 산다(서버를 다시 켜면 사라진다 — DUMMY_USER를 바꾸면 서버를 다시 켜야 하므로
 * 사람을 바꿔 가며 보려면 시드 줄을 쓴다: 아래 SEED).
 *
 * **DB가 막는 것을 여기서도 막는다**(dummy-attachments.ts와 같은 원칙) — 읽기(회사 AND 등급, 적재된 줄은 문서가 보이는 사람 ·
 * 올린 사람 · 회장) · 고치기(올린 사람 · 확인 권한자 · 회장) · stamp(uploaded로 못 돌아감 · 끈적한 AI 차단 · 조이기는 누구나 ·
 * «배합비 아님»은 올린 사람만 · 적재 줄 얼림 · 제안 이력) · 적재(intake_move_to_document의 판정 순서와 낱말) · 되돌리기.
 * dummy 문서 목록은 live의 0026 subtree를 다 옮기지 않았다(dummy.ts listDocuments — 메모리 문서는 누구에게나 보인다).
 */

const CLASS_RANK: Record<string, number> = { Public: 0, Normal: 1, Restricted: 2, Vault: 3 }
const NO_WRITE = new Set(['AIAgent', 'Integration'])

export interface IntakeDeps {
  createAttachment(input: NewAttachment, actor: AuditActor): Promise<Attachment>
  getAttachmentRaw(id: string): Attachment | undefined
  createDocument(input: NewDocument, actor: AuditActor): Promise<DocumentRecord>
  listDocuments(): Promise<DocumentRecord[]>
  softDeleteDocument(id: string): void
}

const now = () => new Date().toISOString()

function classOk(viewer: UserAccount, cls: string): boolean {
  return !viewer.revoked_at && viewer.role !== 'Integration' && CLASS_RANK[cls] <= CLASS_RANK[viewer.max_security_class]
}

function canEdit(viewer: UserAccount, r: IntakeItem): boolean {
  if (viewer.revoked_at || NO_WRITE.has(viewer.role) || !dummyHasBusiness(viewer, r.business_id) || !classOk(viewer, r.security_class)) return false
  return r.created_by === viewer.user_id || viewer.role === 'Chairman' || dummyCanWriteDocuments(viewer, r.business_id)
}

function deny(msg: string): never {
  throw new Error(`row-level security: intake_items — ${msg}`)
}

function fail(code: string, msg = ''): never {
  throw new Error(msg ? `${code}: ${msg}` : code)
}

export function dummyIntake(deps: IntakeDeps): Pick<
  ChairmanRepository,
  'listIntakeItems' | 'getIntakeItem' | 'getIntakeByAttachment' | 'beginIntake' | 'updateIntakeItem' | 'moveIntakeToDocument' | 'intakeSameFile'
> & { onDocumentDeleted(documentId: string, actor: AuditActor): void } {
  async function visible(r: IntakeItem): Promise<boolean> {
    const viewer = dummyViewer()
    if (!dummyHasBusiness(viewer, r.business_id) || !classOk(viewer, r.security_class)) return false
    if (r.status !== 'loaded' || r.created_by === viewer.user_id || viewer.role === 'Chairman') return true
    return (await deps.listDocuments()).some((d) => d.document_id === r.loaded_id)
  }

  async function row(r: IntakeItem): Promise<IntakeRow> {
    const a = deps.getAttachmentRaw(r.attachment_id)
    const viewer = dummyViewer()
    // 적재된 원본(문서 첨부)은 문서가 보이는 사람에게만 — 파일 이름도 같이 숨는다(live와 같은 모양).
    const fileVisible = !!a && (r.status !== 'loaded' || (await deps.listDocuments()).some((d) => d.document_id === r.loaded_id) || viewer.role === 'Chairman')
    return { ...structuredClone(r), file: fileVisible && a ? { file_name: a.file_name, mime: a.mime, size_bytes: a.size_bytes } : null }
  }

  async function find(pred: (r: IntakeItem) => boolean): Promise<IntakeItem | null> {
    for (const r of intakeStore.rows) if (pred(r) && (await visible(r))) return r
    return null
  }

  return {
    async listIntakeItems(businessId) {
      const out: IntakeRow[] = []
      for (const r of intakeStore.rows) if (r.business_id === businessId && (await visible(r))) out.push(await row(r))
      return out.sort((x, y) => y.created_at.localeCompare(x.created_at))
    },

    async getIntakeItem(itemId) {
      const r = await find((x) => x.item_id === itemId)
      return r ? row(r) : null
    },

    async getIntakeByAttachment(attachmentId) {
      const r = await find((x) => x.attachment_id === attachmentId)
      return r ? row(r) : null
    },

    async beginIntake(input, actor) {
      const viewer = dummyViewer()
      if (NO_WRITE.has(viewer.role) || !dummyHasBusiness(viewer, input.business_id) || !classOk(viewer, input.security_class)) {
        deny('이 회사 · 등급으로 올릴 수 없다')
      }
      const item: IntakeItem = {
        item_id: `itk_${crypto.randomUUID().replace(/-/g, '')}`,
        business_id: input.business_id,
        attachment_id: crypto.randomUUID(),
        security_class: input.security_class,
        status: 'uploaded',
        no_ai_reason: null,
        ai_blocked_reason: null,
        mix_attested_by: input.mix_attested ? viewer.user_id : null,
        mix_attested_at: input.mix_attested ? now() : null,
        proposal: null,
        proposal_history: [],
        kind: null,
        kind_confirmed_by: null,
        kind_confirmed_at: null,
        loaded_table: null,
        loaded_id: null,
        loaded_by: null,
        loaded_at: null,
        file_sha256: input.file_sha256,
        created_by: viewer.user_id,
        created_at: now(),
        updated_at: now(),
      }
      intakeStore.rows.push(item)
      try {
        const a = await deps.createAttachment(
          { attachment_id: item.attachment_id, entity_table: 'intake_items', entity_id: item.item_id, file_name: input.file_name, mime: input.mime, size_bytes: input.size_bytes, security_class: input.security_class },
          actor,
        )
        return { item_id: item.item_id, attachment_id: a.attachment_id, storage_path: a.storage_path }
      } catch (e) {
        intakeStore.rows = intakeStore.rows.filter((r) => r !== item) // 한 트랜잭션 — 첨부가 안 서면 줄도 없다
        throw e
      }
    },

    async updateIntakeItem(itemId, patch, actor) {
      void actor
      const viewer = dummyViewer()
      const r = intakeStore.rows.find((x) => x.item_id === itemId)
      if (!r || !(await visible(r)) || !canEdit(viewer, r)) deny('고칠 권한이 없다(올린 사람 · 확인 권한자 · 대표만)')
      const next: IntakeItem = { ...r, updated_at: now() }
      if (patch.status !== undefined) next.status = patch.status
      if (patch.no_ai_reason !== undefined) next.no_ai_reason = patch.no_ai_reason
      if (patch.proposal !== undefined) next.proposal = patch.proposal
      if (patch.kind !== undefined) next.kind = patch.kind
      const attest = patch.mix_attested === true && true
      const isChair = viewer.role === 'Chairman'

      if (next.status === 'loaded' && r.status !== 'loaded') fail('intake_items_loaded_check')
      if (next.status === 'uploaded' && r.status !== 'uploaded') fail('intake_status_back_to_uploaded')
      if (r.status === 'loaded' && (next.kind !== r.kind || JSON.stringify(next.proposal) !== JSON.stringify(r.proposal) || patch.mix_attested !== undefined)) {
        fail('intake_loaded_locked')
      }
      if (patch.mix_attested !== undefined && r.created_by !== viewer.user_id) fail('intake_mix_attest_uploader_only')

      // 끈적한 AI 차단(0058 I1 · N1) — stamp와 같은 순서.
      next.ai_blocked_reason = r.ai_blocked_reason
      const leaving = r.status === 'no_ai' && (next.status !== 'no_ai' || next.no_ai_reason !== r.no_ai_reason)
      if (r.status === 'no_ai' && r.ai_blocked_reason === 'not_attested' && attest && (next.status !== 'no_ai' || next.no_ai_reason === 'not_attested')) {
        if (next.status === 'no_ai') next.status = 'reading'
        next.ai_blocked_reason = null
      } else if (r.status === 'no_ai' && next.status === 'no_ai' && r.no_ai_reason === 'not_attested' && (next.no_ai_reason === 'mix_ratio' || next.no_ai_reason === 'excluded_entity')) {
        next.ai_blocked_reason = next.no_ai_reason // 조이기는 누구나
      } else if (leaving) {
        if (!isChair) fail('intake_ai_unblock_forbidden')
        next.ai_blocked_reason = next.status === 'no_ai' ? next.no_ai_reason : null
      }
      if (next.status === 'no_ai' && r.status !== 'no_ai') next.ai_blocked_reason = next.no_ai_reason
      if (next.status !== 'no_ai') next.no_ai_reason = null
      if (next.status === 'no_ai' && !next.no_ai_reason) fail('intake_items_no_ai_check')

      if (patch.mix_attested !== undefined) {
        next.mix_attested_by = patch.mix_attested ? viewer.user_id : null
        next.mix_attested_at = patch.mix_attested ? now() : null
      }
      if (next.kind !== r.kind) {
        next.kind_confirmed_by = next.kind ? viewer.user_id : null
        next.kind_confirmed_at = next.kind ? now() : null
      }
      if (JSON.stringify(next.proposal) !== JSON.stringify(r.proposal) && r.proposal) {
        next.proposal_history = [...r.proposal_history, { proposal: r.proposal, kind: r.kind, replaced_at: now(), replaced_by: viewer.user_id }]
      }
      Object.assign(r, next)
    },

    async moveIntakeToDocument(itemId, input, actor) {
      const viewer = dummyViewer()
      if (viewer.revoked_at || NO_WRITE.has(viewer.role)) fail('intake_forbidden')
      const r = intakeStore.rows.find((x) => x.item_id === itemId)
      if (!r || !dummyHasBusiness(viewer, r.business_id) || !classOk(viewer, r.security_class)) fail('intake_not_found')
      if (r.status === 'loaded') fail('intake_already_loaded')
      if (r.status === 'reading' || r.status === 'discarded') fail('intake_not_ready')
      if (r.status === 'no_ai' && viewer.role !== 'Chairman') fail('intake_ai_blocked')
      if (!r.kind) fail('intake_kind_missing')
      if (!dummyCanWriteDocuments(viewer, r.business_id) || CLASS_RANK[r.security_class] > CLASS_RANK[viewer.max_security_class]) {
        fail('intake_document_write_forbidden')
      }
      const title = input.title.trim()
      if (title.length < 1 || title.length > 300) fail('intake_title_invalid')
      const doc = await deps.createDocument(
        { title, business_id: r.business_id, doc_type: input.doc_type.trim() || '기타', security_class: r.security_class, storage_url: '', folder_id: input.folder_id ?? null, tags: input.tags ?? [] },
        actor,
      )
      // 0058 — 링크 칸은 앱 안 문서 화면. dummy createDocument는 받은 링크를 그대로 적으므로 여기서 고친다.
      doc.storage_url = `/documents/${doc.document_id}`
      dummyRepointAttachment(r.attachment_id, 'documents', doc.document_id)
      Object.assign(r, { status: 'loaded', no_ai_reason: null, loaded_table: 'documents', loaded_id: doc.document_id, loaded_by: viewer.user_id, loaded_at: now(), updated_at: now() })
      if (process.env.NODE_ENV !== 'production') console.warn(`[dummy] audit create documents ${doc.document_id} — 입구 ${r.item_id}에서 (${actor.role})`)
      return doc.document_id
    },

    async intakeSameFile(itemId) {
      const me = await find((x) => x.item_id === itemId)
      if (!me?.file_sha256) return []
      const out = []
      for (const o of intakeStore.rows) {
        if (o.item_id !== me.item_id && o.business_id === me.business_id && o.file_sha256 === me.file_sha256 && (await visible(o))) {
          out.push({ item_id: o.item_id, status: o.status, loaded_table: o.loaded_table, loaded_id: o.loaded_id, loaded_at: o.loaded_at, created_at: o.created_at })
        }
      }
      return out.sort((x, y) => x.created_at.localeCompare(y.created_at))
    },

    /** 0058 documents_intake_unload — 입구에서 온 문서를 지우면 원본이 입구로 돌아온다(차단 줄은 no_ai 같은 이유로). */
    onDocumentDeleted(documentId, actor) {
      const r = intakeStore.rows.find((x) => x.loaded_table === 'documents' && x.loaded_id === documentId)
      if (!r) return
      dummyRepointAttachment(r.attachment_id, 'intake_items', r.item_id)
      Object.assign(r, {
        status: r.ai_blocked_reason ? 'no_ai' : 'proposed',
        no_ai_reason: r.ai_blocked_reason,
        loaded_table: null,
        loaded_id: null,
        loaded_by: null,
        loaded_at: null,
        updated_at: now(),
      })
      if (process.env.NODE_ENV !== 'production') console.warn(`[dummy] audit update intake_items ${r.item_id} — 문서 ${documentId} 지움으로 되돌림 (${actor.role})`)
    },
  }
}

/** 0058 attachment_entity_visible의 intake_items 줄(dummy.ts 대상 판정). */
export function dummyIntakeEntity(itemId: string): { visible: boolean; business_id: string | null } {
  const viewer = dummyViewer()
  const r = intakeStore.rows.find((x) => x.item_id === itemId)
  if (!r) return { visible: false, business_id: null }
  // 원본이 입구 대상일 때는 줄이 loaded가 아니다 — 회사 AND 등급이면 보인다.
  const ok = dummyHasBusiness(viewer, r.business_id) && classOk(viewer, r.security_class)
  return { visible: ok, business_id: r.business_id }
}

/** 문서 지우기 권한(dummy) — 회장, 또는 입구에서 그 문서를 적재한 사람(0048 고치기 = 자기가 등록한 문서). */
export function dummyCanDeleteDocument(documentId: string): boolean {
  const viewer = dummyViewer()
  if (viewer.revoked_at || NO_WRITE.has(viewer.role)) return false
  if (viewer.role === 'Chairman') return true
  return intakeStore.rows.some((r) => r.loaded_id === documentId && r.loaded_by === viewer.user_id)
}

/** 한 쪽짜리 글자 PDF(시드 원본) — «다시 읽기» · «원본 보기»가 dummy에서도 돈다. 글은 ASCII만(Helvetica). */
function tinyPdf(text: string): ArrayBuffer {
  const stream = `BT /F1 12 Tf 50 700 Td (${text}) Tj ET`
  const objs = [
    '',
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let n = 1; n < objs.length; n++) {
    offsets[n] = out.length
    out += `${n} 0 obj\n${objs[n]}\nendobj\n`
  }
  const xref = out.length
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`
  for (let n = 1; n < objs.length; n++) out += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new TextEncoder().encode(out).buffer as ArrayBuffer
}

/** 1×1 JPEG(시드 사진). */
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=',
  'base64',
)

/**
 * dummy 시드 — 회사 DY 입구에 상태가 다른 줄 다섯(제안 · 재무제표 · 배합비 · 확인 없는 사진 · 읽기 실패). DUMMY_USER를 바꿔 다시 켜도
 * 같은 줄이 서서 «누구에게 어떤 버튼이 보이나»를 바로 볼 수 있다. 한 번만 심는다(globalThis 저장소).
 */
export function seedDummyIntake(addAttachment: (row: Attachment, bytes: ArrayBuffer) => void, ids: { salesStaff: string; supportLead: string; buyStaff: string }): void {
  const g = globalThis as unknown as { __chairmanDummyIntakeSeeded?: boolean }
  if (g.__chairmanDummyIntakeSeeded) return
  g.__chairmanDummyIntakeSeeded = true
  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
  const base = (id: string, by: string, n: number, cls: 'Normal' | 'Restricted'): IntakeItem => ({
    item_id: id,
    business_id: 'biz_dy',
    attachment_id: crypto.randomUUID(),
    security_class: cls,
    status: 'uploaded',
    no_ai_reason: null,
    ai_blocked_reason: null,
    mix_attested_by: null,
    mix_attested_at: null,
    proposal: null,
    proposal_history: [],
    kind: null,
    kind_confirmed_by: null,
    kind_confirmed_at: null,
    loaded_table: null,
    loaded_id: null,
    loaded_by: null,
    loaded_at: null,
    file_sha256: null,
    created_by: by,
    created_at: day(n),
    updated_at: day(n),
  })
  const proposal = (kind: IntakeItem['kind'] & string, reason: string, fields: Partial<NonNullable<IntakeItem['proposal']>['fields']>) => ({
    kind: kind as NonNullable<IntakeItem['proposal']>['kind'],
    confidence: 'high' as const,
    reason,
    fields: { title: null, counterparty: null, date: null, period: null, expiry: null, amount: null, doc_type: null, ...fields },
    model: 'dummy',
    dummy: true,
    at: day(1),
  })
  const rows: [IntakeItem, string, string, ArrayBuffer][] = [
    [
      { ...base('itk_seed_contract', ids.salesStaff, 1, 'Normal'), status: 'proposed', proposal: proposal('contract', '[DUMMY] 제1조(목적) · 갑 · 을 서명란', { title: '원료 공급계약서', counterparty: '㈜한빛원료', date: '2026-09-30', period: '2026-10-01 ~ 2027-09-30', expiry: '2027-09-30', amount: '금 일억이천만 원정', doc_type: 'Contract' }) },
      '원료공급계약서_한빛원료.pdf', 'application/pdf', tinyPdf('Supply Agreement - Article 1 Purpose - Party A and Party B signatures'),
    ],
    [
      { ...base('itk_seed_statement', ids.supportLead, 2, 'Restricted'), status: 'proposed', proposal: proposal('statement', '[DUMMY] 표지에 «재무상태표», 세무법인 직인', { title: '2025 사업연도 재무제표' }) },
      '2025_결산_재무제표.pdf', 'application/pdf', tinyPdf('Statement of Financial Position FY2025 - Tax accountant seal'),
    ],
    [
      { ...base('itk_seed_mix', ids.buyStaff, 3, 'Normal'), status: 'no_ai', no_ai_reason: 'mix_ratio', ai_blocked_reason: 'mix_ratio' },
      '사료배합표_v3.pdf', 'application/pdf', tinyPdf('Formulation sheet - Ingredient | w/w'),
    ],
    [
      { ...base('itk_seed_photo', ids.salesStaff, 4, 'Normal'), status: 'no_ai', no_ai_reason: 'not_attested', ai_blocked_reason: 'not_attested' },
      '명함_사진.jpg', 'image/jpeg', TINY_JPEG.buffer.slice(TINY_JPEG.byteOffset, TINY_JPEG.byteOffset + TINY_JPEG.byteLength) as ArrayBuffer,
    ],
    [
      { ...base('itk_seed_failed', ids.supportLead, 5, 'Normal'), status: 'failed' },
      '스캔본_공문.pdf', 'application/pdf', new TextEncoder().encode('not a pdf').buffer as ArrayBuffer,
    ],
  ]
  for (const [item, name, mime, bytes] of rows) {
    intakeStore.rows.push(item)
    addAttachment(
      {
        attachment_id: item.attachment_id,
        entity_table: 'intake_items',
        entity_id: item.item_id,
        business_id: 'biz_dy',
        file_name: name,
        mime,
        size_bytes: bytes.byteLength,
        storage_path: `intake_items/${item.item_id}/${item.attachment_id}`,
        security_class: item.security_class,
        uploaded_by: item.created_by,
        status: 'uploaded',
        ai_summary: null,
        ai_model: null,
        ai_error: null,
        summarized_at: null,
        created_at: item.created_at,
      },
      bytes,
    )
  }
}
