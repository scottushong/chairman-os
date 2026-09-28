import 'server-only'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import Anthropic from '@anthropic-ai/sdk'

import { DEFAULT_AI_MODEL } from '@/lib/ai/anthropic'
import { estimateCostUsd } from '@/lib/ai/pricing'
import type { ChairmanRepository } from '@/lib/repository'
import type { AttachmentSummary } from '@/types'

import { ExtractError, extractAttachment, type Extracted } from './extract'

/**
 * 첨부 AI 요약 (Phase 10). 서버 액션이 부른다 — **올린 사람의 세션**(repo)으로 읽고 적는다.
 *
 * 순서가 약속이다:
 *   ① Vault면 여기서 끝 — 모델을 부르지 않는다(0045 skipped_vault). 파일도 열지 않는다.
 *   ② 상태를 «요약 중»으로 → 파일을 내려받아 메모리에서 추출(저장하지 않는다).
 *   ③ 키가 없으면 dummy는 결정적 가짜 요약(«DUMMY»), live는 실패로 남긴다(가짜를 live에 적지 않는다).
 *   ④ 키가 있으면 **먼저** «외부 AI 전송» 감사(0045 record_attachment_ai_send — Vault면 DB가 던진다),
 *      그 다음에 모델. 긴 문서는 구간별 요약 → 합치기. 호출마다 ai_usage_log.
 *   ⑤ 무엇이 실패해도 던지지 않는다 — 올리기는 이미 끝났고, 요약 실패는 «다시 요약» 한 번이면 된다.
 */

const PROMPT_FILE = join(process.cwd(), 'src', 'lib', 'ai', 'prompts', 'attachment-summary.md')
let promptCache: Promise<string> | null = null
const loadPrompt = () => (promptCache ??= readFile(PROMPT_FILE, 'utf8'))

/** 한 번에 보내는 글의 천장. 12만 자 ≈ 4~6만 토큰. 넘거나 50쪽 이상이면 구간으로 나눈다. */
const SINGLE_MAX_CHARS = 120_000
const LONG_DOC_UNITS = 50
const SECTION_CHARS = 40_000
/** 구간 수 천장 = 비용 천장. 넘는 뒷부분은 읽지 않고 «뒷부분 생략»으로 밝힌다. */
const MAX_SECTIONS = 8
const MAX_OUTPUT_TOKENS = 2_000

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'summary_ko', 'key_numbers', 'decisions_needed', 'next_actions', 'confidence', 'language'],
  properties: {
    summary: { type: 'array', items: { type: 'string' } },
    summary_ko: { type: 'array', items: { type: 'string' } },
    key_numbers: { type: 'array', items: { type: 'string' } },
    decisions_needed: { type: 'array', items: { type: 'string' } },
    next_actions: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    language: { type: 'string' },
  },
} as const

export const aiModel = () => process.env.AI_MODEL?.trim() || DEFAULT_AI_MODEL

const strings = (v: unknown, max: number, len = 300): string[] =>
  (Array.isArray(v) ? v : [])
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim().slice(0, len))
    .filter(Boolean)
    .slice(0, max)

/** 모델 출력 → 0045 attachment_summary_ok를 통과하는 모양. 넘치는 것은 자르고, 빈 요약은 거부한다. */
export function parseSummary(json: unknown): AttachmentSummary {
  const o = (json ?? {}) as Record<string, unknown>
  const summary = strings(o.summary, 3)
  if (summary.length === 0) throw new Error('요약이 비었다')
  const language = typeof o.language === 'string' ? o.language.slice(0, 10) : undefined
  const ko = strings(o.summary_ko, 3)
  const confidence = o.confidence === 'high' || o.confidence === 'medium' ? o.confidence : 'low'
  return {
    summary,
    ...(ko.length && language !== 'ko' ? { summary_ko: ko } : {}),
    key_numbers: strings(o.key_numbers, 12, 120),
    decisions_needed: strings(o.decisions_needed, 10),
    next_actions: strings(o.next_actions, 10),
    confidence,
    ...(language ? { language } : {}),
  }
}

/** 쪽(또는 장 · 시트)을 이어 붙여 SECTION_CHARS 안의 구간으로 나눈다. 한 쪽이 너무 길면 그 쪽을 자른다. */
export function sectionize(units: string[]): { sections: string[]; truncated: boolean } {
  const sections: string[] = []
  let cur = ''
  const push = () => {
    if (cur.trim()) sections.push(cur)
    cur = ''
  }
  for (const [i, raw] of units.entries()) {
    for (let at = 0; at < Math.max(raw.length, 1); at += SECTION_CHARS) {
      const piece = `[${i + 1}] ${raw.slice(at, at + SECTION_CHARS)}\n`
      if (cur.length + piece.length > SECTION_CHARS) push()
      cur += piece
    }
  }
  push()
  return { sections: sections.slice(0, MAX_SECTIONS), truncated: sections.length > MAX_SECTIONS }
}

interface Usage {
  input: number
  output: number
}

async function callModel(client: Anthropic, model: string, content: Anthropic.MessageParam['content']): Promise<{ json: unknown; usage: Usage }> {
  const system = await loadPrompt()
  const params = { model, max_tokens: MAX_OUTPUT_TOKENS, system, messages: [{ role: 'user' as const, content }] }
  let res: Anthropic.Message
  try {
    res = await client.messages.create({ ...params, output_config: { format: { type: 'json_schema', schema: SCHEMA } } })
  } catch (e) {
    // 구조 강제를 모르는 모델(AI_MODEL로 옛 모델을 고른 경우)만 한 번 물러선다 — anthropic.ts와 같은 규칙.
    if (!(e instanceof Anthropic.BadRequestError) || !/output_config|format|schema/i.test(e.message)) throw e
    res = await client.messages.create({
      ...params,
      system: `${system}\n\n반드시 다음 JSON 스키마에 맞는 JSON 객체 하나만 출력한다. 코드블록 표시 없이.\n${JSON.stringify(SCHEMA)}`,
    })
  }
  if (res.stop_reason === 'refusal') throw new Error('모델이 요약을 거절했습니다.')
  if (res.stop_reason === 'max_tokens') throw new Error('요약이 길이 한도에서 잘렸습니다.')
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const usage = { input: res.usage.input_tokens, output: res.usage.output_tokens }
  try {
    return { json: JSON.parse(text), usage }
  } catch {
    throw new Error('요약 결과를 읽지 못했습니다(JSON 아님).')
  }
}

/** 파일 하나(또는 메모 하나)를 요약한다. 긴 글은 구간 → 합치기. 호출마다 onUsage. */
async function runSummary(
  client: Anthropic,
  model: string,
  fileName: string,
  extracted: Extracted,
  onUsage: (u: Usage) => Promise<void>,
  mode: 'document' | 'memo' = 'document',
): Promise<AttachmentSummary> {
  const call = async (content: Anthropic.MessageParam['content']) => {
    const r = await callModel(client, model, content)
    await onUsage(r.usage)
    return r.json
  }

  if (extracted.kind === 'image') {
    return parseSummary(
      await call([
        { type: 'image', source: { type: 'base64', media_type: extracted.mediaType, data: extracted.base64 } },
        { type: 'text', text: JSON.stringify({ mode: 'image', file_name: fileName }) },
      ]),
    )
  }

  const whole = extracted.units.join('\n\n')
  if (whole.length <= SINGLE_MAX_CHARS && extracted.units.length < LONG_DOC_UNITS) {
    return parseSummary(await call(JSON.stringify({ mode, file_name: fileName, text: whole })))
  }

  const { sections, truncated } = sectionize(extracted.units)
  const parts: AttachmentSummary[] = []
  for (const [i, text] of sections.entries()) {
    parts.push(parseSummary(await call(JSON.stringify({ mode: 'section', file_name: fileName, part: i + 1, of: sections.length, text }))))
  }
  const merged = parseSummary(
    await call(JSON.stringify({ mode: 'merge', file_name: fileName, truncated, sections: parts })),
  )
  return { ...merged, sections: sections.length, ...(truncated ? { confidence: 'low' as const } : {}) }
}

/**
 * dummy 모드 + 키 없음 — **결정적 가짜 요약.** 같은 파일이면 늘 같은 글이 나오고, 첫 줄이 DUMMY라고
 * 밝힌다. 화면 · 권한 · 저장 경로를 키 없이 끝까지 밟아 보려는 것이다(요약의 질을 보여 주지 않는다).
 */
export function dummySummary(fileName: string, extracted: Extracted): AttachmentSummary {
  if (extracted.kind === 'image') {
    return {
      summary: [`[DUMMY] ${fileName} — 이미지 1장`, '실제 요약이 아닙니다. ANTHROPIC_API_KEY가 없어 가짜로 채웠습니다.', '키가 있으면 Claude vision이 명함 · 계약서의 글자를 읽습니다.'],
      key_numbers: [],
      decisions_needed: ['[DUMMY] 결정 필요 항목 예시'],
      next_actions: ['[DUMMY] 원본 사진 확인'],
      confidence: 'low',
      language: 'ko',
      dummy: true,
    }
  }
  const text = extracted.units.join(' ')
  const numbers = [...text.matchAll(/\d[\d,.]*\s?(?:억|만|천)?\s?(?:원|%|kg|톤|달러|USD|KRW|개|명|일|년)/g)]
    .map((m) => m[0].trim())
    .filter((v, i, all) => all.indexOf(v) === i)
    .slice(0, 5)
  const first = text.replace(/\s+/g, ' ').trim().slice(0, 90)
  return {
    summary: [
      `[DUMMY] ${fileName} — ${extracted.units.length}${extracted.unitLabel} · ${extracted.chars.toLocaleString('ko-KR')}자 추출`,
      '실제 요약이 아닙니다. ANTHROPIC_API_KEY가 없어 가짜로 채웠습니다.',
      `첫 문장: ${first}`,
    ],
    key_numbers: numbers,
    decisions_needed: ['[DUMMY] 결정 필요 항목 예시'],
    next_actions: ['[DUMMY] 원문 확인 후 담당자 지정'],
    confidence: 'low',
    language: 'ko',
    dummy: true,
    ...(extracted.units.length >= LONG_DOC_UNITS ? { sections: sectionize(extracted.units).sections.length } : {}),
  }
}

export interface SummarizeResult {
  status: 'summarized' | 'skipped_vault' | 'failed'
  error?: string
}

const short = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300)

export async function summarizeAttachment(repo: ChairmanRepository, attachmentId: string): Promise<SummarizeResult> {
  const a = await repo.getAttachment(attachmentId)
  if (!a) return { status: 'failed', error: '첨부를 찾지 못했습니다.' }
  // ① Vault — 모델도 파일도 건드리지 않는다.
  if (a.security_class === 'Vault') return { status: 'skipped_vault' }

  const fail = async (message: string): Promise<SummarizeResult> => {
    try {
      await repo.updateAttachmentSummary(attachmentId, { status: 'failed', ai_error: message })
    } catch (e) {
      console.error('[attachments] 실패 상태를 적지 못했다', e)
    }
    return { status: 'failed', error: message }
  }

  try {
    await repo.updateAttachmentSummary(attachmentId, { status: 'extracting', ai_error: null })
    const extracted = await extractAttachment(await repo.readAttachmentObject(a.storage_path), a.mime)

    const key = process.env.ANTHROPIC_API_KEY
    if (!key) {
      if (repo.mode !== 'dummy') return fail('AI 연결(ANTHROPIC_API_KEY)이 없어 요약하지 않았습니다.')
      await repo.updateAttachmentSummary(attachmentId, {
        status: 'summarized',
        ai_summary: dummySummary(a.file_name, extracted),
        ai_model: 'dummy',
        ai_error: null,
      })
      return { status: 'summarized' }
    }

    const model = aiModel()
    // ④ 감사가 먼저다. false = 못 보는 첨부. Vault는 여기서 DB가 던진다(①이 이미 막지만 두 번째 문).
    if (!(await repo.recordAttachmentAiSend(attachmentId, model))) return fail('외부 AI 전송 기록을 남기지 못해 요약하지 않았습니다.')

    const client = new Anthropic({ apiKey: key })
    const summary = await runSummary(client, model, a.file_name, extracted, async (u) => {
      try {
        await repo.logAiUsage({
          feature: 'attachment_summary',
          model,
          input_tokens: u.input,
          output_tokens: u.output,
          estimated_cost_usd: estimateCostUsd(model, u.input, u.output),
          entity_table: 'attachments',
          entity_id: attachmentId,
        })
      } catch (e) {
        // 사용량 기록이 안 된다고 요약을 버리지 않는다(0045가 아직 없는 DB 등).
        console.error('[attachments] ai_usage_log 실패', e)
      }
    })
    await repo.updateAttachmentSummary(attachmentId, { status: 'summarized', ai_summary: summary, ai_model: model, ai_error: null })
    return { status: 'summarized' }
  } catch (e) {
    if (!(e instanceof ExtractError)) console.error('[attachments] 요약 실패', e)
    return fail(e instanceof ExtractError ? e.message : `요약하지 못했습니다: ${short(e)}`)
  }
}

/** 요약을 메모 글로 — «AI로 정리» 제안과 «채우기»가 같은 모양을 쓴다. */
export function summaryToText(s: AttachmentSummary): string {
  const block = (title: string, lines: string[]) => (lines.length ? `${title}\n${lines.map((l) => `- ${l}`).join('\n')}` : '')
  return [
    block('요약', s.summary),
    block('핵심 숫자', s.key_numbers),
    block('결정 필요', s.decisions_needed),
    block('다음 행동', s.next_actions),
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * «AI로 정리» — 회장 메모를 같은 프롬프트(memo 모드)로 구조화한 **제안**. 저장하지 않는다 —
 * 회장이 받아야 메모가 바뀐다(화면이 saveInitiativeNoteAction을 부른다).
 */
export async function structureMemo(
  repo: ChairmanRepository,
  initiativeId: string,
  memo: string,
): Promise<{ text?: string; dummy?: boolean; error?: string }> {
  const text = memo.trim()
  if (!text) return { error: '정리할 메모가 없습니다.' }
  const extracted: Extracted = { kind: 'text', units: [text], unitLabel: '문서', chars: text.length }
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) {
    if (repo.mode !== 'dummy') return { error: 'AI 연결(ANTHROPIC_API_KEY)이 없어 정리하지 못했습니다.' }
    const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean)
    return {
      dummy: true,
      text: summaryToText({
        summary: ['[DUMMY] 실제 정리가 아닙니다 — 키가 없어 메모의 앞 줄을 옮겼습니다.', ...lines.slice(0, 2)],
        key_numbers: [],
        decisions_needed: [],
        next_actions: lines.slice(2, 5),
        confidence: 'low',
      }),
    }
  }
  const model = aiModel()
  try {
    const summary = await runSummary(new Anthropic({ apiKey: key }), model, '회장 메모', extracted, async (u) => {
      await repo
        .logAiUsage({
          feature: 'memo_structure',
          model,
          input_tokens: u.input,
          output_tokens: u.output,
          estimated_cost_usd: estimateCostUsd(model, u.input, u.output),
          entity_table: 'initiatives',
          entity_id: initiativeId,
        })
        .catch((e) => console.error('[attachments] ai_usage_log 실패', e))
    }, 'memo')
    return { text: summaryToText(summary) }
  } catch (e) {
    console.error('[attachments] 메모 정리 실패', e)
    return { error: `정리하지 못했습니다: ${short(e)}` }
  }
}
