import 'server-only'

import type Anthropic from '@anthropic-ai/sdk'

import type { ChairmanRepository } from '@/lib/repository'
import type { AiSource, Business, Role, SessionUser } from '@/types'

import type { ScreenSubject } from './screen'

/**
 * 어시스턴트 도구의 공통 틀.
 *
 * ■ 도구는 **질문한 사람의 repo**로만 읽는다 ■ repo는 그 사람의 쿠키로 만든 어댑터라 RLS가 그대로
 *   걸린다(Phase 9 «AI에게 묻기»와 같은 원칙). 여기서 권한을 새로 판정하지 않는다 — 다만
 *   재무([제한])는 역할로 한 번 더 막는다(dummy는 역할과 상관없이 숫자를 주므로).
 * ■ 근거 카드는 코드가 만든다 ■ 도구가 실제로 읽은 줄만 ctx.evidence에 쌓이고, 화면은 그것만 카드로
 *   그린다. 모델이 쓴 경로는 카드가 되지 않는다 — 지어낸 링크가 나갈 길이 없다.
 * ■ Vault는 읽지 않는다 ■ 어느 도구도 Vault 등급 첨부 · 문서를 싣지 않는다.
 */

/** 0013 can_read_restricted와 같은 역할 — 재무 숫자([제한])를 읽는 사람. */
export const FINANCE_ROLES: ReadonlySet<Role> = new Set<Role>(['Chairman', 'GroupCFO', 'BusinessCEO', 'Executive'])
/** 0017 initiatives_read — 이니셔티브를 읽는 사람(AIAgent는 사람 세션이 아니라 여기 없다). */
export const INITIATIVE_ROLES: ReadonlySet<Role> = new Set<Role>(['Chairman', 'GroupCFO'])

export interface ToolContext {
  repo: ChairmanRepository
  user: SessionUser
  screen: ScreenSubject
  chatId: string | null
  /** web은 제안(쓰기)까지, kakao는 읽기만 · 제한 등급 없이(DEFERRED Phase 11). */
  channel: 'web' | 'kakao'
  financeAllowed: boolean
  /** 이번 답에서 도구가 실제로 읽은 근거. 화면의 카드가 된다. */
  evidence: AiSource[]
  /** 이번 답에서 만든 제안(ai_actions) id. */
  actionIds: string[]
  /** 요청 하나 안에서 회사 목록을 한 번만 읽는다. */
  businesses(): Promise<Business[]>
}

export interface AssistantTool {
  def: Anthropic.Tool
  /**
   * 회장이 아닌 사람에게 줄 때의 설명(def.description 대신). 설명에 «회장»이 들어간 도구만 단다 —
   * 모델이 도구 설명의 말을 답에 옮기지 않게(직원 화면 용어 원칙, CLAUDE.md).
   */
  staffDescription?: string
  /** 이 사람 · 이 창구에 이 도구를 줄 것인가. 주지 않은 도구는 모델이 존재도 모른다. */
  available(ctx: ToolContext): boolean
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<unknown>
}

export function addEvidence(ctx: ToolContext, e: AiSource) {
  if (!/^\/($|[^/\\])/.test(e.href)) return
  if (ctx.evidence.some((x) => x.href === e.href && x.label === e.label)) return
  if (ctx.evidence.length < 12) ctx.evidence.push({ label: e.label.slice(0, 80), href: e.href, detail: e.detail?.slice(0, 160) })
}

export const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
export const strList = (v: unknown, max = 20): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, max) : []

/** 이름 비교용: 공백 · 괄호 · 구두점을 빼고 소문자. «VLING 24» · «vling24»가 같은 이름이 된다. */
export const norm = (s: string) => s.toLowerCase().replace(/[\s()（）·.,_\-「」'"]/g, '')

/** 회사 한 곳을 id · 이름 · id 꼬리(«vana» → biz_vana)로 찾는다. 둘 이상이 걸리면 null(추측하지 않는다). */
export function resolveBusiness(query: string, list: Business[]): Business | null {
  const q = norm(query)
  if (!q) return null
  const exact = list.find((b) => norm(b.business_id) === q || norm(b.name) === q || norm(b.business_id.replace(/^biz_/, '')) === q)
  if (exact) return exact
  const hits = list.filter((b) => norm(b.name).includes(q) || q.includes(norm(b.name)) || norm(b.business_id).includes(q))
  return hits.length === 1 ? hits[0] : null
}

/** 원 단위 금액을 사람이 읽는 말로(억 · 만). 값은 바꾸지 않고 읽는 법만 붙인다. */
export function krw(n: number): string {
  const sign = n < 0 ? '-' : ''
  const a = Math.abs(n)
  if (a >= 1e8) return `${sign}${(a / 1e8).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}억 원`
  if (a >= 1e4) return `${sign}${Math.round(a / 1e4).toLocaleString('ko-KR')}만 원`
  return `${sign}${a.toLocaleString('ko-KR')}원`
}

/** [제한] 등급을 읽었다는 감사 한 줄(0031 record_read, 5분 중복 억제는 DB가). 실패해도 답은 살린다. */
export async function auditRestrictedRead(
  ctx: ToolContext,
  what: { path: string; kind: 'finance' | 'document'; entity_table: string; entity_id?: string | null; business_id?: string | null },
) {
  await ctx.repo
    .recordRead({
      path: what.path,
      kind: what.kind,
      entity_id: what.entity_id ?? null,
      entity_table: what.entity_table,
      business_id: what.business_id ?? null,
      device: 'AI 어시스턴트',
      city: null,
    })
    .catch((e) => console.error('[assistant] 열람 감사 실패', e))
}
