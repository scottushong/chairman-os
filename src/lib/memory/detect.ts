/**
 * 기억 엔진 — 새 정보를 앞 정보와 견줘 «바뀐 것 같은 것»을 찾는다(순수 · 지시문 Step 6 · Case B).
 * 찾기만 한다: 앞 정보를 지우거나 바꾸지 않는다 — 결과는 검토함(change_detected · conflict)으로만 간다.
 * 같은 대상(회사 · 바깥 회사 · 프로젝트 · 사람)에 이어진 열린 약속 · 결정 · 업무 · 주장 중, 같은 일(낱말 겹침)인데
 * 기한(날짜 · 달) · 금액 · 담당자가 다르면 후보. 서로 모순되는 주장을 AI가 고르지 않는다 — 사람에게 묻는다.
 */
import { resolveDue } from './dates'
import type { LinkTargetType, MemoryType, PriorItem, Priority } from './types'

export interface NewItemForDetect {
  ref: string
  memory_type: MemoryType
  content: string
  due_text: string | null
  due_date: string | null
  amount_text: string | null
  who_text: string | null
  targets: { target_type: LinkTargetType; target_id: string }[]
}

export interface Detected {
  item_ref: string
  related_item_id: string
  kind: 'due' | 'amount' | 'owner' | 'decision'
  title: string
  before: string
  after: string
  priority: Priority
  /** 같은 일의 앞 바뀜이 이미 몇 번 있었나(반복 지연) */
  repeats: number
}

const WATCH: MemoryType[] = ['commitment', 'decision', 'task', 'claim', 'proposal']
// 같은 일로 보는 낱말 묶음(앞 · 새 글에 한쪽씩 있어도 같은 일)
const SYNONYMS: string[][] = [
  ['납품', '납기', '배송', '출하', '선적', 'delivery', 'shipment'],
  ['담당', '담당자', '책임자', 'owner', 'manager'],
  ['투자', '투자금', '출자', 'investment'],
  ['가격', '단가', '견적', 'price'],
  ['계약', '계약서', 'contract'],
  ['방문', '출장', 'visit'],
  ['채용', '입사', 'hire'],
]
const STOP = new Set(['오늘', '다시', '이번', '다음', '그리고', '하지만', '했다', '한다', '있다', '없다', '가능성', '변경', '예정', '정도', '관련', '대해', '우리', '회사', '미팅', '회의'])
const PARTICLE = /(은|는|이|가|을|를|에|에서|에게|께|과|와|의|도|로|으로|까지|부터|만|이다|였다|했다|한다|하기로|하고|하는|해야|될|되는|된)$/

/** 낱말 묶음(조사 떼기 · 동의어는 묶음 머리로). */
export function keywords(s: string): Set<string> {
  const out = new Set<string>()
  for (const raw of s.toLowerCase().split(/[^0-9a-z가-힣]+/)) {
    let w = raw
    for (let i = 0; i < 2; i++) w = w.replace(PARTICLE, '')
    if (w.length < 2 || STOP.has(w) || /^\d+월?$/.test(w)) continue
    const syn = SYNONYMS.find((g) => g.some((x) => w.startsWith(x)))
    out.add(syn ? syn[0] : w)
  }
  return out
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0
  for (const x of a) if (b.has(x)) n++
  return n
}

function dueOf(text: string | null, date: string | null, at: string): { date: string | null; month: string | null } {
  if (date) return { date, month: date.slice(0, 7) }
  if (!text) return { date: null, month: null }
  const r = resolveDue(text, at)
  return { date: r.date, month: r.month }
}

const monthKo = (ym: string) => `${Number(ym.slice(5, 7))}월`
const dueLabel = (d: { date: string | null; month: string | null }, raw: string | null) =>
  d.date ? d.date : d.month ? monthKo(d.month) : (raw ?? '기한 없음')

function amountValue(s: string | null): number | null {
  if (!s) return null
  const m = /(\d[\d,]*(?:\.\d+)?)\s?(억|만|천)?/.exec(s)
  if (!m) return null
  const n = Number(m[1].replace(/,/g, ''))
  const mul = m[2] === '억' ? 1e8 : m[2] === '만' ? 1e4 : m[2] === '천' ? 1e3 : 1
  return n * mul
}

/**
 * @param fresh  이번 기록의 새 정보(대상 포함)
 * @param prior  같은 대상에 이어진 앞 정보(다른 기록 · 열린 것)
 * @param capturedAt 이번 기록 시각(상대 날짜 해석)
 */
export function detectChanges(fresh: NewItemForDetect[], prior: PriorItem[], capturedAt: string): Detected[] {
  const out: Detected[] = []
  for (const n of fresh) {
    if (!WATCH.includes(n.memory_type) || n.targets.length === 0) continue
    const nk = keywords(n.content)
    const nd = dueOf(n.due_text, n.due_date, capturedAt)
    for (const p of prior) {
      if (!WATCH.includes(p.memory_type) || p.lifecycle_status !== 'open' || p.verification_status === 'rejected') continue
      const shared = p.targets.some((t) => n.targets.some((x) => x.target_type === t.target_type && x.target_id === t.target_id && t.target_type !== 'person'))
      if (!shared) continue
      const pk = keywords(p.content)
      const same = overlap(nk, pk) >= 1
      if (!same) continue
      const pd = dueOf(p.due_text, p.due_date, p.captured_at)
      const repeats = prior.filter((x) => x.item_id !== p.item_id && x.lifecycle_status === 'superseded' && overlap(keywords(x.content), pk) >= 1).length

      // 기한이 다르다(날짜끼리 또는 달끼리)
      const dueDiff = (nd.date && pd.date && nd.date !== pd.date) || (nd.month && pd.month && nd.month !== pd.month && !(nd.date && pd.date && nd.date === pd.date))
      if (dueDiff) {
        const before = dueLabel(pd, p.due_text)
        const after = dueLabel(nd, n.due_text)
        const later = (nd.date ?? `${nd.month}-99`) > (pd.date ?? `${pd.month}-99`)
        out.push({
          item_ref: n.ref,
          related_item_id: p.item_id,
          kind: 'due',
          title: `예정 시점이 ${before}에서 ${after}(으)로 ${later ? '늦춰진' : '바뀐'} 것으로 보입니다. 바뀜 확정 여부를 확인해야 합니다.`,
          before,
          after,
          priority: repeats >= 1 && later ? 'high' : later ? 'medium' : 'medium',
          repeats,
        })
        continue
      }
      const na = amountValue(n.amount_text)
      const pa = amountValue(p.amount_text)
      if (na !== null && pa !== null && na !== pa) {
        out.push({
          item_ref: n.ref,
          related_item_id: p.item_id,
          kind: 'amount',
          title: `금액이 ${p.amount_text}에서 ${n.amount_text}(으)로 다르게 기록되었습니다. 어느 쪽이 맞는지 확인해야 합니다.`,
          before: p.amount_text ?? '',
          after: n.amount_text ?? '',
          priority: 'high',
          repeats,
        })
        continue
      }
      if (n.who_text && p.who_text && n.who_text !== p.who_text && (nk.has('담당') || pk.has('담당'))) {
        out.push({
          item_ref: n.ref,
          related_item_id: p.item_id,
          kind: 'owner',
          title: `담당이 ${p.who_text}에서 ${n.who_text}(으)로 바뀐 것으로 보입니다. 확인해야 합니다.`,
          before: p.who_text,
          after: n.who_text,
          priority: 'medium',
          repeats,
        })
        continue
      }
      if (n.memory_type === 'decision' && p.memory_type === 'decision' && p.verification_status === 'confirmed' && overlap(nk, pk) >= 2) {
        out.push({
          item_ref: n.ref,
          related_item_id: p.item_id,
          kind: 'decision',
          title: '확정된 앞 결정과 다른 결정이 기록되었습니다. 앞 결정을 바꾸는지 확인해야 합니다.',
          before: p.content.slice(0, 120),
          after: n.content.slice(0, 120),
          priority: 'high',
          repeats,
        })
      }
    }
  }
  // 같은 (새 정보, 앞 정보) 쌍은 한 번
  const seen = new Set<string>()
  return out.filter((d) => (seen.has(`${d.item_ref}:${d.related_item_id}`) ? false : (seen.add(`${d.item_ref}:${d.related_item_id}`), true)))
}
