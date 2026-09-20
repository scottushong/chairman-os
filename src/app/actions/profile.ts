'use server'

import { revalidatePath } from 'next/cache'

import { getRepository } from '@/lib/repository'
import type { MyProfilePatch, PersonLanguage } from '@/types'

/**
 * 본인 프로필 저장 (Phase 5-E 2절, 0030 update_own_profile).
 *
 * **user_id를 받지 않는다.** 어느 행을 고칠지는 DB의 auth.uid()가 정한다 —
 * 인자로 받으면 그 순간 '남의 프로필을 고칠 수 있는 모양'이 되고, 정책이 막아 주더라도
 * 그런 모양의 함수가 있다는 것 자체가 다음 사람을 헷갈리게 한다(actions/settings.ts와 같은 이유).
 *
 * role·max_security_class·revoked_at은 이 경로로 지나가지 못한다. 그것이 표에 self-update
 * 정책을 얹지 않고 definer 함수 하나만 문으로 둔 이유다(0030 4절).
 */

export interface ProfileState {
  error?: string
  saved?: boolean
}

/** 'YYYY-MM-DD'만 받는다. 빈 값은 '생일을 안 적었다'는 뜻이라 null이다. */
function isoDate(raw: FormDataEntryValue | null): string | null {
  const v = typeof raw === 'string' ? raw.trim() : ''
  if (v === '') return null
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
}

function text(raw: FormDataEntryValue | null): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

export async function saveMyProfile(
  _prev: ProfileState,
  form: FormData,
): Promise<ProfileState> {
  const displayName = text(form.get('display_name'))
  if (displayName === '') {
    return { error: '이름은 비워 둘 수 없습니다.' }
  }

  const rawBirth = text(form.get('birth_date'))
  const birthDate = isoDate(form.get('birth_date'))
  if (rawBirth !== '' && birthDate === null) {
    return { error: '생년월일은 YYYY-MM-DD 형식으로 적어 주세요.' }
  }

  const rawLanguage = text(form.get('language'))
  // 모르는 값이면 지금 값을 그대로 둔다 — DB도 같은 판정을 한 번 더 한다(0030 4절).
  const language: PersonLanguage = rawLanguage === 'en' ? 'en' : 'ko'

  const patch: MyProfilePatch = {
    display_name: displayName,
    display_name_en: text(form.get('display_name_en')) || null,
    title_ko: text(form.get('title_ko')) || null,
    birth_date: birthDate,
    language,
  }

  try {
    const repo = await getRepository()
    const ok = await repo.saveMyProfile(patch)
    if (!ok) return { error: '프로필을 저장하지 못했습니다. 이름을 확인해 주세요.' }
  } catch (e) {
    console.error('[profile]', e)
    return { error: '프로필을 저장하지 못했습니다.' }
  }

  // 헤더와 사이드바가 이름을 들고 있다. 여기만 갱신하면 방금 바꾼 이름이 화면 위쪽에서
  // 옛 값으로 남아, 저장이 안 된 것처럼 보인다 — 셸 전체를 다시 그린다.
  revalidatePath('/', 'layout')
  return { saved: true }
}
