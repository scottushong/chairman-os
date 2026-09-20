'use client'

import { useActionState } from 'react'

import { saveMyProfile, type ProfileState } from '@/app/actions/profile'
import { PERSON_LANGUAGE_LABEL_KO, type MyProfile } from '@/types'

/**
 * 프로필 편집 폼 (Phase 5-E 2절, /settings/profile).
 *
 * **저장 버튼이 하나다.** BriefTimezone처럼 고르는 즉시 저장하지 않는다 — 저쪽은 값이
 * 하나이고 이쪽은 다섯이라, 칸마다 저장하면 이름을 지우고 다시 쓰는 중간 상태가
 * 그대로 서버에 올라간다(빈 이름은 DB가 거절하므로 그 순간 오류 줄이 뜬다).
 *
 * 생년월일은 <input type="date">다. 연·월·일 전부 고칠 수 있다 —
 * 회장 지시는 "월일은 설정에서 수정"이었지만 연도만 잠글 이유가 따로 없고,
 * 잠긴 칸 하나는 "왜 이건 안 되지"로 남는다.
 */
export function ProfileForm({ profile }: { profile: MyProfile }) {
  const [state, action, pending] = useActionState<ProfileState, FormData>(saveMyProfile, {})

  return (
    <form action={action} className="mt-2.5 space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="이름 (한글)" hint="필수. 화면 곳곳에서 이 이름으로 부릅니다.">
          <input
            name="display_name"
            defaultValue={profile.display_name}
            required
            maxLength={60}
            className={INPUT}
          />
        </Field>

        <Field
          label="이름 (영문)"
          hint="비워 두면 영문 줄을 아예 그리지 않습니다 — 한글 이름을 로마자로 지어내지 않습니다."
        >
          <input
            name="display_name_en"
            defaultValue={profile.display_name_en ?? ''}
            maxLength={60}
            className={INPUT}
          />
        </Field>

        <Field label="직함" hint="비워 두면 역할명(회장·대표이사 등)으로 대신합니다.">
          <input name="title_ko" defaultValue={profile.title_ko} maxLength={40} className={INPUT} />
        </Field>

        <Field label="생년월일" hint="비워 둘 수 있습니다. 본인과 회장님만 볼 수 있는 값입니다.">
          <input
            type="date"
            name="birth_date"
            defaultValue={profile.birth_date ?? ''}
            min="1900-01-01"
            max="2100-01-01"
            className={INPUT}
          />
        </Field>

        <Field label="표기 언어" hint="새 번역 체계가 아니라 '이 사람이 ko/en 중 어느 쪽을 쓰는가'입니다.">
          <select name="language" defaultValue={profile.language} className={INPUT}>
            {(['ko', 'en'] as const).map((l) => (
              <option key={l} value={l}>
                {PERSON_LANGUAGE_LABEL_KO[l]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex items-center gap-2.5">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
        >
          {pending ? '저장하는 중…' : '저장'}
        </button>
        {state.error ? (
          <span role="alert" className="text-[11.5px] text-critical">
            {state.error}
          </span>
        ) : null}
        {state.saved && !state.error ? (
          <span className="text-[11.5px] text-ok">저장했습니다.</span>
        ) : null}
      </div>
    </form>
  )
}

const INPUT =
  'w-full rounded-md border border-line bg-raised px-2.5 py-1.5 text-[12.5px] text-ink outline-none transition-colors focus:border-accent'

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-semibold text-ink-dim">{label}</span>
      {children}
      <span className="mt-1 block text-[10px] text-ink-muted">{hint}</span>
    </label>
  )
}
