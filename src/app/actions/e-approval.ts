'use server'

import { revalidatePath } from 'next/cache'

import { eaStore } from '@/lib/approvals/store'
import { eaErrorText, type EaDraftInput, type EaFollowupStatus, type EaForm, type EaLineEntry, type EaLineRule, type EaMySettings, type EaRefEntry } from '@/lib/approvals/types'

/**
 * 0087 전자결재 서버 액션. 판정은 전부 DB(live — ea_* RPC) · engine.ts(dummy). 여기는 모양만 거르고 결과를 화면 말로 바꾼다.
 * 처리 요청에는 화면이 만든 요청 id(req)가 같이 온다 — 같은 요청을 두 번 보내도(중복 클릭 · 재시도) 한 번만 반영된다(ea_events.request_id 유일).
 * 실패해도 화면은 입력한 의견 · 작성 내용을 그대로 들고 있다(돌려주는 것은 오류 문장뿐).
 */

export interface EaResult<T = undefined> {
  ok: boolean
  error?: string
  data?: T
}

const UUID = /^[0-9a-f-]{36}$/i
const REQ = /^[A-Za-z0-9_-]{8,80}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const t = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

async function run<T>(fn: () => Promise<T>): Promise<EaResult<T>> {
  try {
    const data = await fn()
    revalidatePath('/e-approval')
    revalidatePath('/me')
    return { ok: true, data }
  } catch (e) {
    console.error('[e-approval]', e)
    return { ok: false, error: eaErrorText(e) }
  }
}

function cleanLine(v: unknown): EaLineEntry[] {
  if (!Array.isArray(v)) return []
  return v.slice(0, 10).map((x) => {
    const e = x as Partial<EaLineEntry>
    const kind = e.kind === 'agree' ? 'agree' : 'approve'
    return e.role === 'Chairman' ? { role: 'Chairman', kind } : { user_id: UUID.test(String(e.user_id)) ? String(e.user_id) : '', kind }
  })
}
function cleanRefs(v: unknown): EaRefEntry[] {
  if (!Array.isArray(v)) return []
  return v
    .slice(0, 30)
    .map((x) => x as Partial<EaRefEntry>)
    .filter((x) => UUID.test(String(x.user_id)))
    .map((x) => ({ user_id: String(x.user_id), kind: x.kind === 'viewer' ? 'viewer' : 'cc' }))
}
function cleanDraft(i: EaDraftInput): EaDraftInput {
  const fields: Record<string, string> = {}
  for (const [k, v] of Object.entries(i.fields ?? {}).slice(0, 40)) if (/^[a-z][a-z0-9_]{0,30}$/.test(k)) fields[k] = t(v, 2000)
  return {
    doc_id: i.doc_id && UUID.test(i.doc_id) ? i.doc_id : null,
    business_id: /^[a-z0-9_]{2,40}$/.test(i.business_id) ? i.business_id : '',
    form_key: /^[a-z][a-z0-9_]{1,30}$/.test(i.form_key) ? i.form_key : '',
    title: t(i.title, 200),
    body: t(i.body, 20000),
    fields,
    line: cleanLine(i.line),
    refs: cleanRefs(i.refs),
    due_date: i.due_date && DATE.test(i.due_date) ? i.due_date : null,
    wish_date: i.wish_date && DATE.test(i.wish_date) ? i.wish_date : null,
    followup_assignee: i.followup_assignee && UUID.test(i.followup_assignee) ? i.followup_assignee : null,
    related: (i.related ?? []).filter((r) => UUID.test(r)).slice(0, 20),
  }
}

export async function eaSaveDraft(input: EaDraftInput): Promise<EaResult<string>> {
  return run(async () => (await eaStore()).saveDraft(cleanDraft(input)))
}

/** 저장 뒤 상신(작성 화면의 «상신» 한 번). 저장은 됐는데 상신이 막히면 문서는 임시저장으로 남고 문서 id를 돌려준다. */
export async function eaSaveAndSubmit(input: EaDraftInput, req: string): Promise<EaResult<{ doc_id: string; doc_no?: string }>> {
  if (!REQ.test(req)) return { ok: false, error: '요청 모양이 맞지 않습니다.' }
  let docId: string | null = null
  try {
    const store = await eaStore()
    docId = await store.saveDraft(cleanDraft(input))
    const no = await store.submit(docId, req)
    revalidatePath('/e-approval')
    revalidatePath('/me')
    return { ok: true, data: { doc_id: docId, doc_no: no } }
  } catch (e) {
    revalidatePath('/e-approval')
    return { ok: false, error: eaErrorText(e), data: docId ? { doc_id: docId } : undefined }
  }
}

export async function eaDeleteDraft(docId: string): Promise<EaResult> {
  if (!UUID.test(docId)) return { ok: false, error: '문서를 찾지 못했습니다.' }
  return run(async () => {
    await (await eaStore()).deleteDraft(docId)
    return undefined
  })
}

export async function eaAct(docId: string, seq: number, action: 'approve' | 'reject', comment: string, req: string): Promise<EaResult<string>> {
  if (!UUID.test(docId) || !Number.isInteger(seq) || !REQ.test(req) || (action !== 'approve' && action !== 'reject')) return { ok: false, error: '요청 모양이 맞지 않습니다.' }
  if (action === 'reject' && t(comment, 2000).length < 2) return { ok: false, error: '반려 사유를 두 글자 이상 적어 주세요.' }
  return run(async () => (await eaStore()).act(docId, seq, action, t(comment, 2000) || null, req))
}

export async function eaWithdraw(docId: string, req: string): Promise<EaResult> {
  if (!UUID.test(docId) || !REQ.test(req)) return { ok: false, error: '요청 모양이 맞지 않습니다.' }
  return run(async () => {
    await (await eaStore()).withdraw(docId, req)
    return undefined
  })
}

export async function eaResubmit(docId: string): Promise<EaResult<string>> {
  if (!UUID.test(docId)) return { ok: false, error: '문서를 찾지 못했습니다.' }
  return run(async () => (await eaStore()).resubmit(docId))
}

export async function eaRefMark(docId: string, confirm: boolean): Promise<EaResult> {
  if (!UUID.test(docId)) return { ok: false, error: '문서를 찾지 못했습니다.' }
  return run(async () => {
    await (await eaStore()).refMark(docId, confirm)
    return undefined
  })
}

export async function eaFollowup(docId: string, status: EaFollowupStatus, result: string, slip: string, req: string): Promise<EaResult> {
  if (!UUID.test(docId) || !REQ.test(req) || !['waiting', 'doing', 'done'].includes(status)) return { ok: false, error: '요청 모양이 맞지 않습니다.' }
  return run(async () => {
    await (await eaStore()).followupUpdate(docId, status, t(result, 2000) || null, t(slip, 60) || null, req)
    return undefined
  })
}

/**
 * 첨부 줄 — live: 브라우저가 ea-files 버킷에 «<문서>/<임의 이름>»으로 바로 올린 뒤 경로만(0082와 같은 길 · 요청 한도를 타지 않는다).
 * dummy: 파일 바이트를 같이 받는다(메모리).
 */
export async function eaAddFile(form: FormData): Promise<EaResult> {
  const docId = t(form.get('doc_id'), 40)
  const path = t(form.get('path'), 200)
  const name = t(form.get('name'), 255)
  const size = Number(form.get('size'))
  const file = form.get('file')
  if (!UUID.test(docId) || !/^[0-9a-f-]{36}\/[0-9a-zA-Z._-]{1,120}$/.test(path) || !path.startsWith(`${docId}/`) || !name || !(size > 0 && size <= 20 * 1024 * 1024)) {
    return { ok: false, error: '파일 모양이 맞지 않습니다(20MB 이하).' }
  }
  return run(async () => {
    const store = await eaStore()
    const bytes = store.mode === 'dummy' && file instanceof File ? new Uint8Array(await file.arrayBuffer()) : undefined
    await store.fileAdd(docId, path, name, size, t(form.get('mime'), 100) || null, bytes)
    return undefined
  })
}

export async function eaRemoveFile(fileId: string): Promise<EaResult> {
  if (!UUID.test(fileId)) return { ok: false, error: '파일을 찾지 못했습니다.' }
  return run(async () => {
    await (await eaStore()).fileRemove(fileId)
    return undefined
  })
}

export async function eaSaveProxy(proxy: string, from: string, to: string, forms: string[] | null, max: number | null): Promise<EaResult> {
  if (!UUID.test(proxy) || !DATE.test(from) || !DATE.test(to)) return { ok: false, error: '대결자와 기간을 확인해 주세요.' }
  return run(async () => {
    await (await eaStore()).proxySave(proxy, from, to, forms?.length ? forms.filter((f) => /^[a-z][a-z0-9_]{1,30}$/.test(f)) : null, max && max > 0 ? Math.round(max) : null)
    return undefined
  })
}

export async function eaEndProxy(id: string): Promise<EaResult> {
  if (!UUID.test(id)) return { ok: false, error: '대결 설정을 찾지 못했습니다.' }
  return run(async () => {
    await (await eaStore()).proxyEnd(id)
    return undefined
  })
}

export async function eaSaveFavorite(name: string, line: EaLineEntry[], refs: EaRefEntry[]): Promise<EaResult> {
  if (t(name, 40).length < 1) return { ok: false, error: '이름을 적어 주세요.' }
  return run(async () => {
    await (await eaStore()).favoriteSave(t(name, 40), cleanLine(line), cleanRefs(refs))
    return undefined
  })
}

export async function eaDeleteFavorite(id: string): Promise<EaResult> {
  if (!UUID.test(id)) return { ok: false, error: '찾지 못했습니다.' }
  return run(async () => {
    await (await eaStore()).favoriteDelete(id)
    return undefined
  })
}

export async function eaSaveNotify(n: EaMySettings['notify']): Promise<EaResult> {
  return run(async () => {
    await (await eaStore()).settingsSave({ turn: !!n.turn, result: !!n.result, followup: !!n.followup, ref: !!n.ref })
    return undefined
  })
}

export async function eaSaveForm(f: Omit<EaForm, 'version' | 'sort_order'>): Promise<EaResult<number>> {
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(f.form_key) || t(f.name_ko, 40).length < 1) return { ok: false, error: '양식 키 · 이름을 확인해 주세요.' }
  return run(async () => (await eaStore()).formSave({ ...f, name_ko: t(f.name_ko, 40), note: t(f.note, 300) || null, followup_kind: t(f.followup_kind, 40) || null }))
}

export async function eaSaveRule(r: Omit<EaLineRule, 'rule_id'> & { rule_id: string | null }): Promise<EaResult> {
  if (!(r.min_amount >= 0)) return { ok: false, error: '금액을 확인해 주세요.' }
  return run(async () => {
    await (await eaStore()).ruleSave({ ...r, rule_id: r.rule_id && UUID.test(r.rule_id) ? r.rule_id : null, note: t(r.note, 200) || null })
    return undefined
  })
}
