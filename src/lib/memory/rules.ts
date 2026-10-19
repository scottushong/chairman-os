/**
 * 기억 엔진 — AI 없이 뽑기(규칙). MEMORY_AI_PER_DAY = 0(기본)이거나 AI가 실패 · 한도일 때 쓰는 길이다(순수).
 * AI와 같은 모양(ExtractResult)을 낸다 — 뒤 단계(이름 맞추기 · 바뀜 찾기 · 검토함)는 둘을 가리지 않는다.
 * 지어내지 않는다: 담당자 · 금액 · 기한은 원문에 있는 말만(없으면 null).
 */
import type { Category, Direction, MemoryType } from './types'

export interface ExtractedItem {
  memory_type: MemoryType
  content: string
  /** 원문에서 그대로 옮긴 근거(원문에 실제로 있어야 남는다) */
  source_quote: string | null
  speaker_label: string | null
  direction: Direction
  who_text: string | null
  to_text: string | null
  /** 원문의 기한 말(날짜 풀기는 dates.ts가) */
  due_text: string | null
  amount_text: string | null
  confidence: number
}

export interface ExtractedEntity {
  text: string
  type: 'person' | 'company' | 'project' | 'product' | 'location' | 'other'
}

export interface ExtractResult {
  summary: string | null
  categories: Category[]
  entities: ExtractedEntity[]
  items: ExtractedItem[]
}

/** 문장 나누기 — 마침표 · 물음표 · 줄바꿈 · «~다.» 끝. */
export function sentences(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/(?<=[.!?。])\s+|\n+|(?<=다)\s+(?=[가-힣A-Z0-9])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4)
}

const CATEGORY_WORDS: [Category, RegExp][] = [
  ['sales', /영업|고객|매출처|수주|견적|판매|바이어|sales|customer|order/i],
  ['hr', /인사|담당자|채용|퇴사|입사|조직|인력|평가|급여|hr\b|hire/i],
  ['investment_ma', /투자|인수|합병|M&A|지분|밸류|valuation|invest/i],
  ['finance', /재무|자금|현금|대출|이자|매출|이익|손익|원가|금액|억|만원|달러|\$|finance|cash|loan/i],
  ['operations', /납품|납기|생산|공장|출하|재고|품질|물류|운영|delivery|production|shipment/i],
  ['rnd', /연구|개발|시제품|특허|R&D|prototype|patent/i],
  ['strategy', /전략|방향|비전|중장기|strategy/i],
  ['idea', /아이디어|생각해 볼|해보면 어떨|idea/i],
  ['business_meeting', /미팅|회의|만났|만나|이야기했|통화했|면담|meeting|met with|call with/i],
]

const AMOUNT_RE = /(?:US?\$|₩|\$)\s?\d[\d,]*(?:\.\d+)?\s?(?:억|만|천|k|m|bn)?|\d[\d,]*(?:\.\d+)?\s?(?:억|만|천)?\s?(?:원|달러|불|USD|KRW|VND|위안|엔)|\d+(?:\.\d+)?\s?%/i
const DUE_RE = /(20\d{2}\s*[-./년]\s*\d{1,2}\s*[-./월]\s*\d{1,2}\s*일?|\d{1,2}\s*월\s*\d{1,2}\s*일|\d{1,2}\/\d{1,2}|오늘|내일|모레|(?:이번\s*주|금주|이번|다음\s*주|차주|다다음\s*주)?\s*[월화수목금토일]요일|(?:이번\s*달|이달|다음\s*달|내달)\s*말|월말|다음\s*주|이번\s*주|다음\s*달|\d{1,2}\s*월(?:\s*(?:까지|중|말|초))?|연말|next week|tomorrow|(?:this|next)\s+(?:monday|tuesday|wednesday|thursday|friday))/i

/** 한 문장의 종류 — 위에서부터 첫 일치. 아무것도 아니면 null(뽑지 않음). */
function classify(s: string): { type: MemoryType; confidence: number } | null {
  if (/결정하기로|정하기로|결정은?\s*(미루|보류|나중)|결정(을|이)?\s*(못|안)\s*했|아직\s*(미정|못 정)|확인이 필요|\?$|인지\s*(모르|불확실)|whether|undecided/i.test(s)) return { type: 'question', confidence: 0.6 }
  if (/약속(했|함|하였|받았)|하기로\s*(했|함|하였|약속)|주기로|드리기로|보내기로|하겠다고|하겠다\.?$|하겠습니다|드리겠|보내겠|promised|will (send|deliver|provide)|agreed to/i.test(s)) return { type: 'commitment', confidence: 0.65 }
  if (/(으로|로)\s*결정(했|함|하였|됐|되었)|확정(했|함|됐|되었)|결론(은|을)|decided|we chose/i.test(s)) return { type: 'decision', confidence: 0.65 }
  if (/해야\s*(한다|함|해|합니다)|필요하다|필요함|정해야|챙겨야|확인해야|need to|must|have to|todo|할 일/i.test(s)) return { type: 'task', confidence: 0.6 }
  if (/위험|리스크|우려|문제(가|이)|지연|늦어|차질|손실|소송|분쟁|risk|delay|concern/i.test(s)) return { type: 'risk', confidence: 0.55 }
  if (/기회|확장 가능|새로운 시장|협업 제안|opportunity/i.test(s)) return { type: 'opportunity', confidence: 0.5 }
  if (/제안(했|함|하였|받았)|어떨까|검토해 보자|proposed|suggest/i.test(s)) return { type: 'proposal', confidence: 0.55 }
  if (/가능성|것 같|라고\s*(했|함|말)|에 따르면|주장|said|claims|according to|might|may be/i.test(s)) return { type: 'claim', confidence: 0.5 }
  if (/\d/.test(s) && /(이다|였다|했다|됐다|이었다|있다|없다|\bis\b|\bwas\b)/.test(s)) return { type: 'fact', confidence: 0.45 }
  return null
}

/** 약속의 방향 — 내가(제가 · 내가 · 우리가 · I) / 남이(그 밖의 주어). 모르면 unknown. */
function direction(s: string, type: MemoryType): Direction {
  if (type !== 'commitment' && type !== 'task') return 'unknown'
  if (/^(내가|제가|나는|저는|우리가|우리는|I\b|We\b)|(내가|제가)\s/.test(s)) return 'mine'
  if (/[가-힣A-Za-z]+\s?(사장|부장|대표|이사|상무|전무|씨|님|회사|측|쪽)(은|는|이|가|께서)\s/.test(s) || /^[A-Z][a-z]+ (will|promised|agreed)/.test(s)) return 'others'
  return type === 'task' ? 'mine' : 'unknown'
}

function who(s: string): string | null {
  const m = /^([가-힣A-Za-z]+\s?(?:사장|부장|대표|이사|상무|전무|과장|팀장|씨|님|회사|측)?)(?:은|는|이|가|께서)\s/.exec(s)
  if (!m || /^(오늘|어제|내일|이번|다음|그|이|저|우리|내|제)$/.test(m[1])) return null
  return m[1].trim()
}

function toWhom(s: string): string | null {
  const m = /([가-힣A-Za-z]+\s?(?:사장|부장|대표|이사|상무|전무|과장|팀장|씨|님)?)(?:에게|께|한테)\s/.exec(s)
  return m ? m[1].trim() : null
}

/** 규칙 뽑기 — 원문 그대로 근거를 붙인다. 문장 40개까지. */
export function ruleExtract(text: string): ExtractResult {
  const ss = sentences(text).slice(0, 40)
  const items: ExtractedItem[] = []
  for (const s of ss) {
    const c = classify(s)
    if (!c) continue
    const content = s.length > 300 ? `${s.slice(0, 297)}…` : s
    items.push({
      memory_type: c.type,
      content,
      source_quote: s.slice(0, 1000),
      speaker_label: null,
      direction: direction(s, c.type),
      who_text: who(s),
      to_text: toWhom(s),
      due_text: DUE_RE.exec(s)?.[0]?.trim() ?? null,
      amount_text: AMOUNT_RE.exec(s)?.[0]?.trim() ?? null,
      confidence: c.confidence,
    })
  }
  const categories = CATEGORY_WORDS.filter(([, re]) => re.test(text)).map(([c]) => c)
  const first = ss[0] ?? text.trim()
  return {
    summary: first ? (first.length > 160 ? `${first.slice(0, 157)}…` : first) : null,
    categories: categories.length > 0 ? categories.slice(0, 4) : ['other'],
    entities: [],
    items,
  }
}

/** 기한 말 찾기(AI 결과의 due_text가 원문에 없을 때 문장에서 다시 찾는다). */
export function dueTextIn(s: string): string | null {
  return DUE_RE.exec(s)?.[0]?.trim() ?? null
}
