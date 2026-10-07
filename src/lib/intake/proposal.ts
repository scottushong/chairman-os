/**
 * 입구 분류 — 모델 출력의 모양과 해석. 순수 함수만(서버 · 검사 스크립트가 같은 함수를 본다).
 *
 * 모델은 한 번 부른다(설계서 A1-3): kind · confidence · reason + 문서 칸(B③④). 구조 출력(JSON schema).
 * kind = 'mix_ratio'면 숫자를 뽑지 않게 프롬프트가 시키고, 서버는 제안을 **버린다** — 배합비 안내로 바꾼다(A5 2차 문).
 * 재무제표 · 단가표의 숫자는 이 블록에서 뽑지 않는다(결산은 0060 · 구매는 취소) — 종류만 말한다.
 */
import {
  INTAKE_DOCUMENT_KINDS,
  INTAKE_KIND,
  type IntakeConfidence,
  type IntakeDocFields,
  type IntakeKind,
  type IntakeProposal,
} from '@/types/intake'

export const INTAKE_MODEL_KINDS = [...INTAKE_KIND, 'mix_ratio'] as const

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] } as const

export const INTAKE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'confidence', 'reason', 'title', 'counterparty', 'date', 'period', 'expiry', 'amount', 'doc_type'],
  properties: {
    kind: { type: 'string', enum: [...INTAKE_MODEL_KINDS] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reason: { type: 'string' },
    title: nullableString,
    counterparty: nullableString,
    date: nullableString,
    period: nullableString,
    expiry: nullableString,
    amount: nullableString,
    doc_type: { anyOf: [{ type: 'string', enum: ['Contract', 'Letter', 'Other'] }, { type: 'null' }] },
  },
} as const

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const t = v.replace(/\s+/g, ' ').trim().slice(0, max)
  return t || null
}

export type ParsedProposal = { mix: true } | { mix: false; proposal: IntakeProposal }

/** 모델 출력 → 제안. 모르는 종류는 'other'로, 모르는 확신은 'low'로. 문서 칸은 문서 종류일 때만 남긴다. */
export function parseIntakeProposal(json: unknown, model: string, at: string, dummy = false): ParsedProposal {
  const o = (json ?? {}) as Record<string, unknown>
  if (o.kind === 'mix_ratio') return { mix: true }
  const kind: IntakeKind = (INTAKE_KIND as readonly string[]).includes(o.kind as string) ? (o.kind as IntakeKind) : 'other'
  const confidence: IntakeConfidence = o.confidence === 'high' || o.confidence === 'medium' ? o.confidence : 'low'
  const docKind = INTAKE_DOCUMENT_KINDS.includes(kind)
  const fields: IntakeDocFields = {
    title: str(o.title, 200),
    counterparty: docKind ? str(o.counterparty, 120) : null,
    date: str(o.date, 40),
    period: docKind ? str(o.period, 80) : null,
    expiry: docKind ? str(o.expiry, 40) : null,
    amount: docKind ? str(o.amount, 80) : null,
    doc_type: docKind && ['Contract', 'Letter', 'Other'].includes(o.doc_type as string) ? (o.doc_type as string) : null,
  }
  return {
    mix: false,
    proposal: {
      kind,
      confidence,
      reason: str(o.reason, 200) ?? '이유를 받지 못했습니다',
      fields,
      model,
      ...(dummy ? { dummy: true } : {}),
      at,
    },
  }
}

/**
 * dummy 모드 + 키 없음 — 결정적 가짜 제안. 파일 이름의 낱말로 종류를 고른다(계약 · 공문 · 재무 · 단가).
 * 화면 · 권한 · 적재 흐름을 키 없이 끝까지 밟아 보려는 것이다(분류의 질을 보여 주지 않는다).
 */
export function dummyIntakeProposal(fileName: string, at: string): IntakeProposal {
  const n = fileName.toLowerCase()
  const kind: IntakeKind = /계약|contract|agreement|mou/.test(n)
    ? 'contract'
    : /공문|letter|통지|요청서/.test(n)
      ? 'official_letter'
      : /재무|결산|statement|손익|대차/.test(n)
        ? 'statement'
        : /단가|견적|price|quote|원료/.test(n)
          ? 'price_list'
          : 'other'
  const title = fileName.replace(/\.[^.]+$/, '').slice(0, 200)
  return {
    kind,
    confidence: 'low',
    reason: `[DUMMY] 파일 이름으로 고른 가짜 제안입니다 — ANTHROPIC_API_KEY가 없습니다`,
    fields: {
      title,
      counterparty: null,
      date: null,
      period: null,
      expiry: null,
      amount: null,
      doc_type: kind === 'contract' ? 'Contract' : kind === 'official_letter' ? 'Letter' : INTAKE_DOCUMENT_KINDS.includes(kind) ? 'Other' : null,
    },
    model: 'dummy',
    dummy: true,
    at,
  }
}

/** 확신 라벨. */
export const CONFIDENCE_LABEL_KO: Record<IntakeConfidence, string> = { high: '높음', medium: '보통', low: '낮음' }
