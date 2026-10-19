import { MONTHLY_MEMO } from '@/lib/finance-overview/checklist'
import type { ChairmanRepository } from '@/lib/repository'
import type { FinLegacyImport, FinLegacyOutcome, FinLegacySource, FinUpload, SessionUser } from '@/types'

import { savePending } from './pending-save'
import { processUpload, type DocOptions, type FileCard } from './process'

/**
 * «예전 자료 가져오기»(2026-10-20 A2) — 0082 · 0083 방식으로 들어와 0085 저장소(fin_upload_save · 공식 결산 «놓으면 저장»)에 없는 것을
 * 한 번에 옮긴다. **AI 0회**: 이미 읽어 둔 줄(대기)은 그대로, 원본 파일은 규칙 엔진(kinds · 비슷한 이름 · 저장된 열 맞춤)과 PDF 글 줄로만.
 * 대표만(서버 · DB fin_legacy_import_mark). 두 번 눌러도 다시 넣지 않는다 — 원천 자리마다 옮김 기록(0089 fin_legacy_imports) 한 줄,
 * 실패로 적힌 자리만 다음 누름에서 다시 해 본다. 0085 저장 자체도 같은 파일(해시 · 이름)을 두 번 넣지 않는다.
 *
 * 원천(결정 docs/decisions/2026-10-20-finance-legacy.md):
 *   pending  «확인 필요»에 남은 예전 대기(fin_uploads needs_review — 0085 보류 까닭이 없는 것 = 0085 전 미리보기). 읽힌 줄로 저장.
 *            종류 · 달을 모르는 것 · 마감 달은 저장하지 않고 «보류»로 남긴다(카드에서 사람이 고른다 — 마감 달 이유를 대신 적지 않는다).
 *   inbox    0082 수신함에 남은 파일(서버가 읽고 지우는 설계 — 남은 것은 처리 중 끊긴 것). 이름이 임의 id라 «예전 자료 <id>»로 읽는다.
 *            그 회사 폴더 전체(직원 폴더 포함 — 0089 읽기 정책: 대표 + 스위치 켬일 때만 · 읽기만 · 남의 파일은 지우지 않는다).
 *   evidence 0083 공식 결산 증빙 PDF(fin-official-evidence). 활성 결산이 그 증빙을 이미 쓰면 «이미 있음»(0085 재무 현황이 그 결산을 그대로 읽는다),
 *            없으면(미리보기만 하고 저장 안 한 PDF) 글 줄로 읽어 «놓으면 저장»으로.
 *   monthly  «월별 입력(CH-026)» 손입력 — 이미 장부 전표(«YYYY-MM 월별 간이 손익»)라 0085가 그대로 읽는다. 옮기지 않고(두 번 세지 않게) 기록만 · 체크표가 센다.
 */

export const LEGACY_SOURCE_KO: Record<FinLegacySource, string> = {
  pending: '«확인 필요» 예전 대기',
  inbox: '수신함에 남은 파일',
  evidence: '공식 결산 증빙 PDF',
  monthly: '월별 입력(손입력 전표)',
  run: '누름',
}
export const LEGACY_OUTCOME_KO: Record<FinLegacyOutcome, string> = {
  saved: '옮김',
  already: '이미 있음',
  held: '보류',
  failed: '실패',
  skipped: '건너뜀',
}

export interface LegacyItem {
  source: Exclude<FinLegacySource, 'run'>
  ref: string
  outcome: FinLegacyOutcome
  /** 사람 말 한 줄(숫자 원문 없음) */
  message: string
  /** 이번 누름에서 새로 한 것인가(아니면 앞 누름의 기록) */
  fresh: boolean
}

export interface LegacyImportResult {
  items: LegacyItem[]
  /** 이번 누름에서 새로 옮긴 수(원천별) */
  moved: Record<Exclude<FinLegacySource, 'run'>, number>
  /** 시간이 모자라 남긴 수 — 다시 누르면 이어서 */
  remaining: number
  /** 첫 달(다시 계산 요청) */
  months: string[]
}

export interface LegacyImportOptions {
  repo: ChairmanRepository
  user: SessionUser
  businessId: string
  /** 이 시각(ms)이 가까우면 멈추고 «남은 것»으로 */
  deadline?: number
  today?: Date
}

const key = (s: string, r: string) => `${s}|${r}`

/** 카드 여럿 → 한 결과(실패 > 보류 > 옮김 > 이미 있음). */
export function outcomeOfCards(cards: FileCard[]): { outcome: FinLegacyOutcome; message: string; months: string[] } {
  const months = [...new Set(cards.filter((c) => c.status === 'applied' && c.period && /^\d{4}-\d{2}$/.test(c.period)).map((c) => c.period!))]
  const bad = cards.find((c) => c.status === 'failed')
  if (bad) return { outcome: 'failed', message: bad.message.slice(0, 200), months }
  const refused = cards.find((c) => c.status === 'refused')
  if (refused && !cards.some((c) => c.status === 'applied')) return { outcome: 'skipped', message: refused.message.slice(0, 200), months }
  const held = cards.find((c) => c.status === 'held' || c.status === 'needs_review' || c.status === 'official' || c.status === 'later')
  if (held) return { outcome: 'held', message: held.message.slice(0, 200), months }
  if (cards.some((c) => c.status === 'applied')) {
    const c = cards.find((x) => x.status === 'applied')!
    return { outcome: 'saved', message: `${cards.filter((x) => x.status === 'applied').length}건 저장 — ${c.message.slice(0, 160)}`, months }
  }
  if (cards.length && cards.every((c) => c.status === 'duplicate')) return { outcome: 'already', message: '같은 파일이 이미 저장되어 있습니다.', months }
  return { outcome: 'skipped', message: cards[0]?.message.slice(0, 200) ?? '읽을 시트가 없습니다.', months }
}

export async function importLegacy(o: LegacyImportOptions): Promise<LegacyImportResult> {
  const { repo, user, businessId: biz } = o
  if (user.role !== 'Chairman') throw new Error('fin_legacy_denied')
  const late = () => !!o.deadline && Date.now() > o.deadline
  const log = await repo.listFinLegacyImports(biz)
  const done = new Map(log.map((r) => [key(r.source, r.source_ref), r]))
  const items: LegacyItem[] = []
  const moved = { pending: 0, inbox: 0, evidence: 0, monthly: 0 }
  const months = new Set<string>()
  let remaining = 0

  const seen = (source: LegacyItem['source'], ref: string): boolean => {
    const r = done.get(key(source, ref))
    if (!r || r.outcome === 'failed') return false
    items.push({ source, ref, outcome: r.outcome, message: r.note ?? LEGACY_OUTCOME_KO[r.outcome], fresh: false })
    return true
  }
  const mark = async (source: LegacyItem['source'], ref: string, outcome: FinLegacyOutcome, message: string, uploadId: string | null = null) => {
    await repo.markFinLegacyImport({ business_id: biz, source, source_ref: ref, outcome, upload_id: uploadId, note: message.slice(0, 300) })
    items.push({ source, ref, outcome, message, fresh: true })
    if (outcome === 'saved') moved[source] += 1
  }

  // ── 1. «확인 필요»에 남은 예전 대기 ──
  const uploads = await repo.listFinUploads(biz).catch(() => [] as FinUpload[])
  for (const u of uploads.filter((x) => x.status === 'needs_review')) {
    if (seen('pending', u.upload_id)) continue
    if (late()) {
      remaining += 1
      continue
    }
    const p = await repo.finUploadPending(u.upload_id).catch(() => null)
    // 0085 보류(종류 · 달 · 마감 …)는 이미 지금 방식이다 — 옮길 것이 아니다(카드에서 고른다).
    if (p?.meta?.hold && p.meta.hold !== 'legacy') continue
    const name = `${u.file_name}${u.sheet_name ? ` · ${u.sheet_name}` : ''}`
    if (u.kind === 'unknown' || !u.period) {
      await mark('pending', u.upload_id, 'held', `${name} — 종류 · 달을 몰라 보류(자료 올리기 «보류» 카드에서 고르면 저장)`, u.upload_id)
      continue
    }
    const r = await savePending(repo, user, biz, u.upload_id)
    if (r.ok) {
      months.add(r.period)
      await mark('pending', u.upload_id, 'saved', `${name} — ${r.period} 저장`, r.uploadId)
    } else {
      const outcome: FinLegacyOutcome = r.code === 'other' ? 'failed' : 'held'
      await mark('pending', u.upload_id, outcome, `${name} — ${r.error}`, u.upload_id)
    }
  }

  // ── 2. 0082 수신함에 남은 파일(회사 폴더 전체) · 3. 0083 증빙 PDF — 같은 «놓으면 저장» 길(processUpload)을 AI 없이 ──
  const [ledger, learned, businesses] = await Promise.all([
    repo.loadFinanceLedger().catch(() => null),
    repo.listOfficialAccountMap(biz).catch(() => []),
    repo.listBusinesses().catch(() => []),
  ])
  // PDF · 사진: 읽기 AI 없음(read null · 제안 null) — 글 PDF는 칸 위치 · 글 줄로, 스캔 · 사진은 «보류».
  const docs: DocOptions = {
    allowed: true,
    read: null,
    closed: null,
    businessName: businesses.find((b) => b.business_id === biz)?.name,
    accounts: (ledger?.accounts ?? []).filter((a) => a.business_id === biz && a.active).map((a) => ({ account_code: a.account_code, name: a.name, section: a.section })),
    learned: new Map(learned.map((m) => [m.std_key, m.account_code])),
    suggest: null,
  }
  const run = async (fileName: string, bytes: Uint8Array) =>
    processUpload({ repo, businessId: biz, fileName, bytes, classify: null, aiBudget: 0, docs, boss: true, user, today: o.today, deadline: o.deadline })

  // 그 회사 폴더 전체(직원 폴더 포함 — 0089 읽기 정책 · 대표 + 스위치). 남의 파일은 읽기만 하고 지우지 않는다.
  const inbox = await repo.finInboxListBusiness(biz).catch(() => [])
  for (const f of inbox) {
    if (seen('inbox', f.path)) continue
    if (late()) {
      remaining += 1
      continue
    }
    const base = f.path.slice(f.path.lastIndexOf('/') + 1)
    let bytes: Uint8Array
    try {
      bytes = await repo.finInboxRead(f.path)
    } catch {
      await mark('inbox', f.path, 'failed', `${base} — 수신함 파일을 읽지 못했습니다.`)
      continue
    }
    const cards = await run(`예전 자료 ${base}`, bytes).catch((e) => [{ status: 'failed', message: e instanceof Error ? e.message : '처리하지 못했습니다.' } as FileCard])
    const r = outcomeOfCards(cards)
    r.months.forEach((m) => months.add(m))
    await mark('inbox', f.path, r.outcome, `${base} — ${r.message}`, cards.find((c) => c.upload_id)?.upload_id ?? null)
  }

  const evidence = await repo.listOfficialEvidence(biz).catch(() => [] as string[])
  if (evidence.length) {
    const live = await repo.listOfficialStatements(biz, 'all').catch(() => [])
    const used = new Map(live.filter((s) => s.evidence_file).map((s) => [s.evidence_file!, s.period_key]))
    for (const path of evidence) {
      if (seen('evidence', path)) continue
      const base = path.slice(path.lastIndexOf('/') + 1)
      const short = `${base.slice(0, 8)}….${base.split('.').pop()}`
      if (used.has(path)) {
        await mark('evidence', path, 'already', `증빙 ${short} — ${used.get(path)}년 공식 결산에 이미 쓰임(재무 현황이 그대로 읽음)`)
        continue
      }
      if (late()) {
        remaining += 1
        continue
      }
      let bytes: Uint8Array
      try {
        bytes = await repo.readOfficialEvidence(path)
      } catch {
        await mark('evidence', path, 'failed', `증빙 ${short} — 증빙 파일을 읽지 못했습니다.`)
        continue
      }
      const cards = await run(`예전 결산 증빙 ${base}`, bytes).catch((e) => [{ status: 'failed', message: e instanceof Error ? e.message : '처리하지 못했습니다.' } as FileCard])
      const r = outcomeOfCards(cards)
      await mark('evidence', path, r.outcome, `증빙 ${short} — ${r.message}`)
    }
  }

  // ── 4. 월별 입력(CH-026) 전표 — 이미 장부에 있다(옮기지 않음 · 기록만) ──
  const monthly = new Map<string, string>()
  for (const e of ledger?.entries ?? []) {
    if (e.business_id !== biz || e.correction_kind) continue
    const m = MONTHLY_MEMO.exec(e.memo)
    if (m && !monthly.has(m[1])) monthly.set(m[1], e.slip_no)
  }
  for (const [month, slip] of [...monthly.entries()].sort()) {
    if (seen('monthly', month)) continue
    await mark('monthly', month, 'already', `${month} 월별 입력 — 장부 전표 ${slip}에 이미 있음(재무 현황 · 체크표가 그대로 읽음)`)
  }

  const fresh = items.filter((i) => i.fresh)
  await repo
    .markFinLegacyImport({ business_id: biz, source: 'run', source_ref: new Date().toISOString(), outcome: 'saved', upload_id: null, note: `새로 ${fresh.length}건 · 옮김 ${fresh.filter((i) => i.outcome === 'saved').length}${remaining ? ` · 남음 ${remaining}` : ''}` })
    .catch(() => false)
  for (const m of months) await repo.finRecalcRequest(biz, m).catch(() => undefined)
  return { items, moved, remaining, months: [...months].sort() }
}

/** 0082 수신함 1시간 넘은 파일 치우기 — 대표는 «예전 자료 가져오기»가 켜져 있는 동안 치우지 않는다(가져오기가 가져갈 몫 · 지우면 되돌릴 수 없다). */
export function inboxSweepAllowed(role: string | null | undefined, legacyImportOn: boolean): boolean {
  return !(role === 'Chairman' && legacyImportOn)
}

/** 화면 한 줄 요약. */
export function legacySummary(r: LegacyImportResult): string {
  const fresh = r.items.filter((i) => i.fresh)
  const by = (o: FinLegacyOutcome) => fresh.filter((i) => i.outcome === o).length
  const moved = by('saved')
  const parts = [`옮김 ${moved}`, `이미 있음 ${by('already')}`, `보류 ${by('held')}`, `실패 ${by('failed')}`]
  if (by('skipped')) parts.push(`건너뜀 ${by('skipped')}`)
  const before = r.items.length - fresh.length
  return `${fresh.length ? parts.join(' · ') : '새로 옮길 것이 없습니다'}${before ? ` (앞에서 이미 처리한 ${before}건은 건너뜀)` : ''}${r.remaining ? ` · 시간이 모자라 ${r.remaining}건 남음 — 다시 누르세요` : ''}`
}

export type { FinLegacyImport }
