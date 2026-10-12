/**
 * 프로세스 차트 동기화 한 번 (0071) — 읽기 → 검사 → 넣기(또는 실패 기록).
 *
 * 세 입구가 이 함수 하나를 쓴다: «지금 동기화» 버튼 · 화면 열 때(10분) · 새벽 cron. 읽는 쪽(SheetsReader)과
 * 넣는 쪽(ProcessSyncWriter)은 인터페이스라 dummy · 시험은 가짜를, live는 구글 + AI Agent 세션 RPC를 끼운다.
 * 넣는 쪽이 줄 수 · 경고를 그대로 기록한다(process_chart_syncs). 시트 내용은 AI 경로로 보내지 않는다.
 */
import type { ProcessSyncWarning } from '@/types'

import { parseProcessSheet, type ProcessSyncRow } from './parse'

export type ProcessSyncTrigger = 'button' | 'open' | 'cron'

export interface ProcessSyncTarget {
  chart_id: number
  business_id: string
  team_name: string
  sheet_id: string | null
  sheet_tab: string | null
}

export interface ProcessSyncApplyInput {
  chartId: number
  trigger: ProcessSyncTrigger
  requestedBy: string | null
  read: number
  skipped: number
  warnings: ProcessSyncWarning[]
  rows: ProcessSyncRow[]
}

export interface ProcessSyncResult {
  read: number
  new: number
  changed: number
  gone: number
  skipped: number
  warnings: number
}

export interface ProcessSyncWriter {
  apply(input: ProcessSyncApplyInput): Promise<ProcessSyncResult>
  fail(input: { chartId: number; trigger: ProcessSyncTrigger; requestedBy: string | null; error: string }): Promise<void>
}

/** 시트를 읽는 쪽. google.ts의 SheetsReader와 같은 모양(그 파일은 server-only라 여기서 import하지 않는다). */
export interface ProcessSheetReader {
  readValues(sheetId: string, tab: string | null): Promise<string[][]>
}

export type ProcessSyncOutcome =
  | { ok: true; result: ProcessSyncResult }
  | { ok: false; error: string }

/** DB가 던진 낱말 → 사람 말. 낱말이 없으면 null(호출자가 일반 문장을 고른다). */
export function processSyncErrorKo(message: string): string | null {
  if (/process_sync_too_soon/.test(message)) return '같은 팀은 1분에 한 번만 동기화합니다. 잠시 뒤에 다시 누르세요.'
  if (/process_sync_not_connected/.test(message)) return '이 탭에는 아직 시트가 연결되지 않았습니다(연결 전).'
  if (/process_sync_not_found/.test(message)) return '이 탭을 볼 수 없습니다.'
  if (/process_sync_forbidden/.test(message)) return '동기화 계정 설정이 틀렸습니다. 관리자에게 알려 주세요.'
  if (/process_sync_invalid/.test(message)) return '시트에서 읽은 줄의 모양이 틀려 넣지 않았습니다.'
  return null
}

export async function runProcessSync(opts: {
  target: ProcessSyncTarget
  trigger: ProcessSyncTrigger
  requestedBy: string | null
  reader: ProcessSheetReader
  writer: ProcessSyncWriter
  /** 읽기 오류를 사람 말로. SheetsReadError면 그 문장을, 아니면 일반 문장을 쓴다. */
  readErrorText?: (e: unknown) => string
}): Promise<ProcessSyncOutcome> {
  const { target, trigger, requestedBy, reader, writer } = opts
  if (!target.sheet_id) return { ok: false, error: '이 탭에는 아직 시트가 연결되지 않았습니다(연결 전).' }

  let values: string[][]
  try {
    values = await reader.readValues(target.sheet_id, target.sheet_tab)
  } catch (e) {
    const text = opts.readErrorText?.(e) ?? '구글 시트를 읽지 못했습니다.'
    await recordFailure(writer, target.chart_id, trigger, requestedBy, text)
    return { ok: false, error: text }
  }

  const parsed = parseProcessSheet(values)
  if (parsed.headerProblem) {
    await recordFailure(writer, target.chart_id, trigger, requestedBy, parsed.headerProblem)
    return { ok: false, error: parsed.headerProblem }
  }

  try {
    const result = await writer.apply({
      chartId: target.chart_id,
      trigger,
      requestedBy,
      read: parsed.read,
      skipped: parsed.skipped,
      warnings: parsed.warnings,
      rows: parsed.rows,
    })
    return { ok: true, result }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, error: processSyncErrorKo(message) ?? '동기화를 넣지 못했습니다.' }
  }
}

async function recordFailure(
  writer: ProcessSyncWriter,
  chartId: number,
  trigger: ProcessSyncTrigger,
  requestedBy: string | null,
  error: string,
) {
  try {
    await writer.fail({ chartId, trigger, requestedBy, error })
  } catch {
    // 기록 자체가 1분 제한 등으로 거부될 수 있다 — 화면에는 원래 실패 문장이 간다.
  }
}
