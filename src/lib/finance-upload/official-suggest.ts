import type { AccountSection } from '@/types'

import type { OfficialAiSuggestion, OfficialDraft } from './doc-read'
import { cleanLabel, GROUP_SECTIONS, plain, type OfficialGroup } from './official-lines'

/**
 * 공식 결산 계정 맞추기 2차 — 순수 부분(AI에 보낼 줄 고르기 · 시험용 가짜). 진짜 호출은 official-ai.ts(server-only).
 */

export interface SuggestAccount {
  account_code: string
  name: string
  section: AccountSection
}

export interface SuggestInput {
  lines: { line: number; label: string; group: OfficialGroup | null }[]
  accounts: SuggestAccount[]
  deadline?: number
}

export type OfficialSuggester = (input: SuggestInput) => Promise<{ items: OfficialAiSuggestion[]; calls: number }>

/** AI에 물을 줄 — 코드가 못 맞췄고 «넣지 않음»이 아닌 줄(번호를 뗀 이름 · 묶음만, 숫자 없음). */
export function linesToAsk(draft: OfficialDraft): SuggestInput['lines'] {
  return draft.lines
    .map((l, line) => ({ l, line }))
    .filter(({ l }) => !l.skip && !l.account_code)
    .map(({ l, line }) => ({ line, label: cleanLabel(l.label).name.slice(0, 60), group: l.group }))
}

const bigrams = (s: string) => new Set(Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2)))

/**
 * 시험용 가짜(FINANCE_UPLOAD_AI_MOCK=1) — 같은 묶음 계정 중 두 글자 조각이 가장 많이 겹치는 것을 «믿음 낮음»으로.
 * 겹치는 조각이 없으면 null(지어내지 않는다).
 */
export const mockOfficialSuggester: OfficialSuggester = async ({ lines, accounts }) => {
  const items = lines.map(({ line, label, group }) => {
    const pool = group ? accounts.filter((a) => GROUP_SECTIONS[group].includes(a.section)) : accounts
    const want = bigrams(plain(label))
    let best: SuggestAccount | null = null
    let score = 0
    for (const a of pool) {
      const n = [...bigrams(plain(a.name))].filter((b) => want.has(b)).length
      if (n > score) {
        best = a
        score = n
      }
    }
    return { line, account_code: best?.account_code ?? null, confidence: 'low' as const }
  })
  return { items, calls: lines.length ? 1 : 0 }
}
