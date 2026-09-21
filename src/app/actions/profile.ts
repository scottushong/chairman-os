'use server'

import { revalidatePath } from 'next/cache'

import { getRepository } from '@/lib/repository'
import { PHOTO_MAX_BYTES, PHOTO_MIME, type PhotoMime } from '@/lib/profile-photo'
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

/* ------------------------------------------------------------------ 프로필 사진 (0032) */

/**
 * 사진 업로드. FormData로 받는다 — 파일은 Server Action의 직렬화를 태울 수 없다
 * (actions/initiatives.ts saveInitiativeLogoAction과 같은 모양·같은 이유).
 *
 * **user_id를 받지 않는다.** 어느 경로에 쓸지는 DB의 auth.uid()가 정한다.
 * 0032의 쓰기 정책 셋이 경로의 주인과 세션을 비교하므로, 남의 경로로 올리려 해도
 * Storage가 거부한다 — 여기서 역할을 보지 않는 이유가 그것이다. 회장도 남의 얼굴을
 * 바꾸지 못한다.
 *
 * 브라우저 <input accept>는 안내다. 상한(2MB)과 형식은 여기서 다시 본다 —
 * accept는 파일 선택창의 필터일 뿐 드래그·붙여넣기로 뚫린다.
 */
export async function saveMyPhotoAction(formData: FormData): Promise<ProfileState> {
  const file = formData.get('photo')
  if (!(file instanceof File) || file.size === 0) return { error: '파일을 고르세요.' }
  if (file.size > PHOTO_MAX_BYTES) {
    return { error: `2MB를 넘길 수 없습니다. (현재 ${(file.size / 1_048_576).toFixed(1)}MB)` }
  }
  if (!PHOTO_MIME.includes(file.type as PhotoMime)) {
    return { error: 'PNG · JPG · WebP만 올릴 수 있습니다.' }
  }

  try {
    const repo = await getRepository()
    await repo.saveMyPhoto({ bytes: await file.arrayBuffer(), contentType: file.type })
  } catch (e) {
    console.error('[profile-photo]', e)
    return { error: '사진을 올리지 못했습니다.' }
  }

  // 헤더·사이드바·조직도가 이 사진을 든다. 셸 전체를 다시 그린다(saveMyProfile과 같은 이유).
  revalidatePath('/', 'layout')
  revalidatePath('/settings/users')
  return { saved: true }
}

/** 사진을 내린다. 지우는 것은 본인 것뿐이다 — 어느 행인지는 DB가 정한다. */
export async function removeMyPhotoAction(): Promise<ProfileState> {
  try {
    const repo = await getRepository()
    await repo.removeMyPhoto()
  } catch (e) {
    console.error('[profile-photo]', e)
    return { error: '사진을 내리지 못했습니다.' }
  }

  revalidatePath('/', 'layout')
  revalidatePath('/settings/users')
  return { saved: true }
}
