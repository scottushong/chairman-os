import 'server-only'

import { existsSync, readFileSync, writeFileSync } from 'node:fs'

import type { SupabaseClient } from '@supabase/supabase-js'

import { currentUser } from '@/lib/auth/session'
import { DATA_MODE } from '@/lib/env'
import { featureOnFor } from '@/lib/features'
import { loadFeatureSwitches } from '@/lib/features-server'
import { DUMMY_PEOPLE, DUMMY_TEAMS, dummyViewer } from '@/lib/repository/dummy-org'
import { createSupabaseServerClient } from '@/lib/supabase/server'

import { EaEngine, emptyState, type EaPersonRow, type EaState } from './engine'
import type { EaBox, EaCounts, EaDocView, EaDraftInput, EaFollowupStatus, EaForm, EaLineEntry, EaLineRule, EaListRow, EaMySettings, EaPerson, EaRefEntry } from './types'

/**
 * 0087 전자결재의 서버 쪽 한 자리 — 화면 · 서버 액션 · 홈 위젯(widget.ts)이 모두 여기를 부른다(같은 조회 · 같은 권한).
 *   live   사람 세션의 Supabase로 ea_* RPC만 부른다. 판정은 전부 DB(0087). 표를 직접 읽지 않는다.
 *   dummy  engine.ts(0087을 옮겨 적은 것). 상태는 globalThis 한 벌 — DUMMY_EA_STATE=<파일>이면 그 파일에 남겨
 *          서버를 다른 DUMMY_USER로 다시 켜도 이어진다(A · B · 대표 시험).
 */

export const EA_BUCKET = 'ea-files'

export interface EaStore {
  mode: 'live' | 'dummy'
  me: { uid: string; role: string; name: string } | null
  list(box: EaBox, q?: string | null): Promise<EaListRow[]>
  counts(): Promise<EaCounts>
  detail(id: string): Promise<EaDocView | null>
  people(): Promise<EaPerson[]>
  forms(): Promise<EaForm[]>
  rules(): Promise<EaLineRule[]>
  mySettings(): Promise<EaMySettings | null>
  saveDraft(i: EaDraftInput): Promise<string>
  deleteDraft(id: string): Promise<void>
  submit(id: string, req: string): Promise<string>
  act(id: string, seq: number, action: 'approve' | 'reject', comment: string | null, req: string): Promise<string>
  withdraw(id: string, req: string): Promise<void>
  resubmit(id: string): Promise<string>
  refMark(id: string, confirm: boolean): Promise<void>
  followupUpdate(id: string, status: EaFollowupStatus, result: string | null, slip: string | null, req: string): Promise<void>
  fileAdd(id: string, path: string, name: string, size: number, mime: string | null, bytes?: Uint8Array): Promise<void>
  fileRemove(fileId: string): Promise<void>
  /** 내려받기 — live는 짧은 서명 주소(버킷 정책 = 문서 읽기 권한), dummy는 바이트. 권한 없으면 null. */
  fileGet(path: string): Promise<{ url: string } | { bytes: Uint8Array; mime: string } | null>
  proxySave(proxy: string, from: string, to: string, forms: string[] | null, max: number | null): Promise<void>
  proxyEnd(id: string): Promise<void>
  favoriteSave(name: string, line: EaLineEntry[], refs: EaRefEntry[]): Promise<void>
  favoriteDelete(id: string): Promise<void>
  settingsSave(notify: EaMySettings['notify']): Promise<void>
  formSave(f: Omit<EaForm, 'version' | 'sort_order'>): Promise<number>
  ruleSave(r: Omit<EaLineRule, 'rule_id'> & { rule_id: string | null }): Promise<void>
}

// ── live ──────────────────────────────────────────────────────────────
const MISSING = new Set(['PGRST202', '42883', 'PGRST205', '42P01'])
type PgErr = { code?: string; message: string; details?: string | null } | null

function check(error: PgErr): void {
  if (!error) return
  if (MISSING.has(error.code ?? '')) throw new Error('ea_unavailable')
  const key = /ea_[a-z_]+/.exec(error.message)?.[0]
  if (key) throw new Error(error.details ? `${key} (${error.details})` : key)
  throw new Error(`Supabase ${error.code ?? '?'}: ${error.message}`)
}

function liveStore(sb: SupabaseClient, me: EaStore['me']): EaStore {
  const rpc = async <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
    const { data, error } = await sb.rpc(fn, args)
    check(error)
    return data as T
  }
  const num = (v: unknown) => (v == null ? null : Number(v))
  return {
    mode: 'live',
    me,
    async list(box, q) {
      const rows = await rpc<EaListRow[]>('ea_list', { p_box: box, p_q: q ?? null })
      return (rows ?? []).map((r) => ({ ...r, amount: num(r.amount) }))
    },
    async counts() {
      return rpc<EaCounts>('ea_counts')
    },
    async detail(id) {
      return rpc<EaDocView | null>('ea_doc', { p_doc: id })
    },
    async people() {
      return (await rpc<EaPerson[]>('ea_people')) ?? []
    },
    async forms() {
      const { data, error } = await sb.from('ea_forms').select('*').order('sort_order')
      check(error)
      return (data ?? []) as EaForm[]
    },
    async rules() {
      const { data, error } = await sb.from('ea_line_rules').select('rule_id, form_key, business_id, min_amount, require_chairman, note, active').order('min_amount')
      check(error)
      return ((data ?? []) as EaLineRule[]).map((r) => ({ ...r, min_amount: Number(r.min_amount) }))
    },
    async mySettings() {
      return rpc<EaMySettings | null>('ea_my_settings')
    },
    async saveDraft(i) {
      return rpc<string>('ea_save_draft', {
        p_doc: i.doc_id, p_business: i.business_id, p_form: i.form_key, p_title: i.title, p_body: i.body, p_fields: i.fields, p_line: i.line, p_refs: i.refs,
        p_due: i.due_date, p_wish: i.wish_date, p_followup: i.followup_assignee, p_related: i.related,
      })
    },
    async deleteDraft(id) {
      const d = await rpc<EaDocView | null>('ea_doc', { p_doc: id })
      await rpc('ea_delete_draft', { p_doc: id })
      const paths = (d?.files ?? []).map((f) => f.path)
      // 객체 지우기 정책은 두지 않았다(0087) — 남은 객체는 첨부 줄이 없어 아무도 못 읽는다. 지우기 실패는 무시.
      if (paths.length) await sb.storage.from(EA_BUCKET).remove(paths).catch(() => undefined)
    },
    async submit(id, req) {
      return rpc<string>('ea_submit', { p_doc: id, p_req: req })
    },
    async act(id, seq, action, comment, req) {
      return rpc<string>('ea_act', { p_doc: id, p_seq: seq, p_action: action, p_comment: comment, p_req: req })
    },
    async withdraw(id, req) {
      await rpc('ea_withdraw', { p_doc: id, p_req: req })
    },
    async resubmit(id) {
      return rpc<string>('ea_resubmit', { p_doc: id })
    },
    async refMark(id, confirm) {
      await rpc('ea_ref_mark', { p_doc: id, p_confirm: confirm })
    },
    async followupUpdate(id, status, result, slip, req) {
      await rpc('ea_followup_update', { p_doc: id, p_status: status, p_result: result, p_slip: slip, p_req: req })
    },
    async fileAdd(id, path, name, size, mime) {
      await rpc('ea_file_add', { p_doc: id, p_path: path, p_name: name, p_size: size, p_mime: mime })
    },
    async fileRemove(fileId) {
      await rpc('ea_file_remove', { p_file: fileId })
    },
    async fileGet(path) {
      const { data, error } = await sb.storage.from(EA_BUCKET).createSignedUrl(path, 60)
      if (error || !data?.signedUrl) return null
      return { url: data.signedUrl }
    },
    async proxySave(proxy, from, to, forms, max) {
      await rpc('ea_proxy_save', { p_proxy: proxy, p_from: from, p_to: to, p_forms: forms, p_max: max })
    },
    async proxyEnd(id) {
      await rpc('ea_proxy_end', { p_id: id })
    },
    async favoriteSave(name, line, refs) {
      await rpc('ea_favorite_save', { p_name: name, p_line: line, p_refs: refs })
    },
    async favoriteDelete(id) {
      await rpc('ea_favorite_delete', { p_id: id })
    },
    async settingsSave(notify) {
      await rpc('ea_settings_save', { p_notify: notify })
    },
    async formSave(f) {
      return rpc<number>('ea_form_save', {
        p_key: f.form_key, p_name: f.name_ko, p_fields: f.fields, p_attach: f.attachment_required, p_followup: f.followup_kind,
        p_followup_required: f.followup_required, p_note: f.note, p_active: f.active,
      })
    },
    async ruleSave(r) {
      await rpc('ea_line_rule_save', { p_id: r.rule_id, p_form: r.form_key, p_business: r.business_id, p_min: r.min_amount, p_require: r.require_chairman, p_note: r.note, p_active: r.active })
    },
  }
}

// ── dummy ─────────────────────────────────────────────────────────────
type Saved = Omit<EaState, 'settings' | 'objects'> & { settings: [string, EaMySettings['notify']][]; objects: string[] }
const G = globalThis as { __eaDummy?: EaState; __eaBytes?: Map<string, { bytes: Uint8Array; mime: string }> }

function stateFile() {
  return process.env.DUMMY_EA_STATE?.trim() || null
}
function loadState(): EaState {
  const file = stateFile()
  if (file && existsSync(file)) {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Saved
    return { ...raw, settings: new Map(raw.settings), objects: new Set(raw.objects) }
  }
  return (G.__eaDummy ??= emptyState())
}
function saveState(s: EaState) {
  G.__eaDummy = s
  const file = stateFile()
  if (file) writeFileSync(file, JSON.stringify({ ...s, settings: [...s.settings], objects: [...s.objects] } satisfies Saved))
}
const bytes = (G.__eaBytes ??= new Map())

export function dummyPeople(): EaPersonRow[] {
  return DUMMY_PEOPLE.map((p) => ({
    user_id: p.user_id, name: p.display_name, role: p.role, title: p.title_ko,
    dept: DUMMY_TEAMS.find((t) => t.team_id === p.team_id)?.name ?? null,
    business_ids: p.business_ids, active: !p.revoked_at,
  }))
}

async function dummyStore(): Promise<EaStore> {
  const viewer = dummyViewer()
  const rows = await loadFeatureSwitches()
  const people = dummyPeople()
  const engine = () => new EaEngine({ state: loadState(), people, featureOn: (role, b) => featureOnFor(rows, 'approvals', role as never, b) }, { uid: viewer.user_id, role: viewer.role })
  /** 쓰기: 파일에서 읽고 → 엔진 → 파일에 쓴다(한 요청 안 한 번). */
  const write = <T>(fn: (e: EaEngine) => T): T => {
    const state = loadState()
    const e = new EaEngine({ state, people, featureOn: (role, b) => featureOnFor(rows, 'approvals', role as never, b) }, { uid: viewer.user_id, role: viewer.role })
    const out = fn(e)
    saveState(state)
    return out
  }
  return {
    mode: 'dummy',
    me: { uid: viewer.user_id, role: viewer.role, name: viewer.display_name },
    list: async (box, q) => engine().list(box, q),
    counts: async () => engine().counts(),
    detail: async (id) => engine().detail(id),
    people: async () => engine().peopleList(),
    forms: async () => loadState().forms,
    rules: async () => loadState().rules,
    mySettings: async () => engine().mySettings(),
    saveDraft: async (i) => write((e) => e.saveDraft(i)),
    deleteDraft: async (id) => {
      for (const p of write((e) => e.deleteDraft(id))) bytes.delete(p)
    },
    submit: async (id, req) => write((e) => e.submit(id, req)),
    act: async (id, seq, a, c, req) => write((e) => e.act(id, seq, a, c, req)),
    withdraw: async (id, req) => void write((e) => e.withdraw(id, req)),
    resubmit: async (id) => write((e) => e.resubmit(id)),
    refMark: async (id, c) => void write((e) => e.refMark(id, c)),
    followupUpdate: async (id, s, r, slip, req) => void write((e) => e.followupUpdate(id, s, r, slip, req)),
    fileAdd: async (id, path, name, size, mime, b) => {
      write((e) => e.fileAdd(id, path, name, size, mime))
      if (b) bytes.set(path, { bytes: b, mime: mime || 'application/octet-stream' })
    },
    fileRemove: async (fileId) => {
      bytes.delete(write((e) => e.fileRemove(fileId)))
    },
    fileGet: async (path) => {
      if (!engine().objectReadOk(path)) return null
      return bytes.get(path) ?? { bytes: new TextEncoder().encode('dummy 첨부 — 개발용 가짜 파일입니다.'), mime: 'text/plain; charset=utf-8' }
    },
    proxySave: async (p, f, t, forms, max) => void write((e) => e.proxySave(p, f, t, forms, max)),
    proxyEnd: async (id) => void write((e) => e.proxyEnd(id)),
    favoriteSave: async (n, l, r) => void write((e) => e.favoriteSave(n, l, r)),
    favoriteDelete: async (id) => void write((e) => e.favoriteDelete(id)),
    settingsSave: async (n) => void write((e) => e.settingsSave(n)),
    formSave: async (f) => write((e) => e.formSave(f)),
    ruleSave: async (r) => void write((e) => e.ruleSave(r)),
  }
}

/** 요청마다 하나. 로그인 안 했으면 me null(목록 · 건수는 빈 값). */
export async function eaStore(): Promise<EaStore> {
  if (DATA_MODE === 'dummy') return dummyStore()
  const user = await currentUser()
  return liveStore(await createSupabaseServerClient(), user ? { uid: user.user_id, role: user.role, name: user.name } : null)
}
