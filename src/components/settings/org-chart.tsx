'use client'

import { createContext, useContext, useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from 'react'

import { saveTeam, setDraftGrant, setModuleGrant, setStaffAdminGrant, updateUserProfile } from '@/app/actions/users'
import { ProfilePhoto } from '@/components/settings/profile-photo'
import { ForceLogoutButton } from '@/components/settings/force-logout-button'
import { RevokeButton } from '@/components/settings/revoke-button'
import { Icon } from '@/components/ui/icon'
import { boss, roleLabelFor } from '@/lib/boss'
import { businessName } from '@/lib/lookup'
import { businessOfModule, hasDraftGrant, moduleKey } from '@/lib/module-grants'
import {
  INVITABLE_ROLE,
  MODULE_GRANT_OPTIONS,
  STAFF_ADMIN_PREFIX,
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

type ActionResult = { error?: string }

/**
 * 칸 하나의 저장 — 2026-10-09 회장 보고(«칸이 느리고 흐려졌다가 돌아온다 · 한 번은 켠 칸이 꺼져 보였다»)의 답.
 *
 *   · 누르는 순간 바뀐다(useOptimistic). 전환(transition)이 끝나면 서버가 다시 그린 props로 돌아간다 —
 *     그래서 액션이 revalidatePath('/settings/users')를 꼭 불러야 한다(빠지면 칸이 옛 값으로 되돌아 보인다).
 *   · 저장하는 동안에도 칸을 잠그지 않는다(disabled · 흐림 없음). 대신 그 칸 옆에 «저장 중…».
 *   · 실패하면 props(진짜 값)로 돌아가고 그 칸 옆에 이유가 뜬다 — 패널 맨 아래가 아니라.
 *   · 칸마다 따로다. 예전에는 패널 전체가 busy 하나를 나눠 써서 칸 하나가 저장되는 동안 «팀 이동»까지 잠겼다.
 * 연달아 두 번 눌러도 다음 값은 지금 **보이는** 값에서 계산한다(save에 넘기는 next를 부르는 쪽이 value로 만든다).
 * Server Action은 Next가 차례대로 보내므로 서버에는 마지막 값이 남는다.
 */
function useOptimisticSave<T>(value: T) {
  const [shown, setShown] = useOptimistic(value)
  const [, startTransition] = useTransition()
  const [saving, setSaving] = useState(0)
  const [error, setError] = useState<string | null>(null)
  function save(next: T, run: () => Promise<ActionResult>) {
    setError(null)
    setSaving((n) => n + 1)
    startTransition(async () => {
      setShown(next)
      let message: string | null = null
      try {
        message = (await run()).error ?? null
      } catch {
        // 연결이 끊기는 등 응답이 아예 오지 않은 경우. 오류 화면으로 넘기지 않고 그 칸 옆에 말한다.
        message = '저장하지 못했습니다 — 연결을 확인하고 다시 누르세요.'
      }
      setSaving((n) => n - 1)
      if (message) setError(message)
    })
  }
  return { value: shown, saving: saving > 0, error, save }
}

/** 칸 옆의 작은 상태 한 줄 — 저장 중 / 실패 이유. */
function SaveState({ saving, error }: { saving: boolean; error: string | null }) {
  if (error) {
    return (
      <span role="alert" className="text-t10h font-semibold text-critical">
        {error}
      </span>
    )
  }
  if (saving) {
    return (
      <span role="status" className="text-t10h text-ink-muted">
        저장 중…
      </span>
    )
  }
  return null
}

/** 사람과 그 아래(직속 · 그 아래) 전부. 자기 자신을 포함한다. */
function subtreeOf(personId: string, people: readonly UserAccount[]): Set<string> {
  const out = new Set<string>()
  const queue = [personId]
  while (queue.length) {
    const cur = queue.shift()!
    out.add(cur)
    for (const p of people) if (p.reports_to === cur && !out.has(p.user_id)) queue.push(p.user_id)
  }
  return out
}

/**
 * 상사로 고를 수 있는 사람 — 자기 · 자기 아래 · 회수된 사람 · 시스템 계정 제외. 0025 순환 트리거가 어차피 막지만,
 * 고를 수 있게 두면 사람은 누른 뒤에야 안 된다는 것을 알게 된다.
 */
function canBeBoss(candidate: UserAccount, below: Set<string>): boolean {
  return !below.has(candidate.user_id) && !candidate.revoked_at && !SYSTEM_ROLE.includes(candidate.role)
}

/** 그 사람이 들어갈 수 있는 팀 — 그 사람의 회사 범위 안의 팀(전사 역할은 전부). */
function canJoinTeam(person: UserAccount, team: Team): boolean {
  return person.business_ids.length === 0 || person.business_ids.includes(team.business_id)
}

/** 옮길 수 있는 사람 — 회장 · 시스템 계정 · 회수된 사람은 옮기지 않는다. */
function movable(person: UserAccount): boolean {
  return person.role !== 'Chairman' && !SYSTEM_ROLE.includes(person.role) && !person.revoked_at
}

/** 이동 요청 — 끌어 놓기(바뀐 칸 하나)이거나 «이동» 버튼(팀 · 상사를 고르는 대화상자). */
interface MoveRequest {
  personId: string
  teamId?: string | null
  reportsTo?: string | null
  /** true면 대화상자 안에서 팀 · 상사를 고른다(«이동» 버튼 · 폰 · 키보드). */
  pick: boolean
}

interface MoveContextValue {
  /** 회장만 끌고 놓고 «이동»을 누른다. */
  enabled: boolean
  dragId: string | null
  setDragId: (id: string | null) => void
  /** 끌고 있는 사람을 이 사람 밑으로 놓을 수 있는가. */
  canDropOnPerson: (targetId: string) => boolean
  /** 끌고 있는 사람을 이 팀에 놓을 수 있는가. */
  canDropOnTeam: (team: Team) => boolean
  request: (r: MoveRequest) => void
}

const MoveContext = createContext<MoveContextValue>({
  enabled: false,
  dragId: null,
  setDragId: () => {},
  canDropOnPerson: () => false,
  canDropOnTeam: () => false,
  request: () => {},
})

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

  // ── 0-5 끌어 놓기 · «이동» (회장만) ─────────────────────────────────────
  //   놓는 순간 저장하지 않는다. 확인 대화상자가 바뀌는 것(팀 · 상사 · 결재가 어디서부터 올라가는가)을 말하고,
  //   «확인»을 눌러야 updateUserProfile 한 번으로 저장한다. 자물쇠는 여전히 DB다(0002 · 0025 순환 트리거).
  const [dragId, setDragId] = useState<string | null>(null)
  const [move, setMove] = useState<MoveRequest | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const dragged = dragId ? (byId.get(dragId) ?? null) : null
  const draggedBelow = useMemo(() => (dragId ? subtreeOf(dragId, people) : new Set<string>()), [dragId, people])
  const moveCtx: MoveContextValue = {
    enabled: canManage,
    dragId,
    setDragId,
    canDropOnPerson: (targetId) => {
      const target = byId.get(targetId)
      if (!dragged || !target) return false
      return target.user_id !== dragged.reports_to && canBeBoss(target, draggedBelow)
    },
    canDropOnTeam: (team) => Boolean(dragged) && dragged!.team_id !== team.team_id && canJoinTeam(dragged!, team),
    request: (r) => {
      setNotice(null)
      setDragId(null)
      setMove(r)
    },
  }
  const movingPerson = move ? (byId.get(move.personId) ?? null) : null

  return (
    <ViewerRoleContext.Provider value={viewer?.role ?? null}>
    <MoveContext.Provider value={moveCtx}>
    {/* 폰에서는 카드 사이를 12px로 좁힌다(회장 규칙 «카드 간격 12px»). 넓은 화면은 그대로. */}
    <div className="grid gap-3 sm:gap-3.5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-3 sm:space-y-3.5">
        {notice ? (
          <p
            role="status"
            className="flex items-start justify-between gap-2 rounded-xl border border-ok/40 bg-ok/10 px-3.5 py-2 text-t11h text-ink"
          >
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="shrink-0 text-t10h text-ink-muted hover:text-ink">
              닫기
            </button>
          </p>
        ) : null}

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

          {canManage ? (
            <p className="mt-2 text-t10h text-ink-muted max-sm:hidden">
              사람을 팀 상자에 끌어다 놓으면 팀이, 다른 사람 위에 놓으면 상사(결재선)가 바뀝니다 — 놓은 뒤 확인을 한 번 더 받습니다.
              폰 · 키보드는 줄 끝의 «이동»을 누르세요.
            </p>
          ) : null}

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
                note="전사 역할은 회사 범위를 따로 주지 않아도 모든 회사를 봅니다."
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
            key={selected.user_id}
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
    {move && movingPerson && canManage ? (
      <MoveDialog
        key={`${move.personId}:${move.teamId ?? ''}:${move.reportsTo ?? ''}:${move.pick}`}
        request={move}
        person={movingPerson}
        people={people}
        teams={teams}
        businesses={businesses}
        onClose={() => setMove(null)}
        onSaved={(message) => {
          setMove(null)
          setNotice(message)
        }}
      />
    ) : null}
    </MoveContext.Provider>
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
          <TeamBox key={b.team?.team_id ?? UNASSIGNED} team={b.team}>
            <div className="flex flex-wrap items-center gap-1.5 border-b border-line-soft px-2.5 py-1.5 transition-opacity group-data-[dim=true]/team:opacity-40">
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
          </TeamBox>
        ))}
      </ul>
    </div>
  )
}

/**
 * 팀 상자 — 끌고 온 사람을 놓으면 그 팀으로 옮기는 확인 대화상자가 열린다(회장만).
 * 놓을 수 없는 상자(지금 그 팀 · 그 사람 회사 범위 밖의 팀 · «팀 없음» 칸)는 끄는 동안 흐리게 둔다.
 */
function TeamBox({ team, children }: { team: Team | null; children: React.ReactNode }) {
  const ctx = useContext(MoveContext)
  const [over, setOver] = useState(false)
  const dragging = ctx.enabled && ctx.dragId !== null
  const droppable = dragging && team !== null && ctx.canDropOnTeam(team)
  return (
    <li
      data-team-box={team?.team_id ?? UNASSIGNED}
      data-droppable={dragging ? String(droppable) : undefined}
      // 흐림은 머리 줄에만 건다 — 상자 안의 사람들은 «상사로 놓기» 자리라 따로 판정한다.
      data-dim={dragging && !droppable ? 'true' : undefined}
      onDragOver={(e) => {
        if (!droppable) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (!over) setOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={(e) => {
        setOver(false)
        if (!droppable || !team || !ctx.dragId) return
        e.preventDefault()
        ctx.request({ personId: ctx.dragId, teamId: team.team_id, pick: false })
      }}
      className={`group/team rounded-lg border transition-[border-color,background-color] ${
        over ? 'border-accent bg-accent/10' : droppable ? 'border-dashed border-accent/60' : 'border-line-soft'
      }`}
    >
      {children}
    </li>
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
      note="사람이 아니라 자동 작업(야간 AI · 연동)이 쓰는 계정입니다. 초대로 만들지 않습니다."
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
  const ctx = useContext(MoveContext)
  const [over, setOver] = useState(false)
  const canMove = ctx.enabled && movable(person)
  const dragging = ctx.enabled && ctx.dragId !== null
  const self = ctx.dragId === person.user_id
  // 끌고 있는 사람을 이 사람 밑으로 놓을 수 있는가 — 자기 · 자기 아래 · 회수된 사람 · 지금 상사는 아니다.
  const droppable = dragging && !self && ctx.canDropOnPerson(person.user_id)
  return (
    <li
      data-person-row={person.user_id}
      data-droppable={dragging && !self ? String(droppable) : undefined}
      onDragOver={(e) => {
        if (!droppable) return
        // 팀 상자(바깥 li)가 아니라 이 사람이 받는다.
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'move'
        if (!over) setOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={(e) => {
        setOver(false)
        if (!droppable || !ctx.dragId) return
        e.preventDefault()
        e.stopPropagation()
        ctx.request({ personId: ctx.dragId, reportsTo: person.user_id, pick: false })
      }}
      className={`flex items-stretch border-t border-line-soft transition-opacity first:border-t-0 ${
        over ? 'bg-accent/15 outline-2 -outline-offset-2 outline-accent' : ''
      } ${dragging && !droppable && !self ? 'opacity-40' : ''} ${self ? 'opacity-60' : ''}`}
    >
      <button
        type="button"
        draggable={canMove}
        onDragStart={(e) => {
          if (!canMove) return
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', person.user_id)
          ctx.setDragId(person.user_id)
        }}
        onDragEnd={() => ctx.setDragId(null)}
        onClick={() => onSelect(person.user_id)}
        className={`flex min-w-0 flex-1 flex-wrap items-center gap-1.5 px-2.5 py-2 text-left transition-colors hover:bg-raised/60 ${
          active ? 'bg-raised' : ''
        } ${revoked ? 'opacity-50' : ''} ${canMove ? 'cursor-grab active:cursor-grabbing' : ''}`}
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
          title="마지막 접속은 아직 집계하지 않습니다"
        >
          마지막 접속 —
        </span>
      </button>
      {canMove ? (
        // 폰(끌기가 없다) · 키보드의 길 — 같은 확인 대화상자에서 팀 · 상사를 고른다.
        <button
          type="button"
          onClick={() => ctx.request({ personId: person.user_id, pick: true })}
          aria-label={`${person.display_name} 이동`}
          className="flex min-h-11 shrink-0 items-center gap-1 border-l border-line-soft px-2.5 text-t11 text-ink-dim transition-colors hover:bg-raised/60 hover:text-ink sm:min-h-0"
        >
          <Icon name="chevron-right" className="size-3.5" />
          이동
        </button>
      ) : null}
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

/** 우측 패널 — 상세 · 권한 회수 · 역할 변경 · 팀 · 상사 이동 (블록 B-3). */
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
  const roleLabel = useRoleLabel()
  const moveCtx = useContext(MoveContext)
  // 역할 변경도 칸 하나다 — 고르는 순간 바뀌어 보이고, 저장 중 · 실패 이유가 그 칸 바로 아래에 뜬다.
  const role = useOptimisticSave<Role>(person.role)
  const boss = people.find((p) => p.user_id === person.reports_to)
  const teamName = teams.find((t) => t.team_id === person.team_id)?.name ?? null

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
        <Field label="소속 팀">{teamName ?? '미배정'}</Field>
        <div className="col-span-2">
          <Field label="회사 범위">
            {person.business_ids.length === 0
              ? '전사 (모든 회사)'
              : person.business_ids.map((id) => businessName(businesses, id)).join(' · ')}
          </Field>
        </div>
      </dl>

      <p className="mt-2 text-t10 leading-relaxed text-ink-muted">
        마지막 접속은 아직 집계하지 않습니다 — 접속 기록을 모으는 기능이 생기면 채워집니다. 그전까지 지어낸 숫자를 두지
        않습니다.
      </p>

      {canManage ? (
        <div className="mt-3 space-y-2.5 border-t border-line-soft pt-3">
          <label className="block">
            <span className="flex flex-wrap items-baseline gap-x-2 text-t11 text-ink-dim">
              역할 변경
              <SaveState saving={role.saving} error={role.error} />
            </span>
            <select
              value={role.value}
              onChange={(e) => {
                const next = e.target.value as Role
                role.save(next, () => updateUserProfile({ userId: person.user_id, role: next }))
              }}
              className="mt-1 w-full rounded-lg border border-line bg-raised px-2.5 py-1.5 text-t12 text-ink outline-none focus:border-accent"
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

          {/*
           * 팀 · 상사는 고르는 즉시 저장하지 않는다(2026-10-09). 예전의 «팀 이동» 고르기 칸은 저장되는 동안 옛 값으로 튀어
           * 돌아가 보였고, 오류는 패널 맨 아래에만 떠서 «안 된다»로 읽혔다(운영 김병훈). 이제 조직도의 끌어 놓기와 같은
           * 확인 대화상자로 간다 — 무엇이 바뀌고 결재가 어디서부터 올라가는지 보고 «확인»을 누른다.
           */}
          {movable(person) ? (
            <div className="rounded-lg border border-line-soft px-2.5 py-2">
              <p className="text-t11 text-ink-dim">팀 · 상사</p>
              <p className="mt-0.5 text-t12 text-ink">
                {teamName ?? '팀 없음'} · 상사 {boss?.display_name ?? '없음'}
              </p>
              <button
                type="button"
                onClick={() => moveCtx.request({ personId: person.user_id, pick: true })}
                className="mt-1.5 flex min-h-11 items-center gap-1 rounded-md border border-line px-2.5 py-1 text-t11h text-ink-dim transition-colors hover:border-accent hover:text-ink sm:min-h-0"
              >
                <Icon name="chevron-right" className="size-3.5" />
                팀 · 상사 이동
              </button>
              <span className="mt-1 block text-t10 text-ink-muted">
                조직도에서 사람을 팀 상자나 다른 사람 위에 끌어다 놓아도 됩니다. 자기 아래 사람은 상사로 고를 수 없습니다 —
                고리가 되면 서로가 서로의 아래가 되어 서로를 다 보게 됩니다.
              </span>
            </div>
          ) : null}

          {SYSTEM_ROLE.includes(person.role) ? null : <ModuleGrants person={person} businesses={businesses} />}

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
            역할·팀·상사·모듈 권한을 바꾸고 권한을 회수하는 것은 대표만 할 수 있습니다. 그래서 여기 버튼이 없습니다.
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * 팀 · 상사 이동 확인 대화상자(회장만) — 끌어 놓기와 «이동» 버튼이 같은 길로 온다.
 *
 * 바뀌는 칸만 말한다: «<이름>: 팀 A → B / 상사 X → Y — 이 사람의 결재는 Y부터 올라갑니다». 상사가 없어지거나 회장이면
 * «결재는 회장이 받습니다»(회장 본인 화면이라 boss(role)이 «회장»을 낸다 — 직원 화면 용어 원칙). 이미 올라간 결재는
 * 올릴 때 얼린 결재선(0059 approval_steps)으로 가므로 그 한 줄을 늘 붙인다.
 * «확인» = updateUserProfile 한 번(바뀐 칸만). 감사 · 순환 판정은 그 길 그대로(0002 · 0025 트리거) — 거부 문구는
 * denialMessage가 한국어로 옮겨 이 대화상자 안에 띄운다.
 */
function MoveDialog({
  request,
  person,
  people,
  teams,
  businesses,
  onClose,
  onSaved,
}: {
  request: MoveRequest
  person: UserAccount
  people: UserAccount[]
  teams: Team[]
  businesses: Business[]
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const viewerRole = useContext(ViewerRoleContext)
  const roleLabel = useRoleLabel()
  const [teamId, setTeamId] = useState<string | null>(request.teamId !== undefined ? request.teamId : person.team_id)
  const [reportsTo, setReportsTo] = useState<string | null>(
    request.reportsTo !== undefined ? request.reportsTo : person.reports_to,
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, startSaving] = useTransition()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const below = useMemo(() => subtreeOf(person.user_id, people), [person.user_id, people])
  const bossCandidates = people
    .filter((p) => canBeBoss(p, below))
    .sort((a, b) => Number(b.role === 'Chairman') - Number(a.role === 'Chairman') || a.display_name.localeCompare(b.display_name, 'ko'))
  const teamName = (id: string | null) => (id ? (teams.find((t) => t.team_id === id)?.name ?? id) : '팀 없음')
  // 회장 자리는 이름이 아니라 호칭으로 말한다(회장 화면 = «회장»). 상사 없음도 결재는 회장에게 간다.
  const personName = (id: string | null) => {
    const p = id ? people.find((x) => x.user_id === id) : undefined
    if (!p) return '없음'
    return p.role === 'Chairman' ? boss(viewerRole) : p.display_name
  }
  const teamChanged = teamId !== person.team_id
  const bossChanged = reportsTo !== person.reports_to
  const newBoss = reportsTo ? people.find((p) => p.user_id === reportsTo) : undefined
  const bossSubject = boss(viewerRole) === '회장' ? '회장이' : '대표가'
  const chainLine =
    !newBoss || newBoss.role === 'Chairman'
      ? `이 사람의 결재는 ${bossSubject} 받습니다.`
      : `이 사람의 결재는 ${newBoss.display_name}부터 올라갑니다.`
  const teamless = TEAMLESS_BY_DESIGN.includes(person.role)

  function confirm() {
    setError(null)
    startSaving(async () => {
      let message: string | null = null
      try {
        message =
          (
            await updateUserProfile({
              userId: person.user_id,
              ...(teamChanged ? { teamId: teamId ?? '' } : {}),
              ...(bossChanged ? { reportsTo: reportsTo ?? '' } : {}),
            })
          ).error ?? null
      } catch {
        message = '저장하지 못했습니다 — 연결을 확인하고 다시 누르세요.'
      }
      if (message) {
        setError(message)
        return
      }
      const parts = [
        teamChanged ? `팀 ${teamName(person.team_id)} → ${teamName(teamId)}` : null,
        bossChanged ? `상사 ${personName(person.reports_to)} → ${personName(reportsTo)}` : null,
      ].filter(Boolean)
      // 닫기는 서버가 다시 그린 조직도와 같은 전환 안에서 한다 — 닫힌 뒤 옛 자리가 잠깐 보이지 않게.
      startSaving(() => onSaved(`저장했습니다 — ${person.display_name}: ${parts.join(' / ')}`))
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-app/80 p-0 sm:items-center sm:p-4"
      onClick={() => (saving ? null : onClose())}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`${person.display_name} 이동`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="glass w-full max-w-md rounded-t-2xl border border-line p-4 outline-none sm:rounded-glass"
      >
        <h2 className="text-t13 font-semibold">{person.display_name} — 팀 · 상사 이동</h2>

        {request.pick ? (
          <div className="mt-3 space-y-2.5">
            <label className="block">
              <span className="text-t11 text-ink-dim">팀</span>
              <select
                value={teamId ?? ''}
                onChange={(e) => setTeamId(e.target.value || null)}
                disabled={saving}
                className="mt-1 w-full rounded-lg border border-line bg-raised px-2.5 py-2 text-t13 text-ink outline-none focus:border-accent"
              >
                {teamless || !person.team_id ? (
                  <option value="" disabled={!teamless} className="bg-panel">
                    {teamless ? '팀 없음 (회사를 이끄는 자리)' : '팀 없음 — 팀을 고르세요'}
                  </option>
                ) : null}
                {businesses
                  .filter((b) => teams.some((t) => t.business_id === b.business_id))
                  .map((b) => (
                    <optgroup key={b.business_id} label={b.name}>
                      {teams
                        .filter((t) => t.business_id === b.business_id)
                        .map((t) => (
                          <option key={t.team_id} value={t.team_id} disabled={!canJoinTeam(person, t)} className="bg-panel">
                            {t.name} · {t.name_en}
                            {canJoinTeam(person, t) ? '' : ' (회사 범위 밖)'}
                          </option>
                        ))}
                    </optgroup>
                  ))}
              </select>
            </label>
            <label className="block">
              <span className="text-t11 text-ink-dim">직속 상사 (결재가 처음 가는 사람)</span>
              <select
                value={reportsTo ?? ''}
                onChange={(e) => setReportsTo(e.target.value || null)}
                disabled={saving}
                className="mt-1 w-full rounded-lg border border-line bg-raised px-2.5 py-2 text-t13 text-ink outline-none focus:border-accent"
              >
                <option value="" className="bg-panel">
                  없음 — 결재는 {bossSubject} 받습니다
                </option>
                {bossCandidates.map((p) => (
                  <option key={p.user_id} value={p.user_id} className="bg-panel">
                    {p.display_name} · {roleLabel(p.role)}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-t10 text-ink-muted">
                자기 자신과 자기 아래 사람은 목록에 없습니다(고리가 생깁니다).
              </span>
            </label>
          </div>
        ) : null}

        <div className="mt-3 rounded-lg border border-line-soft bg-panel/70 px-3 py-2.5 text-t12h leading-relaxed text-ink">
          {teamChanged || bossChanged ? (
            <>
              <p data-move-summary>
                <span className="font-semibold">{person.display_name}</span>:{' '}
                {[
                  teamChanged ? `팀 ${teamName(person.team_id)} → ${teamName(teamId)}` : null,
                  bossChanged ? `상사 ${personName(person.reports_to)} → ${personName(reportsTo)}` : null,
                ]
                  .filter(Boolean)
                  .join(' / ')}
                {bossChanged ? ` — ${chainLine}` : ''}
              </p>
              {bossChanged ? (
                <p className="mt-1 text-t11h text-ink-dim">이미 올라간(열린) 결재는 올릴 때 정해진 결재선 그대로 갑니다.</p>
              ) : (
                <p className="mt-1 text-t11h text-ink-dim">상사는 그대로라 결재선은 바뀌지 않습니다.</p>
              )}
            </>
          ) : (
            <p className="text-ink-dim">바뀌는 것이 없습니다. 팀이나 상사를 고르세요.</p>
          )}
        </div>

        {error ? (
          <p role="alert" className="mt-2.5 rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-t11h text-critical">
            {error}
          </p>
        ) : null}

        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="min-h-11 rounded-lg border border-line px-3 py-1.5 text-t12 text-ink-dim transition-colors hover:text-ink disabled:opacity-40 sm:min-h-0"
          >
            취소
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={saving || (!teamChanged && !bossChanged)}
            className="min-h-11 rounded-lg bg-accent px-3 py-1.5 text-t12 font-semibold text-ink transition-opacity disabled:opacity-40 sm:min-h-0"
          >
            {saving ? '저장 중…' : '확인'}
          </button>
        </div>
      </div>
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
 * 2026-10-09 — 칸마다 따로 저장한다(useOptimisticSave). 누르는 순간 바뀌고, 저장 중에도 잠기지 않는다.
 */
function ModuleGrants({ person, businesses }: { person: UserAccount; businesses: Business[] }) {
  // 2026-10-06. 회장 외 모든 사람에게 필요한 칸이라 맨 위에 둔다 — 꺼져 있으면 결재 양식을 하나도 못 올린다(0002 decisions_create).
  const draft = person.role === 'Chairman' ? null : <DraftGrant person={person} />

  // 0055 «<회사> 사용자 관리자» — 그 회사의 사원 · 팀장을 초대한다(본인이 가진 권한까지만). 회사마다 회장만 켠다.
  // 사람 역할에게만(회장 · 시스템 · 외부 역할 제외). 회사 범위 밖인데 줄만 남은 회사도 그려 끌 수 있게 한다.
  const adminScope = person.role === 'GroupCFO' ? businesses.map((b) => b.business_id) : person.business_ids
  const adminGranted = person.modules
    .filter((m) => m.can_write)
    .map((m) => businessOfModule(STAFF_ADMIN_PREFIX, m.module))
    .filter((b): b is string => b !== null)
  const adminCompanies = [...new Set([...adminScope, ...adminGranted])]
  const staffAdmin =
    !['GroupCFO', 'BusinessCEO', 'Executive', 'TeamLead', 'Member'].includes(person.role) || adminCompanies.length === 0 ? null : (
      <div className="py-1">
        {adminCompanies.map((biz) => (
          <StaffAdminGrant
            key={biz}
            person={person}
            businessId={biz}
            label={`${businessName(businesses, biz)} 사용자 관리자`}
            on={adminGranted.includes(biz)}
            outOfScope={!adminScope.includes(biz)}
          />
        ))}
        <span className="mt-0.5 block text-t10 leading-relaxed text-ink-muted">
          그 회사의 사원 · 팀장을 초대합니다(팀 · 상사 필수, 본인이 가진 권한까지만 · 월 마감 불가). 초대는 바로 효력이 나고 회장에게
          알림이 옵니다. 다른 사람의 결재 · 업무를 보는 권한은 아닙니다.
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
        {staffAdmin}
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
      {staffAdmin}
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
                  return (
                    <GrantRow
                      key={biz}
                      person={person}
                      prefix={o.prefix}
                      businessId={biz}
                      companyName={businessName(businesses, biz)}
                      writeLabel={o.write}
                      approveLabel={o.approve}
                      current={{ can_write: row?.can_write ?? false, can_approve: row?.can_approve ?? false }}
                      outOfScope={!scope.includes(biz)}
                    />
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

/** «결재 올리기» 칸 — 0002 decisions_create의 전역 키 한 줄. */
function DraftGrant({ person }: { person: UserAccount }) {
  const draft = useOptimisticSave(hasDraftGrant(person.modules))
  return (
    <div className="py-1">
      <label className="flex min-h-11 flex-wrap items-center gap-1.5 text-t12 font-semibold sm:min-h-0">
        <input
          type="checkbox"
          data-grant="draft"
          checked={draft.value}
          onChange={() => {
            const next = !draft.value
            draft.save(next, () => setDraftGrant({ userId: person.user_id, on: next }))
          }}
          className="size-4 accent-[var(--color-accent)]"
        />
        결재 올리기
        {draft.value ? null : <span className="text-t10 font-normal text-warning">꺼짐 — 결재 양식을 올리지 못합니다</span>}
        <SaveState saving={draft.saving} error={draft.error} />
      </label>
      <span className="mt-0.5 block text-t10 leading-relaxed text-ink-muted">
        전자결재 양식(지출 · 구매 · 휴가 · 계약 · 채용)을 올립니다. 올릴 수 있는 회사는 회사 범위가 정합니다.
      </span>
    </div>
  )
}

/** «<회사> 사용자 관리자» 칸 하나(0055). */
function StaffAdminGrant({
  person,
  businessId,
  label,
  on,
  outOfScope,
}: {
  person: UserAccount
  businessId: string
  label: string
  on: boolean
  outOfScope: boolean
}) {
  const grant = useOptimisticSave(on)
  return (
    <label className="flex min-h-11 flex-wrap items-center gap-1.5 text-t12 font-semibold sm:min-h-0">
      <input
        type="checkbox"
        data-grant={`${STAFF_ADMIN_PREFIX}/${businessId}`}
        checked={grant.value}
        onChange={() => {
          const next = !grant.value
          grant.save(next, () => setStaffAdminGrant({ userId: person.user_id, businessId, on: next }))
        }}
        className="size-4 accent-[var(--color-accent)]"
      />
      {label}
      {outOfScope ? <span className="text-t10 font-normal text-warning">회사 범위 밖 — 효과 없음</span> : null}
      <SaveState saving={grant.saving} error={grant.error} />
    </label>
  )
}

/**
 * 모듈 × 회사 한 줄(재무 입력 · 월 마감 / 문서 등록 / 결재 대장 열람 …). 두 칸이 한 DB 줄이라 낙관적 값도 한 덩어리다 —
 * «입력»을 켜고 바로 «마감»을 눌러도 두 번째 저장이 첫 번째 칸의 새 값을 싣고 간다.
 */
function GrantRow({
  person,
  prefix,
  businessId,
  companyName,
  writeLabel,
  approveLabel,
  current,
  outOfScope,
}: {
  person: UserAccount
  prefix: string
  businessId: string
  companyName: string
  writeLabel: string
  approveLabel: string | null
  current: { can_write: boolean; can_approve: boolean }
  outOfScope: boolean
}) {
  const row = useOptimisticSave(current)
  function flip(field: 'can_write' | 'can_approve') {
    const next = { ...row.value, [field]: !row.value[field] }
    row.save(next, () =>
      setModuleGrant({ userId: person.user_id, prefix, businessId, canWrite: next.can_write, canApprove: next.can_approve }),
    )
  }
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="min-w-16 text-t12">{companyName}</span>
      <label className="flex min-h-11 items-center gap-1.5 text-t12 sm:min-h-0">
        <input
          type="checkbox"
          data-grant={`${prefix}/${businessId}:write`}
          checked={row.value.can_write}
          onChange={() => flip('can_write')}
          className="size-4 accent-[var(--color-accent)]"
        />
        {writeLabel}
      </label>
      {approveLabel ? (
        <label className="flex min-h-11 items-center gap-1.5 text-t12 sm:min-h-0">
          <input
            type="checkbox"
            data-grant={`${prefix}/${businessId}:approve`}
            checked={row.value.can_approve}
            onChange={() => flip('can_approve')}
            className="size-4 accent-[var(--color-accent)]"
          />
          {approveLabel}
        </label>
      ) : null}
      {outOfScope ? <span className="text-t10 text-warning">회사 범위 밖 — 효과 없음</span> : null}
      <SaveState saving={row.saving} error={row.error} />
    </li>
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
          팀 추가·이름 변경·팀장 지정·회사 간 이동은 대표만 할 수 있습니다.
          {team && !team.lead_user_id
            ? ' 이 팀은 팀장이 공석입니다 — 상위 임원이 대신 봅니다.'
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
            공석은 고장이 아니라 상태입니다. 팀장이 나가면 상위 임원이 자동으로 승계합니다.
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
