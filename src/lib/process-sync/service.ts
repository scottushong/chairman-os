import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { DATA_MODE } from '@/lib/env'
import { dummyProcessChartById } from '@/lib/repository/dummy-books'
import { dummyProcessSyncWriter } from '@/lib/repository/dummy-process-sync'
import { signInServiceAccount } from '@/lib/supabase/service-account'

import { fakeSheetsReader } from './fake'
import { googleSheetsReader, isSheetsConfigured, SheetsReadError } from './google'
import {
  runProcessSync,
  type ProcessSheetReader,
  type ProcessSyncOutcome,
  type ProcessSyncTarget,
  type ProcessSyncTrigger,
  type ProcessSyncWriter,
} from './run'

/**
 * 동기화의 앱 쪽 배선 (0071). 화면 액션 · cron이 이 파일만 부른다.
 *
 *   읽기  live = 구글 Sheets API(서비스 계정, GOOGLE_SHEETS_SA_JSON) · dummy = 가짜 시트(fake.ts)
 *   쓰기  live = AI Agent 계정으로 로그인한 세션의 RPC(process_chart_sync_apply · _fail) — service_role 아님.
 *              야간 브리핑과 같은 로그인(AI_AGENT_EMAIL · AI_AGENT_PASSWORD). 사람 세션은 이 RPC를 못 부른다(0071 머리 주석).
 *         dummy = 메모리 흉내(dummy-process-sync.ts)
 *
 * «연결 전»: live에서 서비스 계정 키가 없을 때. dummy는 가짜 시트로 늘 연결돼 있고, DUMMY_SHEETS=off면 연결 전 화면을 본다.
 */

export function sheetsConnected(): boolean {
  if (DATA_MODE === 'dummy') return process.env.DUMMY_SHEETS?.trim().toLowerCase() !== 'off'
  return isSheetsConfigured()
}

function reader(): ProcessSheetReader {
  return DATA_MODE === 'dummy' ? fakeSheetsReader() : googleSheetsReader()
}

const readErrorText = (e: unknown) =>
  e instanceof SheetsReadError || (DATA_MODE === 'dummy' && e instanceof Error) ? e.message : '구글 시트를 읽지 못했습니다.'

function rpcWriter(sb: SupabaseClient): ProcessSyncWriter {
  return {
    async apply(input) {
      const { data, error } = await sb.rpc('process_chart_sync_apply', {
        p_chart_id: input.chartId,
        p_trigger: input.trigger,
        p_requested_by: input.requestedBy,
        p_read: input.read,
        p_skipped: input.skipped,
        p_warnings: input.warnings,
        p_rows: input.rows,
      })
      if (error) throw new Error(`process_chart_sync_apply ${error.code ?? '?'}: ${error.message}`)
      const r = data as { read: number; new: number; changed: number; gone: number; skipped: number; warnings: number }
      return { read: r.read, new: r.new, changed: r.changed, gone: r.gone, skipped: r.skipped, warnings: r.warnings }
    },
    async fail(input) {
      const { error } = await sb.rpc('process_chart_sync_fail', {
        p_chart_id: input.chartId,
        p_trigger: input.trigger,
        p_requested_by: input.requestedBy,
        p_error: input.error,
      })
      if (error) throw new Error(`process_chart_sync_fail ${error.code ?? '?'}: ${error.message}`)
    },
  }
}

async function agentSession(): Promise<SupabaseClient> {
  const { sb } = await signInServiceAccount({ emailEnv: 'AI_AGENT_EMAIL', passwordEnv: 'AI_AGENT_PASSWORD', role: 'AIAgent' })
  return sb
}

async function writer(): Promise<{ writer: ProcessSyncWriter; done: () => Promise<void> }> {
  if (DATA_MODE === 'dummy') {
    return { writer: dummyProcessSyncWriter({ chartById: dummyProcessChartById }), done: async () => {} }
  }
  const sb = await agentSession()
  return { writer: rpcWriter(sb), done: async () => void (await sb.auth.signOut().catch(() => undefined)) }
}

/**
 * 사람이 누른(또는 화면을 연) 동기화. target은 **그 사람 세션으로 읽은** 탭이어야 한다 — 못 보는 탭은 호출자가 이미 걸렀고,
 * DB(process_chart_sync_gate)가 requestedBy로 한 번 더 본다.
 */
export async function syncChartFor(target: ProcessSyncTarget, trigger: Exclude<ProcessSyncTrigger, 'cron'>, userId: string): Promise<ProcessSyncOutcome> {
  if (!sheetsConnected()) return { ok: false, error: '구글 시트 연결 전입니다.' }
  let w: Awaited<ReturnType<typeof writer>>
  try {
    w = await writer()
  } catch (e) {
    console.error('[process-sync] agent sign-in', e instanceof Error ? e.message : e)
    return { ok: false, error: '동기화 계정에 로그인하지 못했습니다. 관리자에게 알려 주세요.' }
  }
  try {
    return await runProcessSync({ target, trigger, requestedBy: userId, reader: reader(), writer: w.writer, readErrorText })
  } finally {
    await w.done()
  }
}

/** 새벽 cron — 시트가 연결된 모든 탭. 탭 하나가 실패해도 나머지는 돈다. */
export async function syncAllCharts(): Promise<{ chart_id: number; team: string; ok: boolean; error?: string }[]> {
  if (!sheetsConnected()) return []
  if (DATA_MODE === 'dummy') return []
  const sb = await agentSession()
  try {
    const { data, error } = await sb.rpc('process_chart_sync_targets')
    if (error) throw new Error(`process_chart_sync_targets ${error.code ?? '?'}: ${error.message}`)
    const targets = (data ?? []) as ProcessSyncTarget[]
    const w = rpcWriter(sb)
    const out: { chart_id: number; team: string; ok: boolean; error?: string }[] = []
    for (const t of targets) {
      const r = await runProcessSync({ target: t, trigger: 'cron', requestedBy: null, reader: reader(), writer: w, readErrorText })
      out.push({ chart_id: t.chart_id, team: t.team_name, ok: r.ok, ...(r.ok ? {} : { error: r.error }) })
    }
    return out
  } finally {
    await sb.auth.signOut().catch(() => undefined)
  }
}
