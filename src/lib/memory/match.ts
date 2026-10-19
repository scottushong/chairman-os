/**
 * 기억 엔진 — 글 속 이름을 기존 회사 · 프로젝트 · 사람 · 바깥 인물에 맞춰 본다(순수 · AI 없음).
 *
 * 정책(지시문 Step 3 · Case F):
 *   · 회사 · 프로젝트 — 정식 이름(또는 확인된 별칭)이 글에 그대로 있고 후보가 하나면 «확정 연결»(비파괴적 · 되돌릴 수 있음).
 *     부분 단서(«베트남 법인» ↔ «DY Vietnam»)는 «제안» + 검토함.
 *   · 사람 — **절대 자동 확정하지 않는다.** 같은 이름 · 같은 성 + 직함이라도 «제안» + 검토함(«누구인지 확인»). 후보가 없으면
 *     바깥 인물(memory_entities, pending)로 만들어 둔다.
 *   · DB에 없는 회사(«A회사» · «(주)OO» · «OO Co.»)는 바깥 회사(pending). 같은 이름이면 다음 기록에서도 같은 줄로 이어진다.
 */
import type { LinkTargetType, LinkVerification, MemoryDirectory } from './types'

export interface MatchCandidate {
  target_type: LinkTargetType
  target_id: string
  name: string
  score: number
  why: string
}

export interface Mention {
  /** 글에 나온 말 그대로 */
  text: string
  kind: 'company' | 'project' | 'person'
  /** 처리 결과: confirmed = 확정 연결 · suggested = 제안(검토함) · pending = 바깥 인물/회사로 보류(검토함) */
  decision: LinkVerification | 'pending'
  /** 확정 · 제안된 대상(pending이면 바깥 인물 이름) */
  target: MatchCandidate | null
  candidates: MatchCandidate[]
  /** pending일 때 만들 바깥 인물 · 회사 이름 */
  entityName: string | null
}

const TITLES = ['사장', '부사장', '부장', '차장', '과장', '대리', '대표', '이사', '상무', '전무', '실장', '팀장', '본부장', '회장', '법인장', '선생', '교수', '변호사', '회계사', '세무사', '씨', '님']
// 직함 뒤에는 조사 · 끝만 온다(«보람씨앤에이치»의 «씨»는 사람이 아니다).
const TITLE_RE = new RegExp(`(?<![가-힣])([가-힣]{1,3})\\s?(${TITLES.join('|')})(?=$|[\\s,.!?·)]|에게|께|과|와|은|는|이|가|을|를|의|도|한테|님|으로|로|하고)`, 'g')
// 직함 앞에 와도 사람 이름이 아닌 말(«우리 대표» · «회사 대표» · «해당 부장»)
const NOT_PERSON = new Set(['우리', '그', '저', '이번', '해당', '상대', '전', '새', '각', '회사', '법인', '고객', '담당', '현', '신임', '전임', '모든', '다른', '같은'])
const EN_TITLE_RE = /\b(Mr|Mrs|Ms|Dr|Director|President|CEO)\.?\s+([A-Z][a-zA-Z-]{1,20})\b/g
// 회사 꼴: «A회사» · «B사» · «(주)OO» · «OO(주)» · «OO Co.» · «OO Corp» · «OO Ltd»
const COMPANY_RES = [
  /(?<![가-힣A-Za-z])([A-Z][A-Za-z0-9&]{0,15})\s?(회사|사)(?=[는은이가와과의에를도\s,.]|$)/g,
  /(?<![가-힣A-Za-z])([가-힣]{2,8})\s?(회사)(?=[는은이가와과의에를도\s,.]|$)/g,
  /\(주\)\s?([가-힣A-Za-z0-9]{2,15})/g,
  /([가-힣A-Za-z0-9]{2,15})\s?\(주\)/g,
  /\b([A-Z][A-Za-z0-9&]{1,20}(?:\s[A-Z][A-Za-z0-9&]{1,20})?)\s(Co\.|Corp\.?|Ltd\.?|Inc\.?|LLC|JSC)/g,
]
// 회사 꼴로 잡혀도 회사가 아닌 낱말(«우리 회사» · «각 사» · «본사» 등)
const NOT_COMPANY = new Set(['우리', '자회사', '모회사', '본', '지', '각', '타', '전', '당', '귀', '해당', '같은', '이', '그', '저', '동', '회', '고객', '협력', '경쟁', '관계', '상대'])
// 나라 · 지역 단서(부분 일치를 «제안»으로만)
const PLACE_EQUIV: [string, RegExp][] = [
  ['베트남', /vietnam|viet nam|베트남/i],
  ['중국', /china|중국/i],
  ['미국', /\busa?\b|america|미국/i],
  ['일본', /japan|일본/i],
  ['인도네시아', /indonesia|인도네시아/i],
  ['태국', /thailand|태국/i],
  ['인도', /\bindia\b|인도(?!네)/i],
]

/** 회사 이름 정리 — «(주)» · «주식회사» · 앞뒤 공백. */
export function cleanCompanyName(name: string): string {
  return name.replace(/\(주\)|㈜|주식회사|\bCo\.?,?\s*Ltd\.?|\bInc\.?|\bCorp\.?/gi, '').replace(/\s+/g, ' ').trim()
}

const isLatin = (s: string) => /^[A-Za-z0-9 .&-]+$/.test(s)

/** 이름이 글에 들어 있나 — 한글은 그대로, 영문은 낱말 경계(«DY»가 «DYNAMIC»에 걸리지 않게). */
export function containsName(text: string, name: string): boolean {
  const n = name.trim()
  if (n.length < 2) return false
  if (isLatin(n)) {
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
    return new RegExp(`(?<![A-Za-z0-9])${esc}(?![A-Za-z0-9])`, 'i').test(text)
  }
  return text.includes(n)
}

function uniqBy<T>(xs: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>()
  return xs.filter((x) => (seen.has(key(x)) ? false : (seen.add(key(x)), true)))
}

/**
 * 글 하나에서 언급을 찾는다. 같은 대상은 한 번.
 */
export function findMentions(text: string, dir: MemoryDirectory): Mention[] {
  const out: Mention[] = []
  const claimed: string[] = [] // 이미 회사 · 프로젝트로 잡힌 말(사람 · 바깥 회사로 또 잡지 않는다)

  // ── 회사 ──
  for (const b of dir.businesses) {
    const names = uniqBy(
      [b.name, cleanCompanyName(b.name), ...dir.aliases.filter((a) => a.entity_type === 'business' && a.entity_id === b.business_id && a.verification_status !== 'rejected').map((a) => a.alias)],
      (x) => x.toLowerCase(),
    ).filter((n) => n.length >= 2)
    const hit = names.find((n) => containsName(text, n))
    if (hit) {
      const alias = dir.aliases.find((a) => a.entity_type === 'business' && a.entity_id === b.business_id && a.alias.toLowerCase() === hit.toLowerCase())
      const exact = !alias || alias.verification_status === 'confirmed'
      out.push({
        text: hit,
        kind: 'company',
        decision: exact ? 'confirmed' : 'suggested',
        target: { target_type: 'business', target_id: b.business_id, name: b.name, score: exact ? 0.9 : 0.6, why: alias ? '별칭' : '정식 이름' },
        candidates: [],
        entityName: null,
      })
      claimed.push(hit)
    }
  }
  // 부분 단서 — 나라 · 지역(«베트남 법인» → 이름에 Vietnam이 든 회사). 제안만.
  for (const [ko, re] of PLACE_EQUIV) {
    const m = new RegExp(`${ko}\\s?(법인|지사|공장|사무소|자회사)?`).exec(text) ?? (re.test(text) ? re.exec(text) : null)
    if (!m) continue
    const cands = dir.businesses
      .filter((b) => re.test(b.name) || dir.aliases.some((a) => a.entity_type === 'business' && a.entity_id === b.business_id && re.test(a.alias)))
      .filter((b) => !out.some((o) => o.target?.target_id === b.business_id))
      .map((b) => ({ target_type: 'business' as const, target_id: b.business_id, name: b.name, score: 0.5, why: `«${ko}» 단서` }))
    if (cands.length > 0) {
      out.push({ text: m[0], kind: 'company', decision: 'suggested', target: cands.length === 1 ? cands[0] : null, candidates: cands, entityName: null })
      claimed.push(m[0])
    } else if (m[1] && !out.some((o) => o.kind === 'company' && o.decision === 'confirmed')) {
      // «베트남 법인»인데 맞는 회사가 없다 — 바깥 회사로 보류하고 검토함에서 묻는다(지시문 Case A «회사 신원이 불확실하면 검토 요청»).
      const name = m[0].replace(/\s+/g, ' ').trim()
      const entity = dir.entities.find((e) => e.entity_type === 'company' && e.display_name === name && e.status !== 'rejected')
      out.push({
        text: name,
        kind: 'company',
        decision: entity?.status === 'confirmed' ? 'confirmed' : 'pending',
        target: entity ? { target_type: 'entity', target_id: entity.entity_id, name: entity.display_name, score: 0.6, why: '앞 기록의 바깥 회사' } : null,
        candidates: [],
        entityName: name,
      })
      claimed.push(m[0])
    }
  }

  // ── 프로젝트 ──
  for (const p of dir.projects) {
    const names = uniqBy(
      [p.name, ...dir.aliases.filter((a) => a.entity_type === 'project' && a.entity_id === p.project_id && a.verification_status !== 'rejected').map((a) => a.alias)],
      (x) => x.toLowerCase(),
    ).filter((n) => n.length >= 3)
    const hit = names.find((n) => containsName(text, n))
    if (hit) {
      const alias = dir.aliases.find((a) => a.entity_type === 'project' && a.entity_id === p.project_id && a.alias.toLowerCase() === hit.toLowerCase())
      const exact = !alias || alias.verification_status === 'confirmed'
      out.push({
        text: hit,
        kind: 'project',
        decision: exact ? 'confirmed' : 'suggested',
        target: { target_type: 'project', target_id: p.project_id, name: p.name, score: exact ? 0.85 : 0.6, why: alias ? '별칭' : '정식 이름' },
        candidates: [],
        entityName: null,
      })
      claimed.push(hit)
    }
  }

  // ── 바깥 회사(DB에 없는 «A회사» 등) ──
  for (const re of COMPANY_RES) {
    for (const m of text.matchAll(new RegExp(re.source, re.flags))) {
      const core = (m[1] ?? '').trim()
      if (!core || NOT_COMPANY.has(core) || claimed.some((c) => c.includes(core) || core.includes(c))) continue
      const whole = m[0].trim()
      const known = dir.businesses.find((b) => cleanCompanyName(b.name).toLowerCase() === core.toLowerCase())
      if (known) continue // 위에서 정식 이름으로 잡힌다
      const name = /회사|사$/.test(whole) && !/\(주\)/.test(whole) ? `${core}${m[2] === '회사' ? '회사' : '사'}` : core
      const entity = dir.entities.find((e) => e.entity_type === 'company' && e.display_name.toLowerCase() === name.toLowerCase() && e.status !== 'rejected')
      const aliasHit = dir.aliases.find((a) => a.alias.toLowerCase() === name.toLowerCase() && a.verification_status === 'confirmed' && a.entity_type === 'business')
      if (aliasHit) continue
      out.push({
        text: whole,
        kind: 'company',
        decision: entity?.status === 'confirmed' ? 'confirmed' : 'pending',
        target: entity ? { target_type: 'entity', target_id: entity.entity_id, name: entity.display_name, score: 0.7, why: '앞 기록의 바깥 회사' } : null,
        candidates: [],
        entityName: name,
      })
      claimed.push(whole)
    }
  }

  // ── 사람 — 자동 확정 없음 ──
  const personMentions: string[] = []
  for (const m of text.matchAll(TITLE_RE)) {
    const who = m[1]
    if (NOT_PERSON.has(who) || claimed.some((c) => c.includes(m[0]))) continue
    // «이 부장»(성 하나) · «방 사장» · «김철수 부장» · «보람씨»
    personMentions.push(`${who}${m[0].includes(' ') ? ' ' : ''}${m[2]}`)
  }
  for (const m of text.matchAll(EN_TITLE_RE)) personMentions.push(`${m[1]}. ${m[2]}`)
  for (const p of dir.people) {
    for (const n of [p.display_name, p.display_name_en].filter((x): x is string => !!x && x.length >= 2)) {
      if (containsName(text, n) && !personMentions.some((pm) => pm.includes(n))) personMentions.push(n)
    }
  }
  for (const mention of uniqBy(personMentions, (x) => x.replace(/\s/g, ''))) {
    const cands = personCandidates(mention, dir)
    const aliasEntity = dir.aliases.find((a) => a.alias.replace(/\s/g, '') === mention.replace(/\s/g, '') && a.verification_status === 'confirmed')
    const entity = dir.entities.find((e) => e.entity_type === 'person' && e.display_name.replace(/\s/g, '') === mention.replace(/\s/g, '') && e.status !== 'rejected')
    out.push({
      text: mention,
      kind: 'person',
      // 확인된 별칭이 있어도 «제안» — 같은 호칭이 다른 사람일 수 있다(지시문 Case F). 후보 맨 앞에만 둔다.
      decision: cands.length > 0 || aliasEntity ? 'suggested' : 'pending',
      target: null,
      candidates: aliasEntity
        ? uniqBy([{ target_type: aliasEntity.entity_type === 'entity' ? 'entity' : 'person', target_id: aliasEntity.entity_id, name: mention, score: 0.8, why: '확인된 별칭' } as MatchCandidate, ...cands], (c) => `${c.target_type}:${c.target_id}`)
        : cands,
      entityName: entity ? entity.display_name : mention,
    })
  }
  return out
}

/** 사람 후보 — 같은 이름 · 같은 성(+ 직함) · 바깥 인물 · 별칭. 점수만 매기고 고르지 않는다. */
export function personCandidates(mention: string, dir: MemoryDirectory): MatchCandidate[] {
  const flat = mention.replace(/\s/g, '')
  const title = TITLES.find((t) => flat.endsWith(t)) ?? null
  const core = title ? flat.slice(0, -title.length) : flat
  const en = /^(Mr|Mrs|Ms|Dr|Director|President|CEO)\.\s*(.+)$/i.exec(mention)?.[2]?.toLowerCase() ?? null
  const out: MatchCandidate[] = []
  for (const p of dir.people) {
    const name = p.display_name.replace(/\s/g, '')
    let score = 0
    let why = ''
    if (core.length >= 2 && name === core) {
      score = 0.6
      why = '같은 이름'
    } else if (core.length === 1 && name.startsWith(core)) {
      score = 0.3
      why = `성 «${core}»`
    } else if (en && p.display_name_en && p.display_name_en.toLowerCase().split(/\s+/).includes(en)) {
      score = 0.4
      why = '영문 이름'
    }
    if (score > 0 && title && p.title_ko && p.title_ko.includes(title)) {
      score += 0.15
      why += ` · 직함 «${title}»`
    }
    if (score > 0) out.push({ target_type: 'person', target_id: p.user_id, name: p.display_name + (p.title_ko ? ` ${p.title_ko}` : ''), score: Math.min(score, 0.75), why })
  }
  for (const e of dir.entities) {
    if (e.entity_type !== 'person' || e.status === 'rejected') continue
    if (e.display_name.replace(/\s/g, '') === flat) out.push({ target_type: 'entity', target_id: e.entity_id, name: e.display_name, score: 0.55, why: '앞 기록의 바깥 인물' })
  }
  for (const a of dir.aliases) {
    if (a.verification_status === 'rejected' || a.alias.replace(/\s/g, '') !== flat) continue
    if (a.entity_type === 'person' || a.entity_type === 'entity') {
      out.push({ target_type: a.entity_type === 'entity' ? 'entity' : 'person', target_id: a.entity_id, name: mention, score: a.verification_status === 'confirmed' ? 0.8 : 0.5, why: '별칭' })
    }
  }
  return uniqBy(out.sort((x, y) => y.score - x.score), (c) => `${c.target_type}:${c.target_id}`).slice(0, 6)
}
