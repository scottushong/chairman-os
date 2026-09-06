'use server'

import { getRepository } from '@/lib/repository'
import { MIN_QUERY_LENGTH, type SearchHit } from '@/lib/search'

/**
 * CH-043 통합검색.
 *
 * Server Action인 이유는 검색이 RLS 안에서 돌아야 하기 때문이다. 브라우저에서 직접
 * Supabase를 치면 anon 키가 노출된 채로 다섯 표를 훑게 되고, 그때 무엇이 나오는지는
 * 여전히 정책이 정하지만 질의 자체를 사람이 마음대로 바꿔 던질 수 있게 된다.
 *
 * 여기에는 권한 판정이 없다. 있으면 안 된다 — 0002의 read 정책들이 이미 각 표에서 행을 자른다
 * (repository/supabase.ts의 search 주석). 앱이 한 번 더 거르면 판정이 두 곳으로 갈라진다.
 */

/** 종류당 최대 몇 줄까지. 드롭다운은 훑는 자리라 다섯 줄이면 충분하고, 넘으면 스크롤이 생긴다. */
const LIMIT_PER_KIND = 5

export interface SearchState {
  /** 어떤 질의의 결과인가. 늦게 도착한 응답이 최신 입력을 덮어쓰지 않게 화면이 이 값을 본다. */
  query: string
  hits: SearchHit[]
  error?: string
}

export async function search(query: unknown): Promise<SearchState> {
  const q = typeof query === 'string' ? query.trim() : ''
  if (q.length < MIN_QUERY_LENGTH) return { query: q, hits: [] }

  try {
    const repo = await getRepository()
    return { query: q, hits: await repo.search(q, LIMIT_PER_KIND) }
  } catch (e) {
    console.error('[search]', e)
    return { query: q, hits: [], error: '검색에 실패했습니다.' }
  }
}
