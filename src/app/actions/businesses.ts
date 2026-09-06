'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { isValidSlug, toBusinessId, SLUG_RULE_KO } from '@/lib/business-id'
import { DUPLICATE_BUSINESS_ID, getRepository } from '@/lib/repository'
import { BUSINESS_STATUS, type Business, type BusinessStatus } from '@/types'

/**
 * CH-002 기업 추가 (DEFERRED D-08 결정 A).
 *
 * 여기까지 오기 전에는 이 일이 브라우저 localStorage에서 끝났다. 추가한 회사가 그 브라우저에만
 * 있었고, 다른 기기·다른 사람에게는 존재하지 않았다. 회사를 만드는 건 '내 화면' 설정이 아니라
 * 조직 데이터를 만드는 일이라 세 가지가 같이 걸린다 — INSERT 권한, 감사 기록, id 발급 규칙.
 *
 * 권한은 여기서 보지 않는다. 로그인한 본인의 세션으로 DB에 붙고, Chairman이 아니면
 * 0002의 businesses_write 정책이 거부한다. 판정을 애플리케이션으로 옮기면 우회 경로가 하나 더 생긴다.
 */

export interface CreateBusinessState {
  error?: string
  business?: Business
}

/** 06_상태코드의 BusinessStatus만 통과시킨다. 화면이 뭘 보내든 임의 상태명은 DB로 못 간다. */
function isBusinessStatus(value: unknown): value is BusinessStatus {
  return BUSINESS_STATUS.includes(value as BusinessStatus)
}

export async function createBusiness(input: {
  name: unknown
  slug: unknown
  industry: unknown
  status: unknown
}): Promise<CreateBusinessState> {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const slug = typeof input.slug === 'string' ? input.slug.trim().toLowerCase() : ''
  const industry = typeof input.industry === 'string' ? input.industry.trim() : ''

  if (!name) return { error: '회사명을 입력하세요.' }
  if (!isValidSlug(slug)) return { error: `기업 ID가 규칙에 맞지 않습니다. ${SLUG_RULE_KO}` }
  if (!isBusinessStatus(input.status)) return { error: '알 수 없는 상태입니다.' }

  // 세션이 없으면 애초에 이 화면을 못 연다(proxy). 여기 걸리면 세션이 중간에 끊긴 것이다.
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  let business: Business
  try {
    const repo = await getRepository()
    business = await repo.createBusiness(
      {
        business_id: toBusinessId(slug),
        name,
        // 시드 businesses.industry의 기본값과 같은 말을 쓴다. 빈 문자열을 넣으면 카드에 빈칸이 생긴다.
        industry: industry || '미분류',
        status: input.status,
      },
      { user_id: user.user_id, role: user.role },
    )
  } catch (e) {
    console.error('[createBusiness]', e)
    if (e instanceof Error && e.message === DUPLICATE_BUSINESS_ID) {
      return { error: `이미 쓰이고 있는 기업 ID입니다: ${toBusinessId(slug)}` }
    }
    // 어댑터가 만든 문장에는 RLS 정책 이름 같은 실마리가 들어 있다. 서버 로그에는 그대로 남긴다.
    return {
      error:
        e instanceof Error && /businesses_write|42501|PGRST301/.test(e.message)
          ? '기업을 추가할 권한이 없습니다. (CH-002는 Chairman만 가능합니다)'
          : '기업을 추가하지 못했습니다. 잠시 후 다시 시도하세요.',
    }
  }

  // 카드 한 장이 늘고 그룹 KPI의 분모가 바뀐다. 서버가 다시 그려야 보인다.
  revalidatePath('/')
  return { business }
}
