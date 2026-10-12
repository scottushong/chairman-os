import type { FinRow, FinUpload, FinUploadApplyInput, FinUploadPending, FinUploadShape, Role } from '@/types'

import type { ChairmanRepository } from './types'

/**
 * 0070의 dummy 자리 — fin_uploads · 자료 표 · 학습을 메모리에서 흉내 낸다(정책 · RPC를 옮겨 적은 것, live에서는 돌지 않는다).
 * 같은 파일 두 번 · 겹침 선택 · 자동은 겹침 · 마감 거부 · 마감 달은 대표 · CFO + 이유 · 되돌리기 7일(바꾸기 되돌리면 옛 줄 되살림) ·
 * 급여 개인 줄은 대표 · CFO에게만 · 쓰기는 장부를 쓰는 사람만.
 */

export interface DummyFinUploadDeps {
  viewer(): { user_id: string; role: Role }
  canKeep(businessId: string): boolean
  canRead(businessId: string): boolean
  closed(businessId: string, period: string): Promise<boolean>
  notify(userId: string, title: string, body: string, link: string): void
}

type Methods = Pick<
  ChairmanRepository,
  | 'listFinUploads'
  | 'finUploadPending'
  | 'finUploadRecord'
  | 'finUploadApply'
  | 'finUploadRevert'
  | 'finUploadCancel'
  | 'finMonthClosed'
  | 'listFinUploadShapes'
  | 'saveFinUploadShape'
>

interface Line {
  upload_id: string
  business_id: string
  period: string
  kind: string
  people: boolean
  row: FinRow
  voided_at: string | null
}

interface Store {
  uploads: (FinUpload & { pending: FinUploadPending | null })[]
  lines: Line[]
  shapes: FinUploadShape[]
}
const g = globalThis as unknown as { __chairmanDummyFinUpload?: Store }
const store: Store = (g.__chairmanDummyFinUpload ??= { uploads: [], lines: [], shapes: [] })

/** 시험이 줄을 읽는다(dummy만 — live에는 표를 직접 읽는 화면이 다음 블록이다). */
export function dummyFinLines(): readonly Line[] {
  return store.lines
}

const live = (s: FinUpload['status']) => s === 'applied' || s === 'needs_review'
const chairOrCfo = (r: Role) => r === 'Chairman' || r === 'GroupCFO'

export function dummyFinanceUpload(d: DummyFinUploadDeps): Methods {
  const strip = ({ pending: _p, ...u }: Store['uploads'][number]): FinUpload => (void _p, { ...u })
  function voidRows(ids: string[], on: boolean) {
    for (const l of store.lines) if (ids.includes(l.upload_id)) l.voided_at = on ? new Date().toISOString() : null
  }
  return {
    async listFinUploads(businessId) {
      if (!d.canKeep(businessId) && !d.canRead(businessId)) return []
      return store.uploads.filter((u) => u.business_id === businessId).map(strip)
    },
    async finUploadPending(id) {
      const u = store.uploads.find((x) => x.upload_id === id)
      if (!u || !d.canKeep(u.business_id) || u.status !== 'needs_review' || !u.pending) return null
      if (chairOrCfo(d.viewer().role)) return structuredClone(u.pending)
      const { people: _drop, grid, ...rest } = u.pending
      void _drop
      // 급여는 칸 격자에도 사람별 줄이 있다 — 대표 · CFO 밖에는 뺀다(0070 fin_upload_pending과 같다).
      return structuredClone(u.kind === 'payroll' ? rest : { ...rest, grid })
    },
    async finUploadRecord(x) {
      if (!d.canKeep(x.business_id)) throw new Error('fin_upload_denied')
      if (x.status === 'needs_review' && store.uploads.some((u) => u.business_id === x.business_id && u.kind === x.kind && (u.period ?? '') === (x.period ?? '') && u.file_sha256 === x.file_sha256 && live(u.status))) {
        throw new Error('fin_upload_duplicate')
      }
      const row = {
        upload_id: crypto.randomUUID(),
        business_id: x.business_id,
        kind: x.kind,
        period: x.period,
        file_name: x.file_name,
        file_sha256: x.file_sha256,
        sheet_name: x.sheet_name,
        ai_confidence: x.ai_confidence,
        ai_used: x.ai_used,
        auto: false,
        status: x.status,
        row_count: x.pending?.rows.length ?? 0,
        overlap: 'none' as const,
        reason: null,
        error: x.error,
        created_by: d.viewer().user_id,
        created_at: new Date().toISOString(),
        applied_at: null,
        reverted_at: null,
        replaced_by: null,
        pending: x.status === 'failed' ? null : x.pending,
      }
      store.uploads.unshift(row)
      return row.upload_id
    },
    async finUploadApply(x: FinUploadApplyInput) {
      if (!d.canKeep(x.business_id)) throw new Error('fin_upload_denied')
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(x.period)) throw new Error('fin_upload_period')
      if (!x.rows.length) throw new Error('fin_upload_rows')
      const old = store.uploads.filter((u) => u.business_id === x.business_id && u.kind === x.kind && u.period === x.period && u.status === 'applied' && u.upload_id !== x.upload_id)
      const closed = await d.closed(x.business_id, x.period)
      if (x.auto && (old.length || closed)) throw new Error('fin_upload_auto_blocked')
      if (closed && !(chairOrCfo(d.viewer().role) && (x.reason ?? '').trim().length >= 2)) throw new Error('fin_upload_closed')
      if (old.length && x.overlap === 'none') throw new Error('fin_upload_overlap')
      const overlap = old.length ? x.overlap : 'none'
      const status: FinUpload['status'] = overlap === 'keep_old' ? 'skipped' : 'applied'
      let id = x.upload_id
      const now = new Date().toISOString()
      if (id) {
        const u = store.uploads.find((v) => v.upload_id === id && v.business_id === x.business_id)
        if (!u || u.status !== 'needs_review') throw new Error('fin_upload_not_pending')
        Object.assign(u, { kind: x.kind, period: x.period, status, auto: x.auto, overlap, reason: x.reason, pending: null, row_count: x.rows.length, applied_at: now })
      } else {
        if (store.uploads.some((u) => u.business_id === x.business_id && u.kind === x.kind && u.period === x.period && u.file_sha256 === x.file_sha256 && live(u.status))) {
          throw new Error('fin_upload_duplicate')
        }
        id = crypto.randomUUID()
        store.uploads.unshift({
          upload_id: id, business_id: x.business_id, kind: x.kind, period: x.period, file_name: x.file_name, file_sha256: x.file_sha256,
          sheet_name: x.sheet_name, ai_confidence: x.ai_confidence, ai_used: x.ai_used, auto: x.auto, status, row_count: x.rows.length,
          overlap, reason: x.reason, error: null, created_by: d.viewer().user_id, created_at: now, applied_at: now, reverted_at: null,
          replaced_by: null, pending: null,
        })
      }
      if (status === 'applied') {
        if (overlap === 'replace') {
          voidRows(old.map((u) => u.upload_id), true)
          for (const u of old) Object.assign(u, { status: 'replaced', replaced_by: id })
        }
        for (const row of x.rows) store.lines.push({ upload_id: id, business_id: x.business_id, period: x.period, kind: x.kind, people: false, row: { ...row }, voided_at: null })
        for (const row of x.people ?? []) store.lines.push({ upload_id: id, business_id: x.business_id, period: x.period, kind: x.kind, people: true, row: { ...row }, voided_at: null })
      }
      if (x.auto) d.notify(d.viewer().user_id, '자료를 자동으로 넣었습니다', `${x.kind} · ${x.period} · ${x.rows.length}줄 — 7일 안에 되돌릴 수 있습니다.`, `/finance/${x.business_id}/upload`)
      return id
    },
    async finUploadRevert(id, reason) {
      const u = store.uploads.find((x) => x.upload_id === id)
      if (!u || !d.canKeep(u.business_id)) throw new Error('fin_upload_denied')
      if (u.status !== 'applied') return false
      if (u.applied_at && Date.parse(u.applied_at) < Date.now() - 7 * 86_400_000) throw new Error('fin_upload_revert_expired')
      if (u.period && (await d.closed(u.business_id, u.period)) && !chairOrCfo(d.viewer().role)) throw new Error('fin_upload_closed')
      voidRows([id], true)
      const prev = store.uploads.filter((x) => x.replaced_by === id && x.status === 'replaced')
      voidRows(prev.map((x) => x.upload_id), false)
      for (const p of prev) Object.assign(p, { status: 'applied', replaced_by: null })
      Object.assign(u, { status: 'reverted', reverted_at: new Date().toISOString(), reason: reason ?? u.reason })
      return true
    },
    async finUploadCancel(id) {
      const u = store.uploads.find((x) => x.upload_id === id)
      if (!u || !d.canKeep(u.business_id)) throw new Error('fin_upload_denied')
      if (u.status !== 'needs_review') return false
      Object.assign(u, { status: 'cancelled', pending: null })
      return true
    },
    finMonthClosed: (b, p) => d.closed(b, p),
    async listFinUploadShapes(businessId) {
      return d.canKeep(businessId) ? store.shapes.filter((s) => s.business_id === businessId).map((s) => ({ ...s })) : []
    },
    async saveFinUploadShape(s) {
      if (!d.canKeep(s.business_id)) throw new Error('fin_upload_denied')
      if (Object.values(s.column_map).some((v) => !Number.isInteger(v) || v < 0 || v > 200)) throw new Error('fin_upload_shape')
      const i = store.shapes.findIndex((x) => x.business_id === s.business_id && x.header_sig === s.header_sig)
      if (i >= 0) store.shapes[i] = { ...s }
      else store.shapes.push({ ...s })
    },
  }
}
