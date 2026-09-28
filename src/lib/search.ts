/**
 * CH-043 통합검색의 어휘와 이동 규칙.
 *
 * 어댑터는 '무엇을 찾았나'까지만 답한다(kind + id + 이름). '그래서 어디로 가나'는
 * 라우트를 아는 이 파일이 정한다 — repository가 URL을 만들기 시작하면
 * 화면 구조를 바꿀 때 데이터 계층을 같이 고쳐야 한다.
 */

export const SEARCH_KIND = ['business', 'project', 'task', 'decision', 'document', 'attachment'] as const
export type SearchKind = (typeof SEARCH_KIND)[number]

export const SEARCH_KIND_LABEL_KO: Record<SearchKind, string> = {
  business: '기업',
  project: '프로젝트',
  task: '업무',
  decision: '결정',
  document: '문서',
  attachment: '첨부 요약',
}

/**
 * 검색 결과 한 줄.
 *
 * business_id를 들고 다니는 이유는 이동 대상이 '그 회사로 좁힌 목록'인 종류가 남아 있어서다
 * (문서). 기업·프로젝트·업무·결정은 단건을 지목할 수 있다.
 */
export interface SearchHit {
  kind: SearchKind
  id: string
  title: string
  /** 회사명·프로젝트명처럼 어느 맥락의 결과인지 알려 주는 한 줄. */
  subtitle: string
  business_id: string | null
}

/** 결과를 눌렀을 때 갈 자리. */
export function hitHref(hit: SearchHit): string {
  const scope = hit.business_id ? `business=${encodeURIComponent(hit.business_id)}` : ''

  switch (hit.kind) {
    case 'business':
      return `/business/${encodeURIComponent(hit.id)}`
    case 'decision':
      // 전자결재는 단건을 지목할 수 있다. 대기/완료 어느 탭인지는 저쪽이 상태를 보고 정한다.
      return `/approvals?id=${encodeURIComponent(hit.id)}`
    case 'document':
      return scope ? `/documents?${scope}` : '/documents'
    case 'project':
      // DEFERRED D-12 이후로 단건 화면이 있다. 회사 상세로 우회하지 않는다.
      return `/projects/${encodeURIComponent(hit.id)}`
    case 'task':
      return `/tasks/${encodeURIComponent(hit.id)}`
    case 'attachment':
      return attachmentEntityHref(hit.id)
  }
}

/**
 * Phase 10 — 첨부 검색 결과의 id는 «붙은 대상»이다(`<표>:<id>`). 결과를 누르면 첨부 한 건이 아니라
 * 그 첨부가 걸린 상세 화면으로 간다 — 요약은 그 화면의 «첨부» 칸에 있다.
 */
export function attachmentHitId(entityTable: string, entityId: string): string {
  return `${entityTable}:${entityId}`
}

export function attachmentEntityHref(hitId: string): string {
  const [table, id = ''] = hitId.split(':')
  const e = encodeURIComponent(id)
  switch (table) {
    case 'initiatives':
      return `/initiatives/${e}`
    case 'businesses':
      return `/business/${e}`
    case 'documents':
      return `/documents/${e}`
    case 'decisions':
      return `/approvals?id=${e}`
    default:
      return '/documents'
  }
}

/**
 * 한글이 섞였는가. 섞였으면 full-text가 아니라 ILIKE로 간다.
 * 이유는 0009_search.sql 머리에 적어 두었다 — Postgres에 한국어 사전이 없다.
 *
 * 한글 완성형(가~힣)과 자모(ㄱ~ㅣ)를 같이 본다. 자모만 친 상태(초성 검색 흉내)도
 * 단어로 잘리지 않으므로 ILIKE 쪽이 맞다.
 */
export function needsSubstringSearch(query: string): boolean {
  return /[가-힣ㄱ-ㆎ]/.test(query)
}

/** 검색을 시작할 최소 길이. 한 글자로 훑으면 결과가 거의 전부라 고르는 데 도움이 안 된다. */
export const MIN_QUERY_LENGTH = 2
