'use client'

import { useState } from 'react'

import { staffAdminInvite, staffAdminRevoke } from '@/app/actions/users'
import { CopySignupGuide } from '@/components/settings/invite-user'
import { Icon } from '@/components/ui/icon'
import { roleLabelFor } from '@/lib/boss'
import { kstToday } from '@/lib/chairman-project'
import { DRAFT_DECISION_MODULE } from '@/lib/module-grants'
import {
  ROLE_LABEL_KO,
  SECURITY_CLASS,
  SECURITY_CLASS_LABEL_KO,
  type Role,
  type SecurityClass,
  type StaffAdminOptions,
} from '@/types'

/**
 * 0055 «<회사> 사용자 관리자»의 직원 초대 폼(회장 결정 B).
 *
 * 0011/0026 초대 폼(invite-user.tsx)과 다른 점:
 *   · 회사는 하나(관리자가 맡은 회사) · 역할은 사원 · 팀장 둘만 — 그 위는 대표가 초대한다(DB가 거부).
 *   · 팀과 상사가 **필수**다. 상사가 비면 저장 버튼이 꺼지고 그 이유를 말한다.
 *   · 상사 후보는 그 회사의 사람 중 관리자 본인 · 그 아래를 뺀 사람이다(0055 staff_admin_options) —
 *     사용자 관리는 업무 열람과 따로다. 본인 아래로 넣으면 그 사람의 결재 · 업무가 관리자에게 보이게 된다.
 *   · 권한 체크는 관리자가 지금 가진 것만 그린다(재무 입력 · 문서 등록 · 결재 올리기). 월 마감은 칸이 없다.
 * 판정 · 감사 · 대표 알림은 DB(staff_admin_invite)가 한다. 이 폼은 안내다.
 */

const LABEL_OF = (module: string, company: string): string =>
  module === DRAFT_DECISION_MODULE
    ? '결재 올리기'
    : module.startsWith('/finance/')
      ? `${company} 재무 입력`
      : `${company} 문서 등록`

const NOTE_OF = (module: string): string =>
  module === DRAFT_DECISION_MODULE
    ? '전자결재 양식(지출 · 구매 · 휴가 · 계약 · 채용)을 올립니다. 새 직원에게는 원래 켜집니다.'
    : module.startsWith('/finance/')
      ? '전표 · 월별 손익 · 공식 결산 입력. 월 마감은 포함되지 않습니다.'
      : '문서 링크 · 폴더 등록.'

export function StaffAdminInvite({
  options,
  companyName,
  viewerRole,
  initiallyOpen = false,
}: {
  options: StaffAdminOptions
  companyName: string
  viewerRole: Role
  initiallyOpen?: boolean
}) {
  const [open, setOpen] = useState(initiallyOpen)
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [displayNameEn, setDisplayNameEn] = useState('')
  const [titleKo, setTitleKo] = useState('')
  const [role, setRole] = useState<Role>('Member')
  const [teamId, setTeamId] = useState('')
  const [reportsTo, setReportsTo] = useState('')
  const [securityClass, setSecurityClass] = useState<SecurityClass>('Normal')
  const [grants, setGrants] = useState<string[]>(options.grantable.filter((g) => g === DRAFT_DECISION_MODULE))
  const [joinedOn, setJoinedOn] = useState(kstToday())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ email: string; name: string } | null>(null)

  const maxRank = SECURITY_CLASS.indexOf(options.max_class)
  const classChoices = SECURITY_CLASS.filter((c) => c !== 'Public' && SECURITY_CLASS.indexOf(c) <= maxRank)
  const teamName = (id: string | null) => options.teams.find((t) => t.team_id === id)?.name ?? null
  const missing = [
    !email.trim() ? '이메일' : null,
    !displayName.trim() ? '이름' : null,
    !teamId ? '팀' : null,
    !reportsTo ? '상사' : null,
  ].filter(Boolean)
  const canSave = missing.length === 0 && !busy

  function toggle(module: string) {
    setGrants((gs) => (gs.includes(module) ? gs.filter((g) => g !== module) : [...gs, module]))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSave) return
    setBusy(true)
    setError(null)
    const result = await staffAdminInvite({
      businessId: options.business_id,
      email,
      displayName,
      displayNameEn,
      titleKo,
      role,
      teamId,
      reportsTo,
      securityClass,
      grants,
      joinedOn,
      language: 'ko',
    })
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setDone({ email: result.invitation?.email ?? email.trim().toLowerCase(), name: result.invitation?.display_name ?? displayName.trim() })
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
          직원 초대 · {companyName}
        </button>
        {done ? (
          <div className="rounded-lg border border-ok/40 bg-ok/10 px-3 py-2.5 text-t11h leading-relaxed text-ink-dim">
            <span className="font-semibold text-ink">{done.email}</span> 초대를 저장했습니다. 대표에게 알림이 갔습니다.
            아직 계정은 없습니다 — 아래 안내 문구를 본인에게 보내면 본인이 가입하고, 가입하는 순간 권한이 붙습니다.
            <CopySignupGuide name={done.name} email={done.email} />
          </div>
        ) : null}
      </div>
    )
  }

  const input =
    'mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2 text-t13 text-ink outline-none placeholder:text-ink-muted focus:border-accent disabled:opacity-50'

  return (
    <form onSubmit={submit} aria-label="직원 초대" className="w-full rounded-xl border border-line bg-panel p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-t13 font-semibold">직원 초대 · {companyName}</h2>
        <button type="button" onClick={() => setOpen(false)} className="text-t11 text-ink-muted transition-colors hover:text-ink">
          닫기
        </button>
      </div>
      <p className="mt-1 text-t11 leading-relaxed text-ink-muted">
        {companyName}의 사원 · 팀장을 초대합니다. 저장하면 대표에게 알림이 가고, 본인이 가입하는 순간 아래 권한이 붙습니다.
        본인이 가진 권한까지만 줄 수 있습니다.
      </p>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="text-t11 text-ink-dim">이메일 (필수)</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="name@example.co.kr"
            maxLength={254} disabled={busy} className={input} />
          <span className="mt-1 block text-t10h text-ink-muted">본인이 이 주소로만 가입할 수 있습니다.</span>
        </label>
        <label className="block">
          <span className="text-t11 text-ink-dim">이름 (한글, 필수)</span>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="예: 김민수"
            maxLength={60} disabled={busy} className={input} />
        </label>
        <label className="block">
          <span className="text-t11 text-ink-dim">이름 (영문, 선택)</span>
          <input value={displayNameEn} onChange={(e) => setDisplayNameEn(e.target.value)} placeholder="예: Minsu Kim"
            maxLength={60} disabled={busy} className={input} />
        </label>
        <label className="block">
          <span className="text-t11 text-ink-dim">직함 (선택)</span>
          <input value={titleKo} onChange={(e) => setTitleKo(e.target.value)} placeholder="예: 대리" maxLength={60}
            disabled={busy} className={input} />
        </label>

        <label className="block">
          <span className="text-t11 text-ink-dim">역할</span>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={busy} className={input}>
            <option value="Member">사원</option>
            <option value="TeamLead">팀장</option>
          </select>
          <span className="mt-1 block text-t10h text-ink-muted">임원 이상은 대표가 초대합니다.</span>
        </label>
        <label className="block">
          <span className="text-t11 text-ink-dim">팀 (필수)</span>
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)} disabled={busy} className={input}>
            <option value="">— 팀을 고르세요 —</option>
            {options.teams.map((t) => (
              <option key={t.team_id} value={t.team_id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block md:col-span-2">
          <span className="text-t11 text-ink-dim">상사 (필수)</span>
          <select value={reportsTo} onChange={(e) => setReportsTo(e.target.value)} disabled={busy} className={input}>
            <option value="">— 상사를 고르세요 —</option>
            {options.people.map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {p.display_name} · {roleLabelFor(ROLE_LABEL_KO[p.role], p.role, viewerRole)}
                {teamName(p.team_id) ? ` · ${teamName(p.team_id)}` : ''}
              </option>
            ))}
          </select>
          <span className={`mt-1 block text-t10h ${reportsTo ? 'text-ink-muted' : 'text-warning'}`}>
            {reportsTo
              ? '이 사람의 결재 · 업무를 보게 되는 사람입니다. 실제로 일을 맡기는 사람을 고르세요.'
              : '상사를 고르지 않으면 저장할 수 없습니다. 팀장이 있으면 보통 그 팀장, 없으면 대표입니다. 본인은 목록에 없습니다.'}
          </span>
        </label>

        <label className="block">
          <span className="text-t11 text-ink-dim">보안등급</span>
          <select value={securityClass} onChange={(e) => setSecurityClass(e.target.value as SecurityClass)} disabled={busy} className={input}>
            {classChoices.map((c) => (
              <option key={c} value={c}>
                {SECURITY_CLASS_LABEL_KO[c]}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-t10h text-ink-muted">본인 등급보다 높게는 줄 수 없습니다. 모르면 «{SECURITY_CLASS_LABEL_KO.Normal}» 그대로.</span>
        </label>
        <label className="block">
          <span className="text-t11 text-ink-dim">입사일</span>
          <input type="date" value={joinedOn} onChange={(e) => setJoinedOn(e.target.value)} disabled={busy} className={input} />
        </label>

        <fieldset className="rounded-lg border border-line-soft px-2.5 py-2 md:col-span-2">
          <legend className="px-1 text-t11 text-ink-dim">권한 (본인이 가진 것만 보입니다)</legend>
          {options.grantable.length === 0 ? (
            <p className="text-t10h text-ink-muted">줄 수 있는 권한이 없습니다. 회사 범위만 붙습니다.</p>
          ) : (
            options.grantable.map((g) => (
              <label key={g} className="flex min-h-11 items-start gap-1.5 py-1 text-t12 sm:min-h-0">
                <input type="checkbox" checked={grants.includes(g)} disabled={busy} onChange={() => toggle(g)}
                  className="mt-0.5 size-4 accent-[var(--color-accent)] disabled:opacity-50" />
                <span>
                  <span className="font-semibold">{LABEL_OF(g, companyName)}</span>
                  <span className="block text-t10 text-ink-muted">{NOTE_OF(g)}</span>
                </span>
              </label>
            ))
          )}
        </fieldset>
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-t11h text-critical">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {missing.length > 0 ? <span className="text-t10h text-warning">채울 칸: {missing.join(' · ')}</span> : null}
        <button
          type="submit"
          disabled={!canSave}
          className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-t12 font-semibold text-ink transition-opacity disabled:opacity-40"
        >
          {busy ? '저장 중…' : '초대 저장'}
        </button>
      </div>
    </form>
  )
}

/** 관리자 본인의 대기 위임 초대 취소 — 두 번 눌러야 나간다(revoke-button.tsx와 같은 모양). */
export function StaffAdminRevokeButton({ invitationId, label }: { invitationId: string; label: string }) {
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (error) {
    return (
      <span role="alert" className="text-t10h text-critical">
        {error}
      </span>
    )
  }
  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        aria-label={`${label} 초대 취소`}
        className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-t10h text-ink-muted transition-colors hover:border-critical/50 hover:text-critical"
      >
        <Icon name="user-minus" className="size-3" />
        초대 취소
      </button>
    )
  }
  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          const result = await staffAdminRevoke({ invitationId })
          setBusy(false)
          if (result.error) setError(result.error)
          setArmed(false)
        }}
        className="rounded-md border border-critical/50 bg-critical/10 px-2 py-1 text-t10h font-semibold text-critical disabled:opacity-50"
      >
        {busy ? '취소 중…' : '정말 취소'}
      </button>
      <button type="button" onClick={() => setArmed(false)} className="px-1 text-t10h text-ink-muted hover:text-ink">
        아니오
      </button>
    </span>
  )
}
