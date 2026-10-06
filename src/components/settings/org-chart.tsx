'use client'

import { createContext, useContext, useMemo, useState } from 'react'

import { saveTeam, setDraftGrant, setModuleGrant, updateUserProfile } from '@/app/actions/users'
import { ProfilePhoto } from '@/components/settings/profile-photo'
import { ForceLogoutButton } from '@/components/settings/force-logout-button'
import { RevokeButton } from '@/components/settings/revoke-button'
import { Icon } from '@/components/ui/icon'
import { roleLabelFor } from '@/lib/boss'
import { businessName } from '@/lib/lookup'
import { businessOfModule, hasDraftGrant, moduleKey } from '@/lib/module-grants'
import {
  INVITABLE_ROLE,
  MODULE_GRANT_OPTIONS,
  PERSON_LANGUAGE_LABEL_KO,
  ROLE_LABEL_KO,
  SECURITY_CLASS_LABEL_KO,
  SYSTEM_ROLE,
  type Business,
  type Role,
  type SessionUser,
  type Team,
  type UserAccount,
} from '@/types'

/**
 * Phase 6-1 블록 B — 조직도(회사 > 팀 > 사람).
 *
 * **여기서 사람을 거르지 않는다.** 이 컴포넌트가 받는 목록은 이미 잘려 있다 —
 * 0026의 user_profiles_self_read가 "본인 OR 회장 OR 내 subtree"만 내주고, 0025의
 * teams_read가 남의 회사 팀을 아예 안 내준다. 화면에서 한 번 더 거르면 규칙이 두 곳으로
 * 갈라지고, 갈라지는 순간 둘 중 하나는 틀린 것이 된다. 여기서 하는 일은 **받은 것을
 * 회사 > 팀 > 사람으로 접어 그리는 것**과, 빈 자리를 경고로 말하는 것뿐이다.
 *
 * 그래서 팀장 세션에서 이 화면이 자기 팀만 보여 주는 것은 고장이 아니다. 위와 옆은
 * 존재도 보이지 않는 것이 이 화면의 요구다(회장 지시 블록 B-1).
 *
 * 고치는 버튼은 회장에게만 그린다. 지금 사람의 역할·팀·상사를 고칠 수 있는 사람은
 * 회장뿐이고(0002 user_profiles_admin_write), 팀을 만들고 고치는 것도 회장뿐이다
 * (0025 teams_write). **그리는 것은 안내이고 자물쇠는 DB다** — 버튼이 없다고 막히는 것이
 * 아니라, 눌러도 DB가 거부한다. 반대로 권한 없는 사람에게 버튼을 그려 두면 그 사람은
 * 눌러 본 뒤에야 안 된다는 걸 알게 된다.
 */

type Selection = { kind: 'person'; id: string } | { kind: 'team'; id: string } | { kind: 'new-team' } | null

/** 회사를 이끄는 자리와 시스템 계정은 팀에 매달리지 않는다 — 이들의 team_id null은 경고가 아니다. */
const TEAMLESS_BY_DESIGN: readonly Role[] = ['Chairman', 'GroupCFO', 'BusinessCEO', ...SYSTEM_ROLE]

const UNASSIGNED = '__unassigned__'
const GROUP_TAB = '__group__'
const SYSTEM_TAB = '__system__'

/**
 * 보는 사람의 역할. 역할 라벨 «Chairman»을 회장 외에게는 «대표»로 그린다
 * (직원 화면 용어 원칙(CLAUDE.md) · lib/boss.ts roleLabelFor). 줄마다 prop으로 내리지 않고 한 번 건다.
 */
const ViewerRoleContext = createContext<Role | null>(null)

function useRoleLabel(): (role: Role) => string {
  const viewerRole = useContext(ViewerRoleContext)
  return (role) => roleLabelFor(ROLE_LABEL_KO[role], role, viewerRole)
}

export function OrgChart({
  people,
  teams,
  businesses,
  viewer,
  photoUrls,
}: {
  people: UserAccount[]
  teams: Team[]
  businesses: Business[]
  viewer: SessionUser | null
  /**
   * 0032. signProfilePhotos()가 **보이는 사람들의 경로만** 서명해 준 맵이다.
   * 사람마다 부르지 않는다(로고 카드 그리드와 같은 방식). 여기 없는 경로는 이름
   * 첫 글자로 떨어진다 — 서명이 실패한 것과 사진이 없는 것을 화면은 같게 다룬다.
   */
  photoUrls: Record<string, string>
}) {
  const canManage = viewer?.role === 'Chairman'
  const [selection, setSelection] = useState<Selection>(null)

  const humans = useMemo(() => people.filter((p) => !SYSTEM_ROLE.includes(p.role)), [people])
  const systems = useMemo(() => people.filter((p) => SYSTEM_ROLE.includes(p.role)), [people])

  /** 탭 = 보이는 회사들 + (회사 범위가 없는 사람이 있으면) 전사 + 시스템 계정. */
  const companyIds = useMemo(() => {
    const ids = new Set<string>()
    for (const t of teams) ids.add(t.business_id)
    for (const p of humans) for (const b of p.business_ids) ids.add(b)
    return [...ids].sort()
  }, [teams, humans])

  const groupScopePeople = humans.filter((p) => p.business_ids.length === 0)
  const tabs = [
    ...companyIds.map((id) => ({ id, label: businessName(businesses, id) })),
    ...(groupScopePeople.length > 0 ? [{ id: GROUP_TAB, label: '전사' }] : []),
    { id: SYSTEM_TAB, label: '시스템 계정' },
  ]
  const [tab, setTab] = useState(tabs[0]?.id ?? SYSTEM_TAB)
  const activeTab = tabs.some((t) => t.id === tab) ? tab : (tabs[0]?.id ?? SYSTEM_TAB)

  // ── 경고 세 종 (블록 B-2) ────────────────────────────────────────────
  //   세는 것에서 끝내지 않는다. 누르면 그 팀·그 사람의 편집 패널이 열린다.
  const leadlessTeams = teams.filter((t) => !t.lead_user_id)
  const teamlessPeople = humans.filter((p) => !p.team_id && !TEAMLESS_BY_DESIGN.includes(p.role) && !p.revoked_at)
  const bosslessPeople = humans.filter((p) => !p.reports_to && p.role !== 'Chairman' && !p.revoked_at)

  const byId = useMemo(() => new Map(people.map((p) => [p.user_id, p])), [people])
  const selected =
    selection?.kind === 'person' ? (byId.get(selection.id) ?? null) : null
  const selectedTeam =
    selection?.kind === 'team' ? (teams.find((t) => t.team_id === selection.id) ?? null) : null

  function openPerson(id: string) {
    const person = byId.get(id)
    if (person) {
      const tabFor = SYSTEM_ROLE.includes(person.role)
        ? SYSTEM_TAB
        : (person.business_ids[0] ?? GROUP_TAB)
      setTab(tabFor)
    }
    setSelection({ kind: 'person', id })
  }

  function openTeam(id: string) {
    const team = teams.find((t) => t.team_id === id)
    if (team) setTab(team.business_id)
    setSelection({ kind: 'team', id })
  }

  return (
    <ViewerRoleContext.Provider value={viewer?.role ?? null}>
    {/* 폰에서는 카드 사이를 12px로 좁힌다(회장 규칙 «카드 간격 12px»). 넓은 화면은 그대로. */}
    <div className="grid gap-3 sm:gap-3.5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-3 sm:space-y-3.5">
        <WarningBar
          leadlessTeams={leadlessTeams}
          teamless={teamlessPeople}
          bossless={bosslessPeople}
          onTeam={openTeam}
          onPerson={openPerson}
        />

        <section className="rounded-xl border border-line-soft bg-panel p-3.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-pressed={activeTab === t.id}
                className={`rounded-md border px-2.5 py-1 text-t11h transition-colors ${
                  activeTab === t.id
                    ? 'border-accent bg-accent/15 text-ink'
                    : 'border-line text-ink-muted hover:text-ink-dim'
                }`}
              >
                {t.label}
              </button>
            ))}
            {canManage ? (
              <button
                type="button"
                onClick={() => setSelection({ kind: 'new-team' })}
                className="ml-auto flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-t11h text-ink-dim transition-colors hover:border-accent hover:text-ink"
              >
                <Icon name="plus" className="size-3.5" />팀 추가
              </button>
            ) : null}
          </div>

          <div className="mt-3">
            {activeTab === SYSTEM_TAB ? (
              <SystemAccounts
                people={systems}
                selection={selection}
                photoUrls={photoUrls}
                onSelect={openPerson}
              />
            ) : activeTab === GROUP_TAB ? (
              <PeopleGroup
                title="전사 (회사 범위 없음)"
                note="전사 역할은 user_business_access에 행이 없고 그래도 전부 봅니다(0002 has_business)."
                people={groupScopePeople}
                selection={selection}
                photoUrls={photoUrls}
                onSelect={openPerson}
              />
            ) : (
              <CompanyTree
                businessId={activeTab}
                businesses={businesses}
                teams={teams.filter((t) => t.business_id === activeTab)}
                people={humans.filter((p) => p.business_ids.includes(activeTab))}
                selection={selection}
                photoUrls={photoUrls}
                onSelectPerson={openPerson}
                onSelectTeam={openTeam}
              />
            )}
          </div>
        </section>
      </div>

      <aside className="xl:sticky xl:top-4 xl:self-start">
        {selection?.kind === 'new-team' && canManage ? (
          <TeamPanel
            team={null}
            businesses={businesses}
            people={humans}
            onClose={() => setSelection(null)}
          />
        ) : selectedTeam ? (
          <TeamPanel
            team={selectedTeam}
            businesses={businesses}
            people={humans.filter((p) => p.team_id === selectedTeam.team_id)}
            canManage={canManage}
            onClose={() => setSelection(null)}
          />
        ) : selected ? (
          <PersonPanel
            person={selected}
            people={people}
            teams={teams}
            businesses={businesses}
            canManage={canManage}
            self={selected.user_id === viewer?.user_id}
            photoUrls={photoUrls}
            onClose={() => setSelection(null)}
          />
        ) : (
          <div className="rounded-xl border border-dashed border-line bg-panel/60 p-4 text-t11h leading-relaxed text-ink-muted">
            사람이나 팀을 누르면 여기에 상세가 열립니다. 위 경고를 눌러도 그 자리로 옵니다.
          </div>
        )}
      </aside>
    </div>
    </ViewerRoleContext.Provider>
  )
}

/** 경고 셋. 0건이면 그 칩은 그리지 않는다 — 늘 켜져 있는 경고는 아무도 보지 않는다. */
function WarningBar({
  leadlessTeams,
  teamless,
  bossless,
  onTeam,
  onPerson,
}: {
  leadlessTeams: Team[]
  teamless: UserAccount[]
  bossless: UserAccount[]
  onTeam: (id: string) => void
  onPerson: (id: string) => void
}) {
  const total = leadlessTeams.length + teamless.length + bossless.length
  if (total === 0) {
    return (
      <p className="rounded-xl border border-ok/30 bg-ok/5 px-3.5 py-2 text-t11h text-ink-dim">
        조직도에 빈 자리가 없습니다 — 팀장 공석 0건 · 팀 미배정 0건 · 상사 없음 0건.
      </p>
    )
  }

  return (
    <section className="rounded-xl border border-warning/40 bg-warning/5 p-3.5">
      <h2 className="flex items-baseline gap-1.5 text-t12h font-semibold text-ink">
        <Icon name="bell" className="size-4 text-warning" />
        조직도 경고
        <span className="text-t11 font-normal text-ink-dim tnum">{total}건</span>
      </h2>
      <p className="mt-1 text-t10h text-ink-dim">
        누르면 그 팀·그 사람의 편집 패널이 열립니다. 세는 것으로 끝내지 않습니다.
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {leadlessTeams.map((t) => (
          <button
            key={t.team_id}
            type="button"
            onClick={() => onTeam(t.team_id)}
            className="rounded-md border border-warning/40 bg-panel px-2 py-1 text-t11 text-ink-dim transition-colors hover:border-accent hover:text-ink"
          >
            팀장 공석 · {t.name}
          </button>
        ))}
        {teamless.map((p) => (
          <button
            key={`team-${p.user_id}`}
            type="button"
            onClick={() => onPerson(p.user_id)}
            className="rounded-md border border-warning/40 bg-panel px-2 py-1 text-t11 text-ink-dim transition-colors hover:border-accent hover:text-ink"
          >
            팀 미배정 · {p.display_name}
          </button>
        ))}
        {bossless.map((p) => (
          <button
            key={`boss-${p.user_id}`}
            type="button"
            onClick={() => onPerson(p.user_id)}
            className="rounded-md border border-warning/40 bg-panel px-2 py-1 text-t11 text-ink-dim transition-colors hover:border-accent hover:text-ink"
          >
            상사 없음 · {p.display_name}
          </button>
        ))}
      </div>
    </section>
  )
}

function CompanyTree({
  businessId,
  businesses,
  teams,
  people,
  selection,
  photoUrls,
  onSelectPerson,
  onSelectTeam,
}: {
  businessId: string
  businesses: Business[]
  teams: Team[]
  people: UserAccount[]
  selection: Selection
  photoUrls: Record<string, string>
  onSelectPerson: (id: string) => void
  onSelectTeam: (id: string) => void
}) {
  const buckets = [
    ...teams.map((t) => ({ team: t, members: people.filter((p) => p.team_id === t.team_id) })),
    // 팀에 매달리지 않은 사람도 회사 아래에 있다. 트리에서 빼면 '보이지 않는 사람'이 생긴다.
    { team: null, members: people.filter((p) => !p.team_id || !teams.some((t) => t.team_id === p.team_id)) },
  ].filter((b) => b.team !== null || b.members.length > 0)

  if (people.length === 0 && teams.length === 0) {
    return (
      <p className="py-8 text-center text-t12 text-ink-muted">
        이 회사에서 보이는 사람이 없습니다. 조직도는 자기 아래(직속·그 아래)만 보여 줍니다 —
        위와 옆은 존재도 보이지 않습니다.
      </p>
    )
  }

  return (
    <div>
      <p className="flex items-center gap-1.5 text-t12h font-semibold">
        <Icon name="building" className="size-4 text-ink-dim" />
        {businessName(businesses, businessId)}
        <span className="text-t11 font-normal text-ink-muted tnum">
          {people.filter((p) => !p.revoked_at).length}명 활성 · 팀 {teams.length}개
        </span>
      </p>

      <ul className="mt-2 space-y-2.5">
        {buckets.map((b) => (
          <li key={b.team?.team_id ?? UNASSIGNED} className="rounded-lg border border-line-soft">
            <div className="flex flex-wrap items-center gap-1.5 border-b border-line-soft px-2.5 py-1.5">
              {b.team ? (
                <button
                  type="button"
                  onClick={() => onSelectTeam(b.team!.team_id)}
                  className={`flex items-center gap-1.5 rounded-md px-1 py-0.5 text-t12 font-semibold transition-colors hover:text-accent ${
                    selection?.kind === 'team' && selection.id === b.team.team_id ? 'text-accent' : ''
                  }`}
                >
                  <Icon name="users" className="size-3.5 text-ink-dim" />
                  {b.team.name}
                  <span className="text-t10h font-normal text-ink-muted">{b.team.name_en}</span>
                </button>
              ) : (
                /* 경고색을 쓰지 않는다. 회사를 이끄는 자리(회장·Group CFO·대표)는 팀에
                   매달리지 않는 것이 정상이라, 이 칸이 늘 빨가면 진짜 경고(위의 '팀 미배정 ·
                   아무개' 칩)가 묻힌다. */
                <span className="flex items-center gap-1.5 text-t12 font-semibold text-ink-dim">
                  <Icon name="users" className="size-3.5" />팀 없음
                </span>
              )}
              <span className="text-t10h text-ink-muted tnum">{b.members.length}명</span>
              {b.team && !b.team.lead_user_id ? (
                <span className="rounded bg-warning/15 px-1.5 py-0.5 text-t10 font-semibold text-warning">
                  팀장 공석
                </span>
              ) : null}
            </div>

            {b.members.length === 0 ? (
              <p className="px-2.5 py-3 text-t11 text-ink-muted">
                이 팀에 보이는 사람이 없습니다.
              </p>
            ) : (
              <ul>
                {[...b.members]
                  .sort(
                    (x, y) =>
                      Number(Boolean(x.revoked_at)) - Number(Boolean(y.revoked_at)) ||
                      x.display_name.localeCompare(y.display_name, 'ko'),
                  )
                  .map((p) => (
                    <PersonRow
                      key={p.user_id}
                      person={p}
                      lead={b.team?.lead_user_id === p.user_id}
                      active={selection?.kind === 'person' && selection.id === p.user_id}
                      photoUrls={photoUrls}
                      onSelect={onSelectPerson}
                    />
                  ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function PeopleGroup({
  title,
  note,
  people,
  selection,
  photoUrls,
  onSelect,
}: {
  title: string
  note: string
  people: UserAccount[]
  selection: Selection
  photoUrls: Record<string, string>
  onSelect: (id: string) => void
}) {
  return (
    <div className="rounded-lg border border-line-soft">
      <div className="border-b border-line-soft px-2.5 py-1.5">
        <p className="text-t12 font-semibold">{title}</p>
        <p className="mt-0.5 text-t10h text-ink-muted">{note}</p>
      </div>
      {people.length === 0 ? (
        <p className="px-2.5 py-3 text-t11 text-ink-muted">보이는 계정이 없습니다.</p>
      ) : (
        <ul>
          {people.map((p) => (
            <PersonRow
              key={p.user_id}
              person={p}
              active={selection?.kind === 'person' && selection.id === p.user_id}
              photoUrls={photoUrls}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

/** 시스템 계정 탭. 사람과 섞지 않는다(블록 B-6) — 'ECOUNT Sync'가 아니라 'Integration'이다. */
function SystemAccounts({
  people,
  selection,
  photoUrls,
  onSelect,
}: {
  people: UserAccount[]
  selection: Selection
  photoUrls: Record<string, string>
  onSelect: (id: string) => void
}) {
  return (
    <PeopleGroup
      title="시스템 계정"
      note="사람이 아니라 로그인해서 RLS 안에서 도는 계정입니다(service_role은 없습니다). 초대로 만들지 않고 supabase/bootstrap의 SQL로 붙입니다."
      people={people}
      selection={selection}
      photoUrls={photoUrls}
      onSelect={onSelect}
    />
  )
}

/** 사람 한 줄 — 이름(ko/en) · 역할 · 상태 · 마지막 접속. */
function PersonRow({
  person,
  lead = false,
  active,
  photoUrls,
  onSelect,
}: {
  person: UserAccount
  lead?: boolean
  active: boolean
  photoUrls: Record<string, string>
  onSelect: (id: string) => void
}) {
  const revoked = Boolean(person.revoked_at)
  const roleLabel = useRoleLabel()
  return (
    <li className="border-t border-line-soft first:border-t-0">
      <button
        type="button"
        onClick={() => onSelect(person.user_id)}
        className={`flex w-full flex-wrap items-center gap-1.5 px-2.5 py-2 text-left transition-colors hover:bg-raised/60 ${
          active ? 'bg-raised' : ''
        } ${revoked ? 'opacity-50' : ''}`}
      >
        {/* 0032. 얼굴이 먼저 온다 — 회장이 목록에서 찾는 것은 이름이 아니라 얼굴이다. */}
        <ProfilePhoto
          name={person.display_name}
          path={person.photo_path}
          url={person.photo_path ? photoUrls[person.photo_path] : undefined}
          size={24}
        />
        <span className="text-t12h font-semibold">{person.display_name}</span>
        {/* 영문 이름은 있는 사람만 그린다. 코드가 한글을 로마자로 지어내지 않는다(0017). */}
        {person.display_name_en ? (
          <span className="text-t11 text-ink-muted">{person.display_name_en}</span>
        ) : null}
        {lead ? (
          <span className="rounded bg-accent/15 px-1.5 py-0.5 text-t10 font-semibold text-ink">
            팀장
          </span>
        ) : null}
        <span className="rounded bg-raised px-1.5 py-0.5 text-t10 text-ink-dim">
          {roleLabel(person.role)}
        </span>
        <span
          className={`rounded px-1.5 py-0.5 text-t10 ${
            person.status === 'left' ? 'bg-critical/15 text-critical' : 'bg-raised text-ink-muted'
          }`}
        >
          {person.status === 'left' ? '퇴사' : '재직'}
        </span>
        {revoked ? (
          <span className="rounded bg-critical/15 px-1.5 py-0.5 text-t10 font-semibold text-critical">
            권한 회수됨
          </span>
        ) : null}
        {/*
         * 마지막 접속 — 만들 수 없는 칸이라 '—'다. 이 저장소에는 열람 기록이 아직 없다.
         * 그것은 블록 7이 audit_log의 action='read'로 만들기로 한 것이고(컨트롤러 메모),
         * 그 전에 그럴듯한 값을 지어내면 '이 사람은 두 달째 안 들어온다' 같은 판단이
         * 가짜 숫자 위에서 내려진다.
         */}
        {/* 폰에서는 이 칸이 꼬리표 사이에 끼어 줄이 들쭉날쭉했다 — 이름 아래 한 줄로 따로 내린다(사진 24px + 간격만큼 들여서) */}
        <span
          className="ml-auto text-t10h text-ink-muted tnum max-sm:ml-0 max-sm:w-full max-sm:pl-[30px]"
          title="열람 기록은 블록 7에서 만들어집니다"
        >
          마지막 접속 —
        </span>
      </button>
    </li>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-t10 tracking-[0.06em] text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-t12 text-ink">{children}</dd>
    </div>
  )
}

/** 우측 패널 — 상세 · 권한 회수 · 팀 이동 · 역할 변경 · 상사 변경 (블록 B-3). */
function PersonPanel({
  person,
  people,
  teams,
  businesses,
  canManage,
  self,
  photoUrls,
  onClose,
}: {
  person: UserAccount
  people: UserAccount[]
  teams: Team[]
  businesses: Business[]
  canManage: boolean
  self: boolean
  photoUrls: Record<string, string>
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const roleLabel = useRoleLabel()

  async function apply(patch: { role?: Role; teamId?: string; reportsTo?: string }) {
    setBusy(true)
    setError(null)
    const result = await updateUserProfile({ userId: person.user_id, ...patch })
    setBusy(false)
    if (result.error) setError(result.error)
  }

  /**
   * 상사 후보에서 자기 자신과 **자기 아래 사람들**을 뺀다. 0025의 순환 트리거가 어차피
   * 막지만, 고를 수 있게 두면 사람은 그것을 누른 뒤에야 안 된다는 것을 알게 된다.
   */
  const descendants = new Set<string>()
  {
    const queue = [person.user_id]
    while (queue.length) {
      const cur = queue.shift()!
      descendants.add(cur)
      for (const p of people) if (p.reports_to === cur && !descendants.has(p.user_id)) queue.push(p.user_id)
    }
  }
  const bossOptions = people.filter((p) => !descendants.has(p.user_id) && !p.revoked_at)
  const boss = people.find((p) => p.user_id === person.reports_to)

  return (
    <div className="rounded-xl border border-line bg-panel p-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-t13 font-semibold">
          <ProfilePhoto
            name={person.display_name}
            path={person.photo_path}
            url={person.photo_path ? photoUrls[person.photo_path] : undefined}
            size={32}
          />
          {person.display_name}
          {person.display_name_en ? (
            <span className="ml-1.5 text-t11 font-normal text-ink-muted">
              {person.display_name_en}
            </span>
          ) : null}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-t11 text-ink-muted transition-colors hover:text-ink"
        >
          닫기
        </button>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
        <Field label="역할">{roleLabel(person.role)}</Field>
        <Field label="직함">{person.title_ko || '—'}</Field>
        <Field label="보안등급">{SECURITY_CLASS_LABEL_KO[person.max_security_class]}</Field>
        <Field label="표기 언어">{PERSON_LANGUAGE_LABEL_KO[person.language]}</Field>
        <Field label="상태">{person.status === 'left' ? '퇴사' : '재직'}</Field>
        <Field label="마지막 접속">—</Field>
        <Field label="입사일">{person.joined_on ?? '—'}</Field>
        <Field label="퇴사일">{person.left_on ?? '—'}</Field>
        <Field label="직속 상사">{boss?.display_name ?? (person.role === 'Chairman' ? '없음 (뿌리)' : '—')}</Field>
        <Field label="소속 팀">
          {teams.find((t) => t.team_id === person.team_id)?.name ?? '미배정'}
        </Field>
        <div className="col-span-2">
          <Field label="회사 범위">
            {person.business_ids.length === 0
              ? '전사 (모든 회사)'
              : person.business_ids.map((id) => businessName(businesses, id)).join(' · ')}
          </Field>
        </div>
      </dl>

      <p className="mt-2 text-t10 leading-relaxed text-ink-muted">
        마지막 접속은 아직 만들 수 없습니다 — 이 저장소에 열람 기록이 없습니다. 블록 7이
        audit_log의 열람 기록을 만들면 그때 채워집니다. 그전까지 지어낸 숫자를 두지 않습니다.
      </p>

      {canManage ? (
        <div className="mt-3 space-y-2.5 border-t border-line-soft pt-3">
          <label className="block">
            <span className="text-t11 text-ink-dim">역할 변경</span>
            <select
              value={person.role}
              disabled={busy}
              onChange={(e) => apply({ role: e.target.value as Role })}
              className="mt-1 w-full rounded-lg border border-line bg-raised px-2.5 py-1.5 text-t12 text-ink outline-none focus:border-accent disabled:opacity-50"
            >
              {INVITABLE_ROLE.map((r) => (
                <option key={r} value={r} className="bg-panel">
                  {ROLE_LABEL_KO[r]}
                </option>
              ))}
              {/* 시스템 계정의 역할은 이 목록에 없다. 그 계정을 사람 역할로 바꾸는 일은 없다. */}
              {SYSTEM_ROLE.includes(person.role) ? (
                <option value={person.role} className="bg-panel">
                  {ROLE_LABEL_KO[person.role]}
                </option>
              ) : null}
            </select>
          </label>

          <label className="block">
            <span className="text-t11 text-ink-dim">팀 이동</span>
            <select
              value={person.team_id ?? ''}
              disabled={busy}
              onChange={(e) => apply({ teamId: e.target.value })}
              className="mt-1 w-full rounded-lg border border-line bg-raised px-2.5 py-1.5 text-t12 text-ink outline-none focus:border-accent disabled:opacity-50"
            >
              <option value="" className="bg-panel">
                (미배정)
              </option>
              {teams.map((t) => (
                <option key={t.team_id} value={t.team_id} className="bg-panel">
                  {t.name} · {t.name_en}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-t11 text-ink-dim">상사 변경</span>
            <select
              value={person.reports_to ?? ''}
              disabled={busy}
              onChange={(e) => apply({ reportsTo: e.target.value })}
              className="mt-1 w-full rounded-lg border border-line bg-raised px-2.5 py-1.5 text-t12 text-ink outline-none focus:border-accent disabled:opacity-50"
            >
              <option value="" className="bg-panel">
                (없음)
              </option>
              {bossOptions.map((p) => (
                <option key={p.user_id} value={p.user_id} className="bg-panel">
                  {p.display_name} · {ROLE_LABEL_KO[p.role]}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-t10 text-ink-muted">
              자기 아래 사람은 목록에 없습니다 — 고리가 되면 서로의 subtree에 들어가 서로를 다 보게 됩니다.
            </span>
          </label>

          {SYSTEM_ROLE.includes(person.role) ? null : (
            <ModuleGrants person={person} businesses={businesses} busy={busy} setBusy={setBusy} setError={setError} />
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-t10h text-ink-muted">
              {person.revoked_at
                ? '이미 회수된 계정입니다.'
                : self
                  ? '본인 계정은 회수할 수 없습니다.'
                  : '회수하면 아래 사람과 팀장 자리가 상사에게 승계됩니다.'}
            </span>
            {!person.revoked_at && !self ? (
              <span className="flex flex-wrap items-center gap-1.5">
                <ForceLogoutButton userId={person.user_id} label={person.display_name} />
                <RevokeButton kind="account" id={person.user_id} label={person.display_name} />
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-3 border-t border-line-soft pt-3">
          {self && person.modules.length > 0 ? (
            <p className="mb-2 text-t11 text-ink-dim">
              내 모듈 권한:{' '}
              {person.modules
                .map((m) => {
                  for (const o of MODULE_GRANT_OPTIONS) {
                    const biz = businessOfModule(o.prefix, m.module)
                    if (!biz) continue
                    const parts = [m.can_write ? o.write : null, m.can_approve && o.approve ? o.approve : null].filter(Boolean)
                    return `${o.label} ${businessName(businesses, biz)}(${parts.length ? parts.join(' · ') : '보기'})`
                  }
                  return null
                })
                .filter(Boolean)
                .join(', ')}
            </p>
          ) : null}
          <p className="text-t11 leading-relaxed text-ink-muted">
            역할·팀·상사·모듈 권한을 바꾸고 권한을 회수하는 것은 대표만 할 수 있습니다(0002
            user_profiles_admin_write · module_access_admin_write). 그래서 여기 버튼이 없습니다 — 눌러도 DB가 거부합니다.
          </p>
        </div>
      )}

      {error ? (
        <p role="alert" className="mt-2 rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-t11h text-critical">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/**
 * 0047 «모듈 권한» — 사람 × 회사로 켜는 권한(재무 입력 · 월 마감 등). 회장에게만 그린다(PersonPanel의 canManage).
 * 자물쇠는 0002 module_access_admin_write다. **회사마다 한 줄**이다 — 이 사람의 회사 범위(user_business_access)에 있는
 * 회사마다 칸 둘을 그린다. 회사 범위에 있어도 여기서 켜지 않은 회사의 재무는 열리지 않는다(0047 finance_grant(target) AND
 * has_business(target)). 범위 밖인데 줄만 남은 회사도 그린다 — 효과가 없다는 표시와 함께, 지울 수 있게.
 * 칸 둘을 다 끄면 줄이 지워진다(줄이 있으면 보기가 열리므로). 역할로 이미 되는 사람(MODULE_GRANT_OPTIONS.roleCovers)에게는
 * 그 모듈을 그리지 않는다. 0048 «문서»는 칸이 하나(문서 등록)다 — approve가 null인 모듈은 마감 칸이 없다.
 */
function ModuleGrants({
  person,
  businesses,
  busy,
  setBusy,
  setError,
}: {
  person: UserAccount
  businesses: Business[]
  busy: boolean
  setBusy: (v: boolean) => void
  setError: (v: string | null) => void
}) {
  async function toggle(prefix: string, businessId: string, next: { can_write: boolean; can_approve: boolean }) {
    setBusy(true)
    setError(null)
    const result = await setModuleGrant({
      userId: person.user_id,
      prefix,
      businessId,
      canWrite: next.can_write,
      canApprove: next.can_approve,
    })
    setBusy(false)
    if (result.error) setError(result.error)
  }

  async function toggleDraft(on: boolean) {
    setBusy(true)
    setError(null)
    const result = await setDraftGrant({ userId: person.user_id, on })
    setBusy(false)
    if (result.error) setError(result.error)
  }

  // 2026-10-06. 회장 외 모든 사람에게 필요한 칸이라 맨 위에 둔다 — 꺼져 있으면 결재 양식을 하나도 못 올린다(0002 decisions_create).
  const draftOn = hasDraftGrant(person.modules)
  const draft =
    person.role === 'Chairman' ? null : (
      <div className="py-1">
        <label className="flex min-h-11 items-center gap-1.5 text-t12 font-semibold sm:min-h-0">
          <input
            type="checkbox"
            checked={draftOn}
            disabled={busy}
            onChange={(e) => toggleDraft(e.target.checked)}
            className="size-4 accent-[var(--color-accent)] disabled:opacity-50"
          />
          결재 올리기
          {draftOn ? null : <span className="text-t10 font-normal text-warning">꺼짐 — 결재 양식을 올리지 못합니다</span>}
        </label>
        <span className="mt-0.5 block text-t10 leading-relaxed text-ink-muted">
          전자결재 양식(지출 · 구매 · 휴가 · 계약 · 채용)을 올립니다. 올릴 수 있는 회사는 회사 범위가 정합니다.
        </span>
      </div>
    )

  // 0048. 모듈마다 «역할로 이미 되는 사람»이 다르다 — 재무는 회장 · CFO, 문서는 회장만(CFO도 회사마다 켠다).
  const options = MODULE_GRANT_OPTIONS.filter((o) => !o.roleCovers.includes(person.role))
  if (options.length === 0) {
    return (
      <fieldset className="rounded-lg border border-line-soft px-2.5 py-2">
        <legend className="px-1 text-t11 text-ink-dim">모듈 권한</legend>
        {draft}
        <p className="text-t10 leading-relaxed text-ink-muted">
          {draft ? '그 밖의 모듈은 ' : ''}전사 역할이라 역할로 이미 전부 할 수 있습니다.{draft ? '' : ' 켤 것이 없습니다.'}
        </p>
      </fieldset>
    )
  }
  // 전사 역할(GroupCFO)은 user_business_access 줄 없이 전 회사를 본다(0002 has_group_scope) — 회사 목록 전체가 범위다.
  const groupScope = person.role === 'GroupCFO'
  const scope = groupScope ? businesses.map((b) => b.business_id) : person.business_ids

  return (
    <fieldset className="rounded-lg border border-line-soft px-2.5 py-2">
      <legend className="px-1 text-t11 text-ink-dim">모듈 권한</legend>
      {draft}
      {options.map((o) => {
        const granted = person.modules
          .map((m) => businessOfModule(o.prefix, m.module))
          .filter((b): b is string => b !== null)
        const companies = [...new Set([...scope, ...granted])]
        return (
          <div key={o.prefix} className="py-1">
            <span className="text-t12 font-semibold">{o.label}</span>
            {companies.length === 0 ? (
              <span className="mt-0.5 block text-t10 text-ink-muted">회사 범위가 없어 켤 회사가 없습니다.</span>
            ) : (
              <ul className="mt-1 space-y-1">
                {companies.map((biz) => {
                  const row = person.modules.find((m) => m.module === moduleKey(o.prefix, biz))
                  const cur = { can_write: row?.can_write ?? false, can_approve: row?.can_approve ?? false }
                  const outOfScope = !scope.includes(biz)
                  return (
                    <li key={biz} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="min-w-16 text-t12">{businessName(businesses, biz)}</span>
                      <label className="flex min-h-11 items-center gap-1.5 text-t12 sm:min-h-0">
                        <input
                          type="checkbox"
                          checked={cur.can_write}
                          disabled={busy}
                          onChange={(e) => toggle(o.prefix, biz, { ...cur, can_write: e.target.checked })}
                          className="size-4 accent-[var(--color-accent)] disabled:opacity-50"
                        />
                        {o.write}
                      </label>
                      {o.approve ? (
                        <label className="flex min-h-11 items-center gap-1.5 text-t12 sm:min-h-0">
                          <input
                            type="checkbox"
                            checked={cur.can_approve}
                            disabled={busy}
                            onChange={(e) => toggle(o.prefix, biz, { ...cur, can_approve: e.target.checked })}
                            className="size-4 accent-[var(--color-accent)] disabled:opacity-50"
                          />
                          {o.approve}
                        </label>
                      ) : null}
                      {outOfScope ? (
                        <span className="text-t10 text-warning">회사 범위 밖 — 효과 없음</span>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
            <span className="mt-0.5 block text-t10 leading-relaxed text-ink-muted">
              {person.role === 'BusinessCEO' && o.prefix === '/finance' ? '대표는 자기 회사를 역할로 이미 입력합니다(마감은 아님). ' : ''}
              {o.note}
            </span>
          </div>
        )
      })}
    </fieldset>
  )
}

/** 팀 패널 — 이름 변경 · 팀장 지정 · 회사 간 이동 · 추가 (블록 B-7, 회장만). */
function TeamPanel({
  team,
  businesses,
  people,
  canManage = true,
  onClose,
}: {
  team: Team | null
  businesses: Business[]
  people: UserAccount[]
  canManage?: boolean
  onClose: () => void
}) {
  const [teamId, setTeamId] = useState(team?.team_id ?? 'team_')
  const [businessId, setBusinessId] = useState(team?.business_id ?? businesses[0]?.business_id ?? '')
  const [name, setName] = useState(team?.name ?? '')
  const [nameEn, setNameEn] = useState(team?.name_en ?? '')
  const [leadUserId, setLeadUserId] = useState(team?.lead_user_id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setDone(false)
    const result = await saveTeam({ teamId, businessId, name, nameEn, leadUserId })
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setDone(true)
  }

  if (!canManage) {
    return (
      <div className="rounded-xl border border-line bg-panel p-3.5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-t13 font-semibold">
            {team?.name} <span className="text-t11 font-normal text-ink-muted">{team?.name_en}</span>
          </h2>
          <button type="button" onClick={onClose} className="text-t11 text-ink-muted hover:text-ink">
            닫기
          </button>
        </div>
        <p className="mt-2 text-t11 leading-relaxed text-ink-muted">
          팀 추가·이름 변경·팀장 지정·회사 간 이동은 대표만 할 수 있습니다(0025 teams_write).
          {team && !team.lead_user_id
            ? ' 이 팀은 팀장이 공석입니다 — 상위 임원이 대신 봅니다(0026 승계).'
            : ''}
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-line bg-panel p-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-t13 font-semibold">{team ? '팀 편집' : '팀 추가'}</h2>
        <button type="button" onClick={onClose} className="text-t11 text-ink-muted hover:text-ink">
          닫기
        </button>
      </div>

      <div className="mt-3 space-y-2.5">
        <label className="block">
          <span className="text-t11 text-ink-dim">팀 키</span>
          <input
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            disabled={busy || Boolean(team)}
            placeholder="team_dy_sales"
            className="mt-1 w-full rounded-lg border border-line bg-raised px-2.5 py-1.5 text-t12 text-ink outline-none placeholder:text-ink-muted focus:border-accent disabled:opacity-50"
          />
          <span className="mt-1 block text-t10 text-ink-muted">
            만들 때 한 번 정하고 바꾸지 않습니다. 사람들의 소속이 이 값을 물고 있습니다.
          </span>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-t11 text-ink-dim">팀 이름 (한글)</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              placeholder="영업"
              className="mt-1 w-full rounded-lg border border-line bg-raised px-2.5 py-1.5 text-t12 text-ink outline-none placeholder:text-ink-muted focus:border-accent disabled:opacity-50"
            />
          </label>
          <label className="block">
            <span className="text-t11 text-ink-dim">팀 이름 (영문)</span>
            <input
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              disabled={busy}
              placeholder="Sales"
              className="mt-1 w-full rounded-lg border border-line bg-raised px-2.5 py-1.5 text-t12 text-ink outline-none placeholder:text-ink-muted focus:border-accent disabled:opacity-50"
            />
          </label>
        </div>

        <label className="block">
          <span className="text-t11 text-ink-dim">회사</span>
          <select
            value={businessId}
            onChange={(e) => setBusinessId(e.target.value)}
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-line bg-raised px-2.5 py-1.5 text-t12 text-ink outline-none focus:border-accent disabled:opacity-50"
          >
            {businesses.map((b) => (
              <option key={b.business_id} value={b.business_id} className="bg-panel">
                {b.name}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-t10 text-ink-muted">
            회사를 바꾸면 그 팀이 통째로 다른 회사로 옮겨 갑니다(회장만).
          </span>
        </label>

        <label className="block">
          <span className="text-t11 text-ink-dim">팀장</span>
          <select
            value={leadUserId}
            onChange={(e) => setLeadUserId(e.target.value)}
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-line bg-raised px-2.5 py-1.5 text-t12 text-ink outline-none focus:border-accent disabled:opacity-50"
          >
            <option value="" className="bg-panel">
              (공석)
            </option>
            {people
              .filter((p) => !p.revoked_at)
              .map((p) => (
                <option key={p.user_id} value={p.user_id} className="bg-panel">
                  {p.display_name} · {ROLE_LABEL_KO[p.role]}
                </option>
              ))}
          </select>
          <span className="mt-1 block text-t10 text-ink-muted">
            공석은 고장이 아니라 상태입니다. 팀장이 나가면 상위 임원이 자동으로 승계합니다(0026).
          </span>
        </label>
      </div>

      {error ? (
        <p role="alert" className="mt-2.5 rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-t11h text-critical">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className="mt-2.5 rounded-md border border-ok/40 bg-ok/10 px-2.5 py-1.5 text-t11h text-ink-dim">
          저장했습니다.
        </p>
      ) : null}

      <div className="mt-3 flex justify-end">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-accent px-3 py-1.5 text-t12 font-semibold text-ink transition-opacity disabled:opacity-40"
        >
          {busy ? '저장하는 중…' : '저장'}
        </button>
      </div>
    </form>
  )
}
