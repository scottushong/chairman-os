import type { ChairmanRepository } from '@/lib/repository'
import type { FinRow, SessionUser } from '@/types'

import { isUploadKind, kindSpec } from './kinds'
import { encodeShape, ledgerLayoutByCode, ROW_ROLES, type LedgerLayout, type RowLabel } from './ledger'
import { mapColumns, readRows, validate, type Classification } from './pipeline'
import { finUploadError, fromGrid, readStatsOf, saveTxGroupsFor } from './process'
import { blankRequired, blankWarning, withStats, type ReadStats } from './read-stats'

/**
 * 대기(needs_review) 한 건을 0085 방식으로 저장 — «보류» 카드의 «저장»(actions/finance-upload.ts applyPendingUpload)과
 * «예전 자료 가져오기»(legacy-import.ts, A2)가 같이 쓴다. 숫자는 대기에 이미 읽혀 있는 줄 그대로(AI 없음).
 * 종류를 바꾸거나 줄이 비었으면 버리기 뒤 칸 격자로 코드가 다시 읽는다. 막는 것은 DB 판정(마감 · 재고 바꾸기 · 확정 평가) 그대로.
 */

export const MATERIAL_HIDDEN = '원료 단가 · 수량은 올린 사람(올린 뒤 1시간) · 대표 · CFO · 원가 관리만 봅니다 — 이 미리보기는 넣을 수 없습니다. 파일을 다시 올려 주세요.'

const YM = /^\d{4}-(0[1-9]|1[0-2])$/

export type PendingSaveResult = { ok: true; uploadId: string; kind: string; period: string } | { ok?: undefined; error: string; code?: 'closed' | 'restricted' | 'final_exists' | 'value_state' | 'masked' | 'kind' | 'period' | 'gone' | 'used' | 'other' }

export async function savePending(
  repo: ChairmanRepository,
  user: SessionUser,
  businessId: string,
  id: string,
  pick: { kind?: string | null; period?: string | null; reason?: string | null } = {},
): Promise<PendingSaveResult> {
  const reason = pick.reason?.trim() || null
  try {
    const pending = await repo.finUploadPending(id)
    if (!pending) return { error: '이미 처리했거나 볼 수 없는 올리기입니다.', code: 'gone' }
    if (pending.masked) return { error: MATERIAL_HIDDEN, code: 'masked' }
    const upload = (await repo.listFinUploads(businessId)).find((u) => u.upload_id === id)
    if (!upload) return { error: '이미 처리했거나 볼 수 없는 올리기입니다.', code: 'gone' }
    const meta = pending.meta ?? {}
    const kind = pick.kind || upload.kind
    const period = pick.period || upload.period || ''
    if (!isUploadKind(kind)) return { error: '종류를 골라 주세요.', code: 'kind' }
    if (!YM.test(period)) return { error: '달(YYYY-MM)을 골라 주세요.', code: 'period' }
    let rows = pending.rows
    let people = pending.people ?? null
    let warnings = [...(meta.warnings ?? []), ...(meta.errors ?? [])]
    let stats: ReadStats | null = null
    if ((kind !== upload.kind || !rows.length) && pending.grid) {
      const sheet = fromGrid(upload.sheet_name ?? 'sheet', pending.grid)
      const headerRow = meta.header_row ?? 0
      const columns = mapColumns(kindSpec(kind), sheet.rows[headerRow] ?? [])
      const labels = (meta.labels ?? []).filter((l): l is RowLabel => (ROW_ROLES as readonly string[]).includes(l.role))
      const base = kind === 'ledger' ? ledgerLayoutByCode(sheet) : null
      const ledger: LedgerLayout | undefined = kind === 'ledger' ? { headerRow: base?.headerRow ?? headerRow, cols: base?.cols ?? {}, labels, headCol: base?.headCol ?? null } : undefined
      const cls: Classification = { kind, confidence: 'medium', headerRow, columns, reason: '사람이 고름', source: 'code', labels, ledger }
      const read = readRows(sheet, cls)
      if (!read.rows.length) return { error: '고른 종류로 읽었더니 넣을 줄이 없습니다 — 다른 종류를 골라 주세요(엑셀은 받은 그대로 두셔도 됩니다).', code: 'kind' }
      rows = read.rows as FinRow[]
      people = kind === 'payroll' ? (read.people as FinRow[]) : null
      const check = validate(kind, read, period)
      warnings = [...new Set([...check.errors, ...check.warnings])]
      stats = readStatsOf(read)
      // 배우기 — 시트 모양 → 사람이 고른 종류 · 칸(숫자 없음).
      if (meta.sig) await repo.saveFinUploadShape({ business_id: businessId, header_sig: meta.sig, sheet_name: upload.sheet_name ?? null, kind, column_map: encodeShape(columns, ledger ?? null) }).catch((e) => console.error('[savePending] shape', e))
    } else if (kind !== upload.kind) {
      return { error: '이 올리기는 칸 격자가 없어 종류를 바꿀 수 없습니다 — 파일을 다시 올려 주세요.', code: 'kind' }
    }
    if (!stats) {
      // 0093: 대기에 읽혀 있던 줄 그대로 — 꼭 있어야 하는 칸이 빈 줄을 다시 세고, 경고가 없으면 붙인다(조용히 저장하지 않는다).
      const lines = kind === 'payroll' && people?.length ? people : rows
      const blanks = blankRequired(kind, lines)
      const w = blankWarning(blanks)
      if (w && !warnings.some((x) => x.startsWith('꼭 있어야 하는 칸이 빈 줄'))) warnings.unshift(w)
      stats = { read: lines.length, blank: blanks.reduce((a, b) => a + b.count, 0) }
    }
    const boss = user.role === 'Chairman' || user.role === 'GroupCFO'
    const saved = await repo.finUploadSave({
      business_id: businessId, kind, period, file_name: upload.file_name, file_sha256: upload.file_sha256, sheet_name: upload.sheet_name ?? null,
      ai_confidence: upload.ai_confidence, ai_used: upload.ai_used, rows, people: boss && people?.length ? people : null, reason, upload_id: id,
      warnings: withStats(warnings, stats),
    })
    if (!boss && people?.length) await repo.finPayrollHold(saved, people).catch((e) => console.error('[savePending] payroll hold', e))
    await saveTxGroupsFor(repo, businessId, kind, period, saved, reason).catch((e) => console.error('[savePending] tx groups', e))
    return { ok: true, uploadId: saved, kind, period }
  } catch (e) {
    const m = e instanceof Error ? e.message : ''
    if (m.includes('fin_upload_closed')) return { error: '마감된 달입니다 — 대표 · CFO가 이유(2자 이상)를 적어야 저장됩니다.', code: 'closed' }
    if (m.includes('ledger_post_live') || m.includes('cost_candidate_live')) return { error: '이 자료의 줄이 장부 반영 · 원가 LOT로 이미 쓰였습니다 — 그쪽을 먼저 무효로 하세요.', code: 'used' }
    if (m.includes('fin_replace_restricted')) return { error: '이미 넣은 달의 재고 · 원료 출고를 바꾸는 것은 대표 · CFO만 합니다.', code: 'restricted' }
    if (m.includes('fin_material_hidden')) return { error: MATERIAL_HIDDEN, code: 'masked' }
    if (m.includes('fin_valuation_final_exists')) return { error: '그 구분의 확정된 평가금액이 이미 있습니다 — «재고 · 평가» 화면에서 이유를 적고 바꾸세요.', code: 'final_exists' }
    if (m.includes('fin_value_state')) return { error: '빈칸 · 0 표시가 맞지 않는 칸이 있습니다(빈칸은 0이 아닙니다).', code: 'value_state' }
    console.error('[savePending]', e)
    return { error: finUploadError(e), code: 'other' }
  }
}
