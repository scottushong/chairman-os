'use client'

import { useState } from 'react'

import { inviteUser } from '@/app/actions/users'
import { Icon } from '@/components/ui/icon'
import { kstToday } from '@/lib/chairman-project'
import {
  INVITABLE_ROLE,
  PERSON_LANGUAGE_LABEL_KO,
  ROLE_LABEL_KO,
  SECURITY_CLASS,
  SECURITY_CLASS_LABEL_KO,
  needsChairmanApproval,
  type Business,
  type PersonLanguage,
  type Role,
  type SecurityClass,
  type SessionUser,
  type Team,
  type UserAccount,
} from '@/types'

/**
 * CH-049 + Phase 6-1 블록 B-4 — 사용자 초대 폼.
 *
 * 계정을 만드는 폼이 아니다. "이 이메일로 계정이 생기면 이 역할을 준다"를 적는 폼이다 —
 * 계정 생성은 service_role을 요구하고 이 프로젝트에는 없다(0011 머리 주석 / DEFERRED D-15).
 *
 * 0026이 이 폼에 더한 것 둘.
 *   ① **직속 상사가 필수다.** 초대 범위 = 자기 subtree이고, 그 판정의 입력이 이 칸이다.
 *      기본값은 초대자 자신이다(회장 지시). 비워 보내면 회장 외에는 DB가 42501로 거부한다.
 *   ② **Executive 이상은 회장 결재 큐로 간다.** 그 사실을 보내기 **전에** 말해 준다 —
 *      보내고 나서 알게 하지 않는다. 판정 기준은 트리거와 같은 role_rank >= 2다
 *      (types/permissions.ts needsChairmanApproval). 두 곳이 갈라지면 화면이 거짓말을 한다.
 *
 * 팀장은 **팀이 고정이다** — 자기 팀으로만 부른다. 회장은 고정되지 않는다.
 *
 * **역할은 고정하지 않는다.** 브리프는 "자기보다 아래 역할만"이라고 적었지만 원문의 검증 d가
 * "팀장이 Executive 초대 → 회장 큐"다. 원문이 이긴다 — 그리고 0026도 같은 판단으로 역할에
 * 상한을 두지 않았다(그 파일 4-4절: "높은 역할은 막는 것이 아니라 결재로 올린다"). 화면에서
 * 위 역할을 지우면 회장 결재 큐가 존재할 이유 자체가 사라지고, 검증 d가 화면에서 성립하지 않는다.
 * 권한 상승을 막는 것은 역할이 아니라 **등급과 회사**이고, 그 둘은 DB가 막는다.
 *
 * chairman_approval_required는 **보내지 않는다.** 0026의 트리거가 덮어쓴다 —
 * 클라이언트가 정할 수 있으면 그것은 결재가 아니다.
 */

/** 0002의 has_group_scope()와 같은 목록. actions/users.ts와도 같아야 한다. */
const GROUP_SCOPE: readonly Role[] = ['Chairman', 'GroupCFO']

/**
 * 사람에게 줄 수 있는 최고 등급에서 '공개'는 뺀다.
 *
 * 0025가 더한 'Public'은 **문서에 붙이는** 등급이다("이건 전 직원이 본다"). 그것을 사람의
 * 최고 열람 등급으로 주면 반대 뜻이 된다 — 공지 말고는 아무것도 못 보는 계정이다.
 */
const GRANTABLE_CLASS = SECURITY_CLASS.filter((c) => c !== 'Public')

const LANGUAGES: PersonLanguage[] = ['ko', 'en']

export function InviteUser({
  businesses,
  teams,
  people,
  viewer,
  viewerAccount,
  initiallyOpen = false,
}: {
  businesses: Business[]
  teams: Team[]
  /** 초대자가 볼 수 있는 사람들(이미 subtree로 잘려 온다). 상사 후보가 여기서 나온다. */
  people: UserAccount[]
  viewer: SessionUser | null
  /** 초대자 본인의 프로필 행. 팀장의 팀·역할 상한이 여기서 나온다. */
  viewerAccount: UserAccount | null
  /**
   * 주소로 폼을 펼친 채 열 수 있게 한다(/settings/users?invite=1).
   * 접힌 폼은 이 화면의 주인공이 목록이기 때문이고, 그래도 '사람을 부르는 자리'를 링크로
   * 지목할 수 있어야 한다 — 조직도 경고가 고치는 곳으로 데려가는 것과 같은 결이다.
   */
  initiallyOpen?: boolean
}) {
  const isChairman = viewer?.role === 'Chairman'
  /** 팀장 위임: 자기 팀으로, 자기보다 아래 역할만. 회장은 고정되지 않는다. */
  const fixedTeam = !isChairman ? (viewerAccount?.team_id ?? null) : null
  // 처음에 고를 값은 '직원'이다. 대부분의 초대가 그것이고, 위 역할은 고르는 순간
  // '회장 결재가 필요합니다'가 뜬다 — 목록 자체는 좁히지 않는다(머리 주석).

  const [open, setOpen] = useState(initiallyOpen)
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [displayNameEn, setDisplayNameEn] = useState('')
  const [titleKo, setTitleKo] = useState('')
  const [role, setRole] = useState<Role>('Member')
  const [securityClass, setSecurityClass] = useState<SecurityClass>('Normal')
  const [businessIds, setBusinessIds] = useState<string[]>(
    viewerAccount && viewerAccount.business_ids.length > 0 ? [...viewerAccount.business_ids] : [],
  )
  const [teamId, setTeamId] = useState<string>(fixedTeam ?? '')
  const [reportsTo, setReportsTo] = useState<string>(viewer?.user_id ?? '')
  const [joinedOn, setJoinedOn] = useState<string>(kstToday())
  const [language, setLanguage] = useState<PersonLanguage>('ko')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [queued, setQueued] = useState(false)

  const groupScope = GROUP_SCOPE.includes(role)
  const approval = needsChairmanApproval(role)
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
      displayNameEn,
      titleKo,
      role,
      securityClass,
      businessIds,
      teamId: fixedTeam ?? teamId,
      reportsTo: reportsTo || viewer?.user_id,
      joinedOn,
      language,
    })
    setBusy(false)

    if (result.error) {
      setError(result.error)
      return
    }

    // 목록은 서버가 다시 그린다(revalidatePath). 여기서는 다음에 할 일만 말한다.
    setDone(result.invitation?.email ?? email)
    // 결재가 붙었는지는 **서버가 돌려준 행**을 본다. 화면의 예고와 실제가 갈리면
    // 갈린 쪽이 사실이어야 한다(그 값은 0026의 트리거가 정한다).
    setQueued(Boolean(result.invitation?.chairman_approval_required && !result.invitation.chairman_approved_at))
    setEmail('')
    setDisplayName('')
    setDisplayNameEn('')
    setTitleKo('')
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
          className="flex items-center gap-1.5 rounded-md border border-line bg-panel px-3 py-1.5 text-t12 text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          <Icon name="user-plus" className="size-3.5" />
          사용자 초대
        </button>

        {/* 초대만으로 끝나지 않는다. 다음 한 걸음을 여기서 말한다. */}
        {done ? (
          <p className="rounded-lg border border-ok/40 bg-ok/10 px-3 py-2.5 text-t11h leading-relaxed text-ink-dim">
            <span className="font-semibold text-ink">{done}</span> 초대를 저장했습니다.
            {queued
              ? ' 회장 결재 대기로 들어갔습니다 — 승인 전에는 계정이 생겨도 권한이 붙지 않습니다.'
              : ' 아직 계정은 없습니다 — Supabase Dashboard → Authentication → Users에서 이 주소로 계정을 만들거나 초대 메일을 보내세요. 계정이 생기는 순간 권한이 자동으로 붙습니다(0011 on_auth_user_created).'}
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
        <h2 className="text-t13 font-semibold">사용자 초대</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-t11 text-ink-muted transition-colors hover:text-ink"
        >
          닫기
        </button>
      </div>
      <p className="mt-1 text-t11 leading-relaxed text-ink-muted">
        여기서 계정이 만들어지지는 않습니다. 이 주소로 계정이 생기면 아래 권한을 준다는 약속을
        저장합니다 — 메일은 Supabase Dashboard에서 보냅니다(DEFERRED D-15).
      </p>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="text-t11 text-ink-dim">이메일</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            placeholder="name@example.co.kr"
            maxLength={254}
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2 text-t13 text-ink outline-none placeholder:text-ink-muted focus:border-accent disabled:opacity-50"
          />
        </label>

        <label className="block">
          <span className="text-t11 text-ink-dim">직함 (선택)</span>
          <input
            value={titleKo}
            onChange={(e) => setTitleKo(e.target.value)}
            placeholder="예: 재무팀장"
            maxLength={60}
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2 text-t13 text-ink outline-none placeholder:text-ink-muted focus:border-accent disabled:opacity-50"
          />
        </label>

        <label className="block">
          <span className="text-t11 text-ink-dim">이름 (한글)</span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="예: 김민수"
            maxLength={60}
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2 text-t13 text-ink outline-none placeholder:text-ink-muted focus:border-accent disabled:opacity-50"
          />
          {/* 이메일이 목록에 안 뜨는 이유를 여기서 말한다. auth.users는 PostgREST로 안 읽힌다. */}
          <span className="mt-1 block text-t10h text-ink-muted">
            사용자 목록에서 사람을 가리는 값입니다. 이메일은 계정이 생기면 목록에서 사라집니다.
          </span>
        </label>

        <label className="block">
          <span className="text-t11 text-ink-dim">이름 (영문, 선택)</span>
          <input
            value={displayNameEn}
            onChange={(e) => setDisplayNameEn(e.target.value)}
            placeholder="예: Minsu Kim"
            maxLength={60}
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2 text-t13 text-ink outline-none placeholder:text-ink-muted focus:border-accent disabled:opacity-50"
          />
          <span className="mt-1 block text-t10h text-ink-muted">
            비워 두면 영문 줄을 그리지 않습니다 — 철자는 본인이 쓰는 것이 유일한 정답이라
            코드가 지어내지 않습니다.
          </span>
        </label>

        <label className="block">
          <span className="text-t11 text-ink-dim">
            역할 {isChairman ? '' : '— 자기보다 위 역할은 회장 결재로 갑니다'}
          </span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2 text-t13 text-ink outline-none focus:border-accent disabled:opacity-50"
          >
            {INVITABLE_ROLE.map((r) => (
              <option key={r} value={r} className="bg-panel">
                {ROLE_LABEL_KO[r]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-t11 text-ink-dim">
            팀 {fixedTeam ? '— 팀장은 자기 팀으로만 부릅니다' : ''}
          </span>
          <select
            value={fixedTeam ?? teamId}
            onChange={(e) => setTeamId(e.target.value)}
            disabled={busy || Boolean(fixedTeam)}
            className="mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2 text-t13 text-ink outline-none focus:border-accent disabled:opacity-50"
          >
            <option value="" className="bg-panel">
              (나중에 배정)
            </option>
            {teams.map((t) => (
              <option key={t.team_id} value={t.team_id} className="bg-panel">
                {t.name} · {t.name_en}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-t11 text-ink-dim">직속 상사</span>
          <select
            value={reportsTo}
            onChange={(e) => setReportsTo(e.target.value)}
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2 text-t13 text-ink outline-none focus:border-accent disabled:opacity-50"
          >
            {viewer ? (
              <option value={viewer.user_id} className="bg-panel">
                {viewer.name} (나)
              </option>
            ) : null}
            {people
              .filter((p) => p.user_id !== viewer?.user_id && !p.revoked_at)
              .map((p) => (
                <option key={p.user_id} value={p.user_id} className="bg-panel">
                  {p.display_name} · {ROLE_LABEL_KO[p.role]}
                </option>
              ))}
          </select>
          <span className="mt-1 block text-t10h text-ink-muted">
            초대는 자기 아래로만 할 수 있습니다. 이 목록에 없는 사람 밑으로는 부를 수 없습니다(0026).
          </span>
        </label>

        <label className="block">
          <span className="text-t11 text-ink-dim">입사일</span>
          <input
            value={joinedOn}
            onChange={(e) => setJoinedOn(e.target.value)}
            type="date"
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2 text-t13 text-ink outline-none focus:border-accent disabled:opacity-50"
          />
          <span className="mt-1 block text-t10h text-ink-muted">
            비워 두면 계정이 생기는 날(KST)이 입사일이 됩니다.
          </span>
        </label>

        <fieldset className="md:col-span-2">
          <legend className="text-t11 text-ink-dim">표기 언어</legend>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {LANGUAGES.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLanguage(l)}
                disabled={busy}
                aria-pressed={language === l}
                className={`rounded-md border px-2.5 py-1 text-t11 transition-colors disabled:opacity-50 ${
                  language === l
                    ? 'border-accent bg-accent/15 text-ink'
                    : 'border-line text-ink-muted hover:text-ink-dim'
                }`}
              >
                {PERSON_LANGUAGE_LABEL_KO[l]}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-t10h text-ink-muted">
            이 사람이 ko/en 중 어느 쪽 표기를 쓰는지입니다. 화면 전체를 영어로 바꾸는 장치는
            아직 없습니다 — 이름·팀 이름이 두 벌로 저장되는 것이 지금의 이중 언어입니다.
          </p>
        </fieldset>

        <fieldset className="md:col-span-2">
          <legend className="text-t11 text-ink-dim">
            회사 범위 {groupScope ? '— 전사 역할이라 고르지 않습니다' : ''}
          </legend>
          {groupScope ? (
            <p className="mt-1.5 rounded-lg bg-raised px-3 py-2 text-t11h text-ink-muted">
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
                  className={`rounded-md border px-2.5 py-1 text-t11 transition-colors disabled:opacity-50 ${
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
            <p className="mt-1.5 text-t10h text-ink-muted">
              여기 없는 회사는 이 사람에게 존재하지 않는 것처럼 보입니다(Business Isolation).
              자기가 못 보는 회사는 줄 수 없습니다 — DB가 거부합니다.
            </p>
          ) : null}
        </fieldset>

        <fieldset className="md:col-span-2">
          <legend className="text-t11 text-ink-dim">최고 보안등급</legend>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {GRANTABLE_CLASS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setSecurityClass(c)}
                disabled={busy}
                aria-pressed={securityClass === c}
                className={`rounded-md border px-2.5 py-1 text-t11 transition-colors disabled:opacity-50 ${
                  securityClass === c
                    ? 'border-accent bg-accent/15 text-ink'
                    : 'border-line text-ink-muted hover:text-ink-dim'
                }`}
              >
                {SECURITY_CLASS_LABEL_KO[c]}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-t10h text-ink-muted">
            이 등급보다 높은 자료는 값 자체가 내려가지 않습니다. 자기 등급보다 높은 등급은 줄 수
            없습니다 — 초대 화면이 등급 상승 창구가 되지 않게 DB가 막습니다.
          </p>
        </fieldset>
      </div>

      {/* 보내기 전에 말한다. 판정 기준은 0026의 트리거와 같다(role_rank >= 2). */}
      {approval ? (
        <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-t11h leading-relaxed text-ink-dim">
          <span className="font-semibold text-ink">회장 결재가 필요합니다.</span>{' '}
          {ROLE_LABEL_KO[role]} 이상은 결재 큐로 갑니다 — 승인 전에는 계정이 생겨도 권한이 붙지
          않습니다. {isChairman ? '회장이 직접 넣은 초대는 그 자리에서 결재된 것으로 남습니다.' : ''}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-t11h text-critical"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex justify-end">
        <button
          type="submit"
          disabled={!canSave}
          className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-t12 font-semibold text-ink transition-opacity disabled:opacity-40"
        >
          <Icon name="user-plus" className="size-3.5" />
          {busy ? '저장하는 중…' : '초대 저장'}
        </button>
      </div>
    </form>
  )
}
