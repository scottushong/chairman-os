import 'server-only'

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import Anthropic from '@anthropic-ai/sdk'

import { ExtractError, extractAttachment, type Extracted } from '@/lib/attachments/extract'
import { unreadableMessage } from '@/lib/attachments/limits'
import { aiModel } from '@/lib/attachments/summarize'
import { estimateCostUsd } from '@/lib/ai/pricing'
import type { AuditActor, ChairmanRepository } from '@/lib/repository'
import type { IntakeRow } from '@/types'

import { MIX_RATIO_MESSAGE, MIX_RULE_LABEL_KO, detectMixRatio } from './mix-ratio'
import { INTAKE_SCHEMA, dummyIntakeProposal, parseIntakeProposal } from './proposal'

/**
 * 입구 «읽기» — 서버 액션이 부른다. 호출자의 세션(repo)으로 읽고 적는다. **순서가 약속이다**(설계서 A1-2 · A5):
 *
 *   ① 막힌 줄(끈적한 AI 차단 · no_ai)은 여기서 끝 — 파일도 모델도 건드리지 않는다.
 *   ② 상태 «읽는 중»(0058: 이 순간 재업로드 창이 닫힌다). 올린 사람 · 회장이 아니면 «내려받기» 감사(0045 읽기 통행증)를 먼저.
 *   ③ 서버에서 추출(extract.ts — 저장하지 않는다). 실패 → «이 파일은 아직 읽을 수 없습니다 — ‹이유›. 파일은 올라갔습니다.»
 *   ④ **글자층이 있으면 배합비 감지(결정적)** — 걸리면 AI를 부르지 않고 no_ai/mix_ratio. 확인(attest) 뒤 다시 읽을 때도
 *      매번 돈다(0058 재리뷰 N1 — 확인은 사진 · 스캔본의 1차 문일 뿐, 글자 파일의 감지를 건너뛰지 않는다).
 *      글자층이 없으면(사진 · 스캔 PDF) 올린 사람의 «배합비 아님» 확인이 있어야 한다 — 없으면 no_ai/not_attested.
 *   ⑤ 키가 없으면 dummy는 결정적 가짜 제안(«DUMMY»), live는 실패로 남긴다.
 *   ⑥ 키가 있으면 **먼저** «외부 AI 전송» 감사(0058 record_attachment_ai_send — 제외 대상 · 차단이면 DB가 42501로 던진다),
 *      그다음 **바이트를 다시 읽어**(감사 뒤의 바이트가 AI로 가는 바이트) ③의 바이트와 sha256이 같은지 본다. 모델은 한 번.
 *      ai_usage_log(feature intake_classify).
 *   ⑦ 모델이 mix_ratio라고 하면 제안을 버리고 no_ai/mix_ratio(이미 보낸 것은 되돌릴 수 없다 — 그래서 1차 문이 사람 · 감지다).
 *   ⑧ 무엇이 실패해도 던지지 않는다 — 올리기는 끝났다. 상태 failed + 문장을 돌려준다(«직접 종류 고르기»가 선다).
 *
 * ③의 바이트는 서버 메모리에서 감지에만 쓰고 버린다 — AI로 가는 것은 ⑥에서 감사 뒤에 다시 읽은 바이트다.
 */

const PROMPT_FILE = join(process.cwd(), 'src', 'lib', 'ai', 'prompts', 'intake-classify.md')
let promptCache: Promise<string> | null = null
const loadPrompt = () => (promptCache ??= readFile(PROMPT_FILE, 'utf8'))

/** 분류에 보내는 글의 천장 — 종류 판단 · 표지 칸이면 앞부분으로 충분하다(요약과 달리 구간 나누기 없음). */
const CLASSIFY_MAX_CHARS = 60_000
const MAX_OUTPUT_TOKENS = 800

export interface ReadResult {
  status: 'proposed' | 'no_ai' | 'failed'
  /** 사람에게 보일 문장(실패 · 배합비 안내). */
  message?: string
}

const short = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300)
const sha = (b: ArrayBuffer) => createHash('sha256').update(Buffer.from(b)).digest('hex')

function content(fileName: string, x: Extracted): Anthropic.MessageParam['content'] {
  if (x.kind === 'image') {
    return [
      { type: 'image', source: { type: 'base64', media_type: x.mediaType, data: x.base64 } },
      { type: 'text', text: JSON.stringify({ mode: 'image', file_name: fileName }) },
    ]
  }
  if (x.kind === 'pdf') {
    return [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: x.base64 } },
      { type: 'text', text: JSON.stringify({ mode: 'scanned_pdf', file_name: fileName, pages: x.pages }) },
    ]
  }
  const whole = x.units.join('\n\n')
  return JSON.stringify({ mode: 'document', file_name: fileName, truncated: whole.length > CLASSIFY_MAX_CHARS, text: whole.slice(0, CLASSIFY_MAX_CHARS) })
}

async function classify(client: Anthropic, model: string, body: Anthropic.MessageParam['content']): Promise<{ json: unknown; input: number; output: number }> {
  const system = await loadPrompt()
  const params = { model, max_tokens: MAX_OUTPUT_TOKENS, system, messages: [{ role: 'user' as const, content: body }] }
  let res: Anthropic.Message
  try {
    res = await client.messages.create({ ...params, output_config: { format: { type: 'json_schema', schema: INTAKE_SCHEMA } } })
  } catch (e) {
    // 구조 강제를 모르는 모델(AI_MODEL로 옛 모델을 고른 경우)만 한 번 물러선다 — summarize.ts와 같은 규칙.
    if (!(e instanceof Anthropic.BadRequestError) || !/output_config|format|schema/i.test(e.message)) throw e
    res = await client.messages.create({ ...params, system: `${system}\n\n반드시 다음 JSON 스키마에 맞는 JSON 객체 하나만 출력한다. 코드블록 표시 없이.\n${JSON.stringify(INTAKE_SCHEMA)}` })
  }
  if (res.stop_reason === 'refusal') throw new Error('모델이 분류를 거절했습니다.')
  if (res.stop_reason === 'max_tokens') throw new Error('분류 결과가 길이 한도에서 잘렸습니다.')
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  try {
    return { json: JSON.parse(text), input: res.usage.input_tokens, output: res.usage.output_tokens }
  } catch {
    throw new Error('분류 결과를 읽지 못했습니다(JSON 아님).')
  }
}

/**
 * opts.chairmanOverrodeMix — 대표가 배합비 감지(ⓑ · ⓐ+ⓒ)를 «배합비 아님»으로 풀고 다시 읽을 때만 참(F3: 지분표 · 영양성분표 같은
 * 잘못 걸음). 그때만 결정적 감지를 건너뛴다 — 모델의 mix_ratio 판정(⑦)은 그대로 걸린다.
 */
export async function readIntake(
  repo: ChairmanRepository,
  itemId: string,
  actor: AuditActor,
  opts: { chairmanOverrodeMix?: boolean } = {},
): Promise<ReadResult> {
  const item: IntakeRow | null = await repo.getIntakeItem(itemId)
  if (!item) return { status: 'failed', message: '입구 줄을 찾지 못했습니다(없거나 볼 권한이 없습니다).' }
  // ① 막힌 줄 · 적재된 줄은 읽지 않는다.
  if (item.ai_blocked_reason || item.status === 'no_ai') return { status: 'no_ai', message: '«AI 안 보냄»으로 막힌 파일입니다.' }
  if (item.status === 'loaded' || item.status === 'discarded') return { status: 'failed', message: '이미 처리한 입구 줄입니다.' }
  const a = await repo.getAttachment(item.attachment_id)
  if (!a) return { status: 'failed', message: '원본 파일을 찾지 못했습니다(없거나 볼 권한이 없습니다).' }

  const set = (patch: Parameters<ChairmanRepository['updateIntakeItem']>[1]) => repo.updateIntakeItem(itemId, patch, actor)
  const fail = async (message: string): Promise<ReadResult> => {
    try {
      await set({ status: 'failed' })
    } catch (e) {
      console.error('[intake] 실패 상태를 적지 못했다', e)
    }
    return { status: 'failed', message }
  }
  const block = async (reason: 'mix_ratio' | 'not_attested', message: string): Promise<ReadResult> => {
    await set({ status: 'no_ai', no_ai_reason: reason })
    return { status: 'no_ai', message }
  }

  try {
    // ② 읽는 중 — 재업로드 창이 닫힌다(0058). 올린 사람 · 회장이 아니면 내려받기 감사가 통행증이다(0045).
    if (item.status !== 'reading') await set({ status: 'reading' })
    if (a.uploaded_by !== actor.user_id && actor.role !== 'Chairman') {
      if (!(await repo.downloadAttachment(a.attachment_id))) return fail('원본 파일을 열 수 없습니다(볼 권한이 없습니다).')
    }
    // ③ 서버 추출 — 메모리에서만.
    const first = await repo.readAttachmentObject(a.storage_path)
    const extracted = await extractAttachment(first, a.mime)

    // ④ 배합비 — 글자층이 있으면 결정적 감지(매번), 없으면 올린 사람의 확인.
    if (extracted.kind === 'text') {
      const v = opts.chairmanOverrodeMix && actor.role === 'Chairman' ? { hit: false, rule: null } : detectMixRatio(extracted.units)
      if (v.hit) return block('mix_ratio', `${MIX_RATIO_MESSAGE} (규칙: ${MIX_RULE_LABEL_KO[v.rule!]})`)
    } else if (!item.mix_attested_at) {
      return block('not_attested', '사진 · 스캔본은 올린 사람이 «배합비 · 레시피가 아닙니다»를 확인해야 AI가 읽습니다. 확인 전에는 종류를 직접 고를 수 있습니다.')
    }

    // ⑤ 키 없음.
    const key = process.env.ANTHROPIC_API_KEY
    if (!key) {
      if (repo.mode !== 'dummy') return fail('AI 연결(ANTHROPIC_API_KEY)이 없어 읽지 않았습니다. 종류를 직접 고르세요.')
      await set({ status: 'proposed', proposal: dummyIntakeProposal(a.file_name, new Date().toISOString()) })
      return { status: 'proposed' }
    }

    // ⑥ 감사가 먼저 — 그다음 AI로 갈 바이트를 다시 읽는다.
    const model = aiModel()
    if (!(await repo.recordAttachmentAiSend(a.attachment_id, model))) return fail('외부 AI 전송 기록을 남기지 못해 읽지 않았습니다.')
    const second = await repo.readAttachmentObject(a.storage_path)
    if (sha(second) !== sha(first)) return fail('읽는 사이에 원본이 바뀌었습니다. 다시 읽으세요')
    const forAi = extracted.kind === 'text' ? extracted : await extractAttachment(second, a.mime)

    const r = await classify(new Anthropic({ apiKey: key }), model, content(a.file_name, forAi))
    try {
      await repo.logAiUsage({
        feature: 'intake_classify',
        model,
        input_tokens: r.input,
        output_tokens: r.output,
        estimated_cost_usd: estimateCostUsd(model, r.input, r.output),
        entity_table: 'intake_items',
        entity_id: itemId,
      })
    } catch (e) {
      console.error('[intake] ai_usage_log 실패', e) // 사용량 기록이 안 된다고 제안을 버리지 않는다
    }
    const parsed = parseIntakeProposal(r.json, model, new Date().toISOString())
    // ⑦ 모델이 배합비라고 하면 제안을 버린다.
    if (parsed.mix) return block('mix_ratio', `${MIX_RATIO_MESSAGE} (AI가 배합 비율 표로 보았습니다)`)
    await set({ status: 'proposed', proposal: parsed.proposal })
    return { status: 'proposed' }
  } catch (e) {
    if (e instanceof ExtractError) return fail(unreadableMessage(e.message))
    console.error('[intake] 읽기 실패', e)
    if (/ai_excluded/.test(short(e))) return fail('AI 제외 자료입니다 — AI로 보내지 않았습니다.')
    return fail(unreadableMessage(`읽지 못했습니다: ${short(e)}`))
  }
}
