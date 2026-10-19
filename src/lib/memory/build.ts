/**
 * 기억 엔진 — 뽑은 것(AI 또는 규칙) + 이름 맞추기 + 바뀜 찾기 → memory_apply 입력(순수).
 *
 * 저장 정책(지시문 Step 7):
 *   · 정보는 모두 «초안»(draft). 회사 · 프로젝트의 정식 이름 연결만 «확정»(비파괴적). 사람은 늘 «제안» + 검토함.
 *   · 금액이 든 정보 → «금액 확인»(financial) · 결정 → «결정 확인» · 모호한 기한 → «날짜가 모호함» · 바뀜 → «바뀐 것 같음».
 *   · 업무(task)와 «내가 한 약속»은 «업무로 만들까»(task_candidate) — 승인해야 tasks에 생긴다(자동 생성 없음).
 *   · 날짜는 dates.ts가 원문 기한 말에서 확정한 것만(AI가 준 날짜는 쓰지 않는다). 근거(source_quote)는 원문에 실제로 있을 때만 남긴다.
 */
import { createHash } from 'node:crypto'

import { resolveDue } from './dates'
import { detectChanges, type Detected } from './detect'
import { findMentions, type Mention } from './match'
import { dueTextIn, type ExtractResult } from './rules'
import type { ApplyPayload, Category, LinkTargetType, MemoryDirectory, PriorItem } from './types'
import { CATEGORIES } from './types'

export interface BuildInput {
  captureId: string
  rawText: string
  capturedAt: string
  extract: ExtractResult
  engine: 'ai' | 'rule' | 'mock'
  model?: string | null
  promptVersion?: string | null
  directory: MemoryDirectory
  /** 같은 대상에 이어진 앞 정보(이번 기록 것은 빼고) — 저장소가 mentions의 대상으로 찾아 준다 */
  prior: PriorItem[]
  /** 음성만 있고 전사가 없을 때 */
  waitingTranscript?: boolean
  stats?: Record<string, unknown>
}

export const PROMPT_VERSION_RULE = 'rule-v1'

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
export const inputHash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32)

/** 이 기록의 대상(확정 · 제안 · 보류)을 연결 줄로. 사람 · 바깥 인물은 확정하지 않는다. */
function captureLinks(mentions: Mention[]): { links: ApplyPayload['links']; targetsOf: Map<string, { target_type: LinkTargetType; target_id: string }[]> } {
  const links: ApplyPayload['links'] = []
  const targetsOf = new Map<string, { target_type: LinkTargetType; target_id: string }[]>()
  for (const m of mentions) {
    if (m.target && m.decision !== 'pending') {
      links.push({
        item_ref: null,
        target_type: m.target.target_type,
        target_id: m.target.target_id,
        relationship: 'mentions',
        verification_status: m.kind === 'person' ? 'suggested' : m.decision === 'confirmed' ? 'confirmed' : 'suggested',
        confidence: m.target.score,
        mention_text: m.text.slice(0, 120),
      })
      targetsOf.set(m.text, [{ target_type: m.target.target_type, target_id: m.target.target_id }])
    } else if (m.entityName && (m.decision === 'pending' || (m.kind === 'person' && !m.target))) {
      // 신원 미확인 — 바깥 인물 · 회사(pending)로 잇는다(제안). 확정은 검토함에서.
      links.push({
        item_ref: null,
        target_type: 'entity',
        target_id: null,
        entity_type: m.kind === 'company' ? 'company' : m.kind === 'project' ? 'project' : 'person',
        display_name: m.entityName,
        relationship: 'mentions',
        verification_status: 'suggested',
        confidence: 0.4,
        mention_text: m.text.slice(0, 120),
      })
    }
  }
  return { links, targetsOf }
}

/** 원문 근거 확인 — AI가 준 인용이 원문에 없으면 버린다. */
function quoteIn(raw: string, quote: string | null): string | null {
  if (!quote) return null
  const q = norm(quote)
  if (q.length < 2) return null
  return norm(raw).includes(q) ? q.slice(0, 1000) : null
}

export function buildPayload(input: BuildInput): ApplyPayload {
  const { rawText, capturedAt, extract, directory } = input
  const mentions = findMentions(rawText, directory)
  const { links, targetsOf } = captureLinks(mentions)
  const reviews: ApplyPayload['reviews'] = []

  // 정보 단위
  const items: ApplyPayload['items'] = []
  const seen = new Set<string>()
  extract.items.slice(0, 60).forEach((it, idx) => {
    const content = norm(it.content).slice(0, 2000)
    if (!content) return
    const key = `${it.memory_type}:${content.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    const quote = quoteIn(rawText, it.source_quote)
    // 기한 말은 원문(근거 · 내용)에 있는 것만. AI의 due_text가 원문에 없으면 근거 문장에서 다시 찾는다.
    const dueText = it.due_text && norm(rawText).includes(norm(it.due_text)) ? it.due_text : dueTextIn(quote ?? content)
    const due = dueText ? resolveDue(dueText, capturedAt) : null
    const amount = it.amount_text && norm(rawText).includes(norm(it.amount_text)) ? it.amount_text : null
    items.push({
      ref: `i${idx}`,
      memory_type: it.memory_type,
      content,
      source_quote: quote,
      speaker_label: it.speaker_label,
      direction: it.direction,
      who_text: it.who_text && rawText.includes(it.who_text) ? it.who_text.slice(0, 120) : null,
      to_text: it.to_text && rawText.includes(it.to_text) ? it.to_text.slice(0, 120) : null,
      due_date: due?.date ?? null,
      due_text: dueText ? dueText.slice(0, 80) : null,
      amount_text: amount ? amount.slice(0, 80) : null,
      event_time: null,
      // 근거가 원문에 없으면 신뢰도를 낮춘다.
      confidence: Math.max(0, Math.min(1, quote ? it.confidence : it.confidence * 0.6)),
      origin: input.engine === 'ai' ? 'ai' : 'rule',
    })
    if (due?.ambiguous && (it.memory_type === 'commitment' || it.memory_type === 'task')) {
      reviews.push({
        review_type: 'date_ambiguous',
        title: `기한 «${dueText}»이(가) 정확한 날짜가 아닙니다 — 날짜를 정하거나 그대로 둡니다.`,
        proposed_change: { due_text: dueText, month: due.month, captured_at: capturedAt },
        item_ref: `i${idx}`,
        related_item_id: null,
        link_ref: null,
        priority: 'low',
        key: `date:${key}`,
      })
    }
    if (amount) {
      reviews.push({
        review_type: 'financial',
        title: `금액(${amount})이 든 기록입니다 — 확인 전에는 확정 정보로 쓰지 않습니다.`,
        proposed_change: { amount_text: amount, content },
        item_ref: `i${idx}`,
        related_item_id: null,
        link_ref: null,
        priority: 'high',
        key: `amount:${key}`,
      })
    }
    if (it.memory_type === 'decision') {
      reviews.push({
        review_type: 'decision_check',
        title: '결정으로 기록되었습니다 — 확정된 결정인지 확인합니다.',
        proposed_change: { content },
        item_ref: `i${idx}`,
        related_item_id: null,
        link_ref: null,
        priority: 'medium',
        key: `decision:${key}`,
      })
    }
    if (it.memory_type === 'task' || (it.memory_type === 'commitment' && it.direction === 'mine')) {
      const project = links.find((l) => l.target_type === 'project' && l.verification_status === 'confirmed')
      const business = links.find((l) => l.target_type === 'business' && l.verification_status === 'confirmed')
      reviews.push({
        review_type: 'task_candidate',
        title: `업무로 만들까요? — ${content.slice(0, 120)}`,
        proposed_change: {
          title: content.slice(0, 300),
          project_id: project?.target_id ?? null,
          business_id: business?.target_id ?? null,
          due_date: due?.date ?? null,
          due_text: dueText,
        },
        item_ref: `i${idx}`,
        related_item_id: null,
        link_ref: null,
        priority: due?.date ? 'medium' : 'low',
        key: `task:${key}`,
      })
    }
  })

  // 이름 확인 — 사람(늘) · 제안 · 보류는 검토함에.
  mentions.forEach((m) => {
    if (m.decision === 'confirmed') return
    const linkIndex = links.findIndex((l) => l.mention_text === m.text.slice(0, 120))
    reviews.push({
      review_type: m.kind === 'person' || m.decision === 'pending' ? 'entity_identity' : 'link_suggestion',
      title:
        m.kind === 'person'
          ? `«${m.text}»이(가) 누구인지 확인합니다${m.candidates.length > 0 ? ` — 후보 ${m.candidates.length}명` : ' — 후보 없음(새 인물로 둘 수 있음)'}.`
          : m.decision === 'pending'
            ? `«${m.text}»은(는) 등록된 회사가 아닙니다 — 기존 회사에 잇거나 새 바깥 회사로 둡니다.`
            : `«${m.text}»을(를) ${m.target?.name ?? '후보 회사'}에 이어도 되는지 확인합니다.`,
      proposed_change: {
        mention: m.text,
        kind: m.kind,
        candidates: m.candidates.map((c) => ({ target_type: c.target_type, target_id: c.target_id, name: c.name, score: c.score, why: c.why })),
        entity_name: m.entityName,
      },
      item_ref: null,
      related_item_id: null,
      link_ref: linkIndex >= 0 ? String(linkIndex) : null,
      priority: m.kind === 'person' ? 'medium' : 'low',
      key: `who:${m.kind}:${m.text.replace(/\s/g, '')}`,
    })
  })

  // 바뀜 — 이 기록의 대상(확정 · 제안 연결 · 바깥 인물 이름)을 새 정보의 대상으로 본다.
  const captureTargets = [
    ...[...targetsOf.values()].flat(),
    ...mentions.filter((m) => m.target && m.decision === 'pending').map((m) => ({ target_type: m.target!.target_type, target_id: m.target!.target_id })),
    // 바깥 인물 · 회사는 아직 id가 없을 수 있다 — 저장소가 앞 정보의 바깥 인물 대상을 «name:<이름>»으로도 넘긴다.
    ...mentions.filter((m) => m.entityName).map((m) => ({ target_type: 'entity' as const, target_id: `name:${m.entityName}` })),
  ]
  const detected: Detected[] = detectChanges(
    items.map((i) => ({ ref: i.ref, memory_type: i.memory_type, content: i.content, due_text: i.due_text, due_date: i.due_date, amount_text: i.amount_text, who_text: i.who_text, targets: captureTargets })),
    input.prior,
    capturedAt,
  )
  for (const d of detected) {
    reviews.push({
      review_type: d.kind === 'decision' ? 'conflict' : 'change_detected',
      title: d.title,
      proposed_change: { kind: d.kind, before: d.before, after: d.after, repeats: d.repeats },
      item_ref: d.item_ref,
      related_item_id: d.related_item_id,
      link_ref: null,
      priority: d.kind === 'amount' ? 'high' : d.priority,
      key: `change:${d.kind}:${d.item_ref}:${items.find((i) => i.ref === d.item_ref)?.content.toLowerCase() ?? ''}`,
    })
  }

  // 정보 ↔ 대상: 그 문장에 이름이 나오면 정보 단위에도 잇는다(사람은 제안).
  for (const it of items) {
    const text = `${it.content} ${it.source_quote ?? ''}`
    for (const m of mentions) {
      if (!text.includes(m.text) || !m.target || m.decision === 'pending') continue
      links.push({
        item_ref: it.ref,
        target_type: m.target.target_type,
        target_id: m.target.target_id,
        relationship: 'about',
        verification_status: m.kind === 'person' ? 'suggested' : m.decision === 'confirmed' ? 'confirmed' : 'suggested',
        confidence: m.target.score,
        mention_text: m.text.slice(0, 120),
      })
    }
  }

  const categories = [...new Set(extract.categories)].filter((c): c is Category => (CATEGORIES as readonly string[]).includes(c))
  return {
    summary: extract.summary ? extract.summary.slice(0, 4000) : null,
    categories: categories.length > 0 ? categories : ['other'],
    status_hint: input.waitingTranscript ? 'waiting_transcript' : null,
    runs: [
      {
        stage: 'extract',
        status: 'done',
        engine: input.engine,
        model: input.model ?? null,
        prompt_version: input.promptVersion ?? PROMPT_VERSION_RULE,
        input_hash: inputHash(rawText),
        stats: { items: items.length, mentions: mentions.length, ...(input.stats ?? {}) },
      },
      { stage: 'link', status: 'done', engine: 'rule', stats: { links: links.length } },
      { stage: 'detect', status: 'done', engine: 'rule', stats: { changes: detected.length } },
    ],
    items,
    links: links.slice(0, 120),
    reviews: reviews.slice(0, 80),
  }
}
