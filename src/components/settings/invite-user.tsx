'use client'

import { useState } from 'react'

import { inviteUser } from '@/app/actions/users'
import { Icon } from '@/components/ui/icon'
import {
  ROLE,
  ROLE_LABEL_KO,
  SECURITY_CLASS,
  SECURITY_CLASS_LABEL_KO,
  type Business,
  type Role,
  type SecurityClass,
} from '@/types'

/**
 * CH-049 사용자 초대 폼.
 *
 * 계정을 만드는 폼이 아니다. "이 이메일로 계정이 생기면 이 역할을 준다"를 적는 폼이다 —
 * 계정 생성은 service_role을 요구하고 이 프로젝트에는 없다(0011 머리 주석 / DEFERRED D-15).
 * 그 사실을 폼 안에 적어 둔다. 초대를 누르고 메일을 기다리는 사람이 없어야 한다.
 *
 * 회사 선택이 역할에 따라 사라진다. 전사 역할(Chairman/GroupCFO)에게는 고르게 하지 않는다 —
 * 골라 봐야 0002의 has_business()가 그 둘은 user_business_access를 보지 않는다.
 */

/** 0002의 has_group_scope()와 같은 목록. actions/users.ts와도 같아야 한다. */
const GROUP_SCOPE: readonly Role[] = ['Chairman', 'GroupCFO']

export function InviteUser({ businesses }: { businesses: Business[] }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [titleKo, setTitleKo] = useState('')
  const [role, setRole] = useState<Role>('Member')
  const [securityClass, setSecurityClass] = useState<SecurityClass>('Normal')
  const [businessIds, setBusinessIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const groupScope = GROUP_SCOPE.includes(role)
  const canSave =
    email.trim().length > 0 &&
    displayName.trim().length > 0 &&
    (groupScope || businessIds.length > 0) &&
    !busy

  function toggleBusiness(id: string) {
    setBusinessIds((ids) => (ids.includes(id) ? ids.filter((b) => b !== id) : [...ids, id]))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSave) return

    setBusy(true)
    setError(null)
    const result = await inviteUser({
      email,
      displayName,
      titleKo,
      role,
      securityClass,
      businessIds,
    })
    setBusy(false)

    if (result.error) {
      setError(result.error)
      return
    }

    // 목록은 서버가 다시 그린다(revalidatePath). 여기서는 다음에 할 일만 말한다.
    setDone(result.invitation?.email ?? email)
    setEmail('')
    setDisplayName('')
    setTitleKo('')
    setBusinessIds([])
    setOpen(false)
  }

  if (!open) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => {
            setDone(null)
            setOpen(true)
          }}
          className="flex items-center gap-1.5 rounded-md border border-line bg-panel px-3 py-1.5 text-[12px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          <Icon name="user-plus" className="size-3.5" />
          사용자 초대
        </button>

        {/* 초대만으로 끝나지 않는다. 다음 한 걸음을 여기서 말한다. */}
        {done ? (
          <p className="rounded-lg border border-ok/40 bg-ok/10 px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-dim">
            <span className="font-semibold text-ink">{done}</span> 초대를 저장했습니다. 아직
            계정은 없습니다 — Supabase Dashboard → Authentication → Users에서 이 주소로 계정을
            만들거나 초대 메일을 보내세요. 계정이 생기는 순간 권한이 자동으로 붙습니다(0011
            on_auth_user_created).
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <form
      onSubmit={submit}
      aria-label="사용자 초대"
      className="w-full rounded-xl border border-line bg-panel p-4"
    >
      <div className="flex items-baseline justify-between">
        <h2 className="text-[13px] font-semibold">사용자 초대</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11px] text-ink-muted transition-colors hover:text-ink"
        >
          닫기
        </button>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
        여기서 계정이 만들어지지는 않습니다. 이 주소로 계정이 생기면 아래 권한을 준다는 약속을
        저장합니다 — 메일은 Supabase Dashboard에서 보냅니다(DEFERRED D-15).
      </p>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="text-[11px] text-ink-dim">이메일</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            placeholder="name@example.co.kr"
            maxLength={254}
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-muted focus:border-accent disabled:opacity-50"
          />
        </label>

        <label className="block">
          <span className="text-[11px] text-ink-dim">이름</span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="예: 김민수"
            maxLength={60}
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-muted focus:border-accent disabled:opacity-50"
          />
          {/* 이메일이 목록에 안 뜨는 이유를 여기서 말한다. auth.users는 PostgREST로 안 읽힌다. */}
          <span className="mt-1 block text-[10.5px] text-ink-muted">
            사용자 목록에서 사람을 가리는 값입니다. 이메일은 계정이 생기면 목록에서 사라집니다.
          </span>
        </label>

        <label className="block">
          <span className="text-[11px] text-ink-dim">직함 (선택)</span>
          <input
            value={titleKo}
            onChange={(e) => setTitleKo(e.target.value)}
            placeholder="예: 재무팀장"
            maxLength={60}
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-muted focus:border-accent disabled:opacity-50"
          />
        </label>

        <label className="block">
          <span className="text-[11px] text-ink-dim">역할</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2 text-[13px] text-ink outline-none focus:border-accent disabled:opacity-50"
          >
            {ROLE.map((r) => (
              <option key={r} value={r} className="bg-panel">
                {ROLE_LABEL_KO[r]}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="md:col-span-2">
          <legend className="text-[11px] text-ink-dim">
            회사 범위 {groupScope ? '— 전사 역할이라 고르지 않습니다' : ''}
          </legend>
          {groupScope ? (
            <p className="mt-1.5 rounded-lg bg-raised px-3 py-2 text-[11.5px] text-ink-muted">
              {ROLE_LABEL_KO[role]}은(는) 04_권한 시트에서 Business 범위가 &lsquo;전체&rsquo;입니다.
              회사를 지정해도 0002의 has_business()가 그 목록을 보지 않습니다.
            </p>
          ) : (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {businesses.map((b) => (
                <button
                  key={b.business_id}
                  type="button"
                  onClick={() => toggleBusiness(b.business_id)}
                  disabled={busy}
                  aria-pressed={businessIds.includes(b.business_id)}
                  className={`rounded-md border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-50 ${
                    businessIds.includes(b.business_id)
                      ? 'border-accent bg-accent/15 text-ink'
                      : 'border-line text-ink-muted hover:text-ink-dim'
                  }`}
                >
                  {b.name}
                </button>
              ))}
            </div>
          )}
          {!groupScope ? (
            <p className="mt-1.5 text-[10.5px] text-ink-muted">
              여기 없는 회사는 이 사람에게 존재하지 않는 것처럼 보입니다(Business Isolation).
            </p>
          ) : null}
        </fieldset>

        <fieldset className="md:col-span-2">
          <legend className="text-[11px] text-ink-dim">최고 보안등급</legend>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {SECURITY_CLASS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setSecurityClass(c)}
                disabled={busy}
                aria-pressed={securityClass === c}
                className={`rounded-md border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-50 ${
                  securityClass === c
                    ? 'border-accent bg-accent/15 text-ink'
                    : 'border-line text-ink-muted hover:text-ink-dim'
                }`}
              >
                {SECURITY_CLASS_LABEL_KO[c]}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[10.5px] text-ink-muted">
            이 등급보다 높은 자료는 값 자체가 내려가지 않습니다. 04_권한 시트에서 Vault를 보는
            역할은 Chairman뿐입니다.
          </p>
        </fieldset>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-[11.5px] text-critical"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex justify-end">
        <button
          type="submit"
          disabled={!canSave}
          className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-ink transition-opacity disabled:opacity-40"
        >
          <Icon name="user-plus" className="size-3.5" />
          {busy ? '저장하는 중…' : '초대 저장'}
        </button>
      </div>
    </form>
  )
}
