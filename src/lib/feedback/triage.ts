import 'server-only'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import Anthropic from '@anthropic-ai/sdk'

import { DEFAULT_AI_MODEL } from '@/lib/ai/anthropic'
import { estimateCostUsd } from '@/lib/ai/pricing'
import type { ChairmanRepository } from '@/lib/repository'
import type { AiFeedback, FeedbackTriage } from '@/types'

import { buildInstruction, line, lines, SCHEMA, scrub, type Draft } from './instruction'
import { feedbackSensitivity, keywordReasons } from './sensitive'

/**
 * «시스템 보완함» AI 정리(0069, 회장 결정 5) — 의견 하나(버튼) · 같은 화면 묶음(버튼 · 밤).
 *
 * ■ 보내기 전에 다시 잰다 ■ ai_excluded · 취소 줄은 보내지 않는다. 저장된 표시가 꺼져 있어도 이 자리에서
 *   feedbackSensitivity(배합비 감지 + 낱말)를 다시 돌려 걸리면 보내지 않는다(0069 셋째 겹).
 * ■ 입력은 믿지 않는 글 ■ 질문 · 답 · 의견은 <feedback> 안의 자료로만 싣는다(0069 리뷰 I1 — 답 글은 지어낼 수 있다).
 * ■ 지시문의 모양은 코드가 짓는다 ■ 모델은 현황 · 결정(늘 «회장 확인 필요») · 단계 · 최종 보고의 **재료**만 준다.
 *   ■ 보고 작성 규칙 · ■ 공통 규칙은 이 파일의 고정 글이다 — 모델이 금지 규칙을 빼먹거나 바꿀 길이 없다.
 * ■ 비밀값 · 연락처 · 원가 숫자 ■ 지울 수 있는 것(키 · 토큰 · 이메일 · 전화)은 지우고, 원가 · 배합 낱말이 남으면 저장하지 않는다
 *   (DB ai_feedback_save_triage도 거부한다).
 * ■ 실행 없음 ■ 지시문은 글이다. 이 파일 어디에도 지시문을 실행하거나 저장소 · 깃을 만지는 코드가 없다.
 * ■ 비용 ■ 호출마다 ai_usage_log(feature feedback_triage · feedback_bundle · feedback_triage_night).
 */

export const TRIAGE_FEATURES = ['feedback_triage', 'feedback_bundle', 'feedback_triage_night'] as const

export class TriageRefused extends Error {}

function parseDraft(raw: string): Draft {
  const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
  const o = JSON.parse(json) as Record<string, unknown>
  const d: Draft = {
    summary: line(o.summary, 600),
    expected: line(o.expected, 600),
    situation: lines(o.situation, 5),
    decisions: lines(o.decisions, 5),
    steps: lines(o.steps, 6),
    final_report: line(o.final_report),
    title: o.title ? line(o.title, 40) : undefined,
  }
  if (!d.summary || !d.expected || !d.situation.length || !d.steps.length || !d.final_report) throw new Error('triage_shape')
  return d
}

/** 보낼 수 있는 의견인가 — 표시 · 취소 · 다시 잰 감지. 못 보내면 이유(대표 화면 문장). */
export function sendable(f: AiFeedback): string | null {
  if (f.cancelled_at) return '쓴 사람이 취소한 의견입니다.'
  if (f.ai_excluded) return 'AI 정리 제외(민감 내용) — 직접 읽고 정리하세요.'
  if (feedbackSensitivity({ body: f.body, question: f.question, answer: f.answer }).excluded) return 'AI 정리 제외(민감 내용 다시 감지) — 직접 읽고 정리하세요.'
  return null
}

function asData(f: AiFeedback, i: number): string {
  // 쓴 사람 이름은 싣지 않는다 — 역할만(«(역할) 사용자»).
  return [
    `<feedback n="${i + 1}" id="${f.feedback_id}" screen="${f.path.split('?')[0]}" role="${f.author_role}" at="${f.created_at.slice(0, 10)}">`,
    `<question>${scrub(f.question).slice(0, 1500)}</question>`,
    `<answer>${scrub(f.answer).slice(0, 4000)}</answer>`,
    `<opinion>${scrub(f.body).slice(0, 1500)}</opinion>`,
    '</feedback>',
  ].join('\n')
}

let promptCache: Promise<string> | null = null
function prompt(): Promise<string> {
  if (!promptCache || process.env.NODE_ENV !== 'production') {
    promptCache = readFile(join(process.cwd(), 'src', 'lib', 'ai', 'prompts', 'feedback-triage.md'), 'utf8')
  }
  return promptCache
}

async function callModel(
  repo: ChairmanRepository,
  feature: (typeof TRIAGE_FEATURES)[number],
  user: string,
  entity: { table: string; id: string | null },
): Promise<{ draft: Draft; model: string }> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new TriageRefused('이 환경에는 AI 연결(ANTHROPIC_API_KEY)이 없어 정리하지 못했습니다.')
  const model = process.env.AI_MODEL?.trim() || DEFAULT_AI_MODEL
  const client = new Anthropic({ apiKey: key, timeout: 60_000, maxRetries: 1 })
  const system = await prompt()
  const res = await client.messages.create({
    model,
    max_tokens: 2500,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: user }],
  } as Anthropic.MessageCreateParamsNonStreaming)
  const read = res.usage.cache_read_input_tokens ?? 0
  const written = res.usage.cache_creation_input_tokens ?? 0
  const input = res.usage.input_tokens + read + written
  await repo
    .logAiUsage({
      feature,
      model,
      input_tokens: input,
      output_tokens: res.usage.output_tokens,
      estimated_cost_usd: estimateCostUsd(model, input, res.usage.output_tokens, { read, write: written }),
      entity_table: entity.table,
      entity_id: entity.id,
    })
    .catch((e) => console.error('[feedback-triage] ai_usage_log', e))
  const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
  return { draft: parseDraft(text), model }
}

function toTriage(d: Draft, model: string, head: string): FeedbackTriage {
  const t: FeedbackTriage = { summary: d.summary, expected: d.expected, instruction: buildInstruction(d, head), model }
  if (keywordReasons(`${t.summary}\n${t.expected}\n${t.instruction}`).length) {
    throw new TriageRefused('정리 결과에 원가 · 배합 · Vault 낱말이 섞여 저장하지 않았습니다 — 의견을 직접 읽어 주세요.')
  }
  return t
}

/** 의견 하나 — 버튼(대표 세션). */
export async function triageOne(repo: ChairmanRepository, f: AiFeedback, feature: (typeof TRIAGE_FEATURES)[number] = 'feedback_triage') {
  const why = sendable(f)
  if (why) throw new TriageRefused(why)
  const user = `의견 하나를 정리하라.\n\n${asData(f, 0)}`
  const { draft, model } = await callModel(repo, feature, user, { table: 'ai_feedback', id: f.feedback_id })
  const triage = toTriage(draft, model, `보완 의견 · ${f.path.split('?')[0]}`)
  await repo.saveAiFeedbackTriage(f.feedback_id, triage)
  return triage
}

/** 같은 화면의 의견 여럿 → 묶음 지시문 하나(버튼 · 밤). */
export async function triageBundle(repo: ChairmanRepository, rows: AiFeedback[], feature: (typeof TRIAGE_FEATURES)[number] = 'feedback_bundle') {
  const ok = rows.filter((f) => !sendable(f) && !f.bundle_id)
  if (ok.length < 2) throw new TriageRefused('묶을 수 있는 의견이 둘 이상이어야 합니다(제외 · 취소 · 이미 묶인 것 빼고).')
  const screens = new Set(ok.map((f) => f.path.split('?')[0]))
  if (screens.size !== 1) throw new TriageRefused('같은 화면의 의견만 묶습니다.')
  const screen = [...screens][0]
  const user = `같은 화면(${screen})의 의견 ${ok.length}개다. 같은 문제로 보이는 것을 하나의 지시문으로 정리하라(title 포함).\n\n${ok.map(asData).join('\n\n')}`
  const { draft, model } = await callModel(repo, feature, user, { table: 'ai_feedback_bundles', id: null })
  const triage = toTriage(draft, model, `보완 의견 묶음 ${ok.length}개 · ${screen}`)
  const title = scrub(draft.title || `${screen} 보완 ${ok.length}건`).slice(0, 60)
  const id = await repo.saveAiFeedbackBundle(
    ok.map((f) => f.feedback_id),
    title,
    triage,
  )
  return { bundle_id: id, title, triage }
}

/** 밤 묶음 정리(AIAgent 세션 — 0069 정책으로 제외 · 취소 줄은 아예 오지 않는다). 하룻밤 상한 20개. */
export async function triageNight(repo: ChairmanRepository, limit = 20): Promise<{ triaged: number; bundles: number; failed: number }> {
  const all = await repo.listAiFeedback()
  const fresh = all.filter((f) => f.status === 'new' && !f.triage && !sendable(f)).slice(0, limit)
  let triaged = 0
  let bundles = 0
  let failed = 0
  for (const f of fresh) {
    try {
      await triageOne(repo, f, 'feedback_triage_night')
      triaged++
    } catch (e) {
      failed++
      console.error('[feedback-triage] night one', f.feedback_id, e instanceof Error ? e.message : e)
    }
  }
  const byScreen = new Map<string, AiFeedback[]>()
  for (const f of fresh) {
    const k = f.path.split('?')[0]
    byScreen.set(k, [...(byScreen.get(k) ?? []), f])
  }
  for (const group of byScreen.values()) {
    if (group.length < 2) continue
    try {
      await triageBundle(repo, group, 'feedback_triage_night')
      bundles++
    } catch (e) {
      failed++
      console.error('[feedback-triage] night bundle', e instanceof Error ? e.message : e)
    }
  }
  return { triaged, bundles, failed }
}
