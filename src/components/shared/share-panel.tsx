'use client'

import { useState } from 'react'

import { createShare, revokeShare, searchSharePeople } from '@/app/actions/shares'
import { Icon } from '@/components/ui/icon'
import { formatDateTime } from '@/lib/format'
import { SHARE_ENTITY_LABEL_KO, type ShareEntityTable, type SharePerson, type ShareRecord } from '@/types'

/**
 * Phase 6-1 블록 C-1 — 문서·업무·프로젝트 상세의 "공유".
 *
 * **여기서 "공유해도 되는가"를 판정하지 않는다.** 0026의 shares_insert_visible이
 * "볼 수 있는 것만 공유할 수 있다"를 판정한다 — 대상 표를 exists로 한 번 읽는 것이 곧
 * 판정이라, 그 규칙을 화면에 복사해 오면 언젠가 정책만 고쳐지고 이쪽이 남는다.
 * 화면의 몫은 **받는 사람과 기간을 고르게 하는 것**과 **거부되면 한국어로 이유를 말하는 것**이다.
 *
 * 받는 사람 검색은 0028의 company_people()이다. 사람 목록을 직접 읽지 않는 이유가 있다 —
 * 0026이 그 표를 subtree로 잘라서, 옆 가지에 있는 사람(구매팀장에게 영업팀장)이 목록에
 * 아예 오지 않는다. 그 문은 이름 두 칸만 내준다.
 *
 * 기간 연장 버튼이 없다. 0025가 shares에 update 정책을 두지 않았다 — 한 행을 늘렸다 줄였다
 * 하면 '언제까지였는가'가 기록에 남지 않는다. 바꾸려면 회수하고 다시 공유한다.
 */

const PRESETS = [
  { key: 'forever', label: '무기한' },
  { key: '7', label: '7일' },
  { key: '30', label: '30일' },
  { key: 'custom', label: '직접 지정' },
] as const

type PresetKey = (typeof PRESETS)[number]['key']

/** 남은 기간 한 줄. 만료된 행은 애초에 목록에 오지 않지만, 방금 만든 행은 여기서 센다. */
function remainingText(expiresAt: string | null): string {
  if (!expiresAt) return '무기한'
  const ms = Date.parse(expiresAt) - Date.now()
  if (ms <= 0) return '만료됨'
  const days = Math.floor(ms / 86_400_000)
  if (days >= 1) return `${days}일 남음`
  return `${Math.max(1, Math.floor(ms / 3_600_000))}시간 남음`
}

export function SharePanel({
  entityTable,
  entityId,
  title,
  shares,
  viewerId,
}: {
  entityTable: ShareEntityTable
  entityId: string
  /** 무엇을 공유하는지. 확인 문구에 들어간다. */
  title: string
  /** 0025 shares_read가 내준 것 그대로 — 내가 받은 것 + 내가 한 공유. */
  shares: ShareRecord[]
  /**
   * 지금 보는 사람. **회수 버튼을 누가 보는가**가 여기서 갈린다.
   *
   * 이 목록에는 '내가 받은 공유'도 섞여 온다(0025 shares_read). 그런데 회수는 **연 사람만**
   * 할 수 있다(shares_revoke: shared_by = auth.uid()). 받는 쪽에도 버튼을 그리면 그 사람은
   * 눌러 본 뒤에야 안 된다는 걸 알게 된다 — 받은 쪽이 지울 수 있으면 '누구에게 열려 있나'를
   * 연 사람이 알 수 없게 되므로, 그 정책이 옳고 화면이 따라가야 한다.
   */
  viewerId: string | null
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [people, setPeople] = useState<SharePerson[] | null>(null)
  const [picked, setPicked] = useState<SharePerson | null>(null)
  const [preset, setPreset] = useState<PresetKey>('30')
  const [until, setUntil] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [rows, setRows] = useState<ShareRecord[]>(shares)

  async function find(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const result = await searchSharePeople({ query })
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setPeople(result.people ?? [])
  }

  async function share() {
    if (!picked) return
    setBusy(true)
    setError(null)
    setDone(null)
    const result = await createShare({
      entityTable,
      entityId,
      sharedWith: picked.user_id,
      preset,
      until,
    })
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    if (result.share) setRows((r) => [result.share!, ...r])
    setDone(`${picked.display_name}님에게 공유했습니다.`)
    setPicked(null)
    setPeople(null)
    setQuery('')
  }

  async function revoke(share: ShareRecord) {
    setBusy(true)
    setError(null)
    const result = await revokeShare({ shareId: share.share_id, entityTable, entityId })
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setRows((r) => r.filter((x) => x.share_id !== share.share_id))
    setDone('공유를 회수했습니다.')
  }

  return (
    <section className="rounded-xl border border-line-soft bg-panel p-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-baseline gap-1.5 text-t13 font-semibold">
          <Icon name="users" className="size-4 text-ink-dim" />
          공유
          <span className="text-t11 font-normal text-ink-muted tnum">{rows.length}건</span>
        </h2>
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v)
            setDone(null)
            setError(null)
          }}
          className="flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-t11h text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          <Icon name="user-plus" className="size-3.5" />
          {open ? '닫기' : '공유'}
        </button>
      </div>

      {open ? (
        <div className="mt-3 rounded-lg border border-line bg-raised/40 p-3">
          <p className="text-t11 leading-relaxed text-ink-muted">
            같은 회사 사람에게 <span className="text-ink-dim">{SHARE_ENTITY_LABEL_KO[entityTable]}</span>{' '}
            &lsquo;{title}&rsquo;을(를) 엽니다. 공유는 회사를 넘지 못하고, 자기가 볼 수 있는 것만
            공유할 수 있습니다 — 그 판정은 DB가 합니다.
          </p>

          <form onSubmit={find} className="mt-2.5 flex flex-wrap gap-1.5">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="이름으로 찾기 (예: 영업)"
              maxLength={40}
              disabled={busy}
              className="min-w-[180px] flex-1 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-t12 text-ink outline-none placeholder:text-ink-muted focus:border-accent disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy || query.trim().length === 0}
              className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-t11h text-ink-dim transition-colors hover:border-accent hover:text-ink disabled:opacity-40"
            >
              <Icon name="search" className="size-3.5" />
              찾기
            </button>
          </form>

          {people !== null ? (
            people.length === 0 ? (
              <p className="mt-2 text-t11 text-ink-muted">
                같은 회사에서 그 이름을 찾지 못했습니다. 이름(한글 또는 영문)의 일부로 찾습니다.
              </p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {people.map((p) => (
                  <li key={p.user_id}>
                    <button
                      type="button"
                      onClick={() => setPicked(p)}
                      aria-pressed={picked?.user_id === p.user_id}
                      className={`rounded-md border px-2.5 py-1 text-t11 transition-colors ${
                        picked?.user_id === p.user_id
                          ? 'border-accent bg-accent/15 text-ink'
                          : 'border-line text-ink-muted hover:text-ink-dim'
                      }`}
                    >
                      {p.display_name}
                      {p.display_name_en ? (
                        <span className="ml-1 text-ink-muted">{p.display_name_en}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : null}

          <div className="mt-3">
            <p className="text-t11 text-ink-dim">기간</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setPreset(p.key)}
                  aria-pressed={preset === p.key}
                  disabled={busy}
                  className={`rounded-md border px-2.5 py-1 text-t11 transition-colors disabled:opacity-50 ${
                    preset === p.key
                      ? 'border-accent bg-accent/15 text-ink'
                      : 'border-line text-ink-muted hover:text-ink-dim'
                  }`}
                >
                  {p.label}
                </button>
              ))}
              {preset === 'custom' ? (
                <input
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                  type="date"
                  disabled={busy}
                  className="rounded-lg border border-line bg-panel px-2.5 py-1 text-t12 text-ink outline-none focus:border-accent disabled:opacity-50"
                />
              ) : null}
            </div>
            <p className="mt-1.5 text-t10h text-ink-muted">
              기간이 끝나면 사람이 회수를 잊어도 닫힙니다. 기간을 바꾸려면 회수하고 다시
              공유합니다 — 연장 버튼이 없는 이유입니다.
            </p>
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-t10h text-ink-muted">
              {picked ? `${picked.display_name}님에게 엽니다.` : '받는 사람을 고르세요.'}
            </span>
            <button
              type="button"
              onClick={share}
              disabled={busy || !picked}
              className="rounded-lg bg-accent px-3 py-1.5 text-t12 font-semibold text-ink transition-opacity disabled:opacity-40"
            >
              {busy ? '여는 중…' : '공유'}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2.5 rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-t11h text-critical">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className="mt-2.5 rounded-md border border-ok/40 bg-ok/10 px-2.5 py-1.5 text-t11h text-ink-dim">
          {done}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="py-4 text-center text-t11h text-ink-muted">
          아직 아무에게도 열려 있지 않습니다.
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {rows.map((s) => (
            <li key={s.share_id} className="flex flex-wrap items-center gap-1.5 rounded-lg px-2 py-1.5 hover:bg-raised/60">
              <span className="text-t12 font-semibold">{s.shared_with_name ?? '이름 없음'}</span>
              <span className="rounded bg-raised px-1.5 py-0.5 text-t10 text-ink-dim">
                {remainingText(s.expires_at)}
              </span>
              <span className="text-t10h text-ink-muted tnum">
                {formatDateTime(s.created_at)} · {s.shared_by_name ?? '이름 없음'}이(가) 열었습니다
              </span>
              {s.shared_by === viewerId ? (
                <button
                  type="button"
                  onClick={() => revoke(s)}
                  disabled={busy}
                  className="ml-auto rounded-md border border-line px-2 py-1 text-t10h text-ink-muted transition-colors hover:border-critical/50 hover:text-critical disabled:opacity-40"
                >
                  회수
                </button>
              ) : (
                <span className="ml-auto text-t10h text-ink-muted">
                  나에게 열린 공유 — 회수는 연 사람만 합니다
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
