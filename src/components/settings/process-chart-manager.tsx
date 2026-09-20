'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { deleteProcessChart, saveProcessChart } from '@/app/actions/process-charts'
import { Icon } from '@/components/ui/icon'
import { EMBED_PROBLEM_KO, embedProblem } from '@/lib/process-chart'
import type { Business, ProcessChart } from '@/types'

/**
 * 프로세스차트 등록 (Phase 5-D). /settings/process-charts.
 *
 * 링크 형식 안내를 **화면에 크게 적는다.** 구글 시트의 편집 링크와 게시 링크는 겉이 비슷한데
 * 편집 링크를 걸면 대시보드를 보는 사람이 그대로 시트를 고칠 수 있게 된다.
 * 이 화면에서 그 차이를 설명하지 않으면 회장은 주소창의 링크를 그대로 붙여넣는다.
 */
export function ProcessChartManager({
  charts,
  businesses,
  canEdit,
}: {
  charts: ProcessChart[]
  businesses: Business[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [businessId, setBusinessId] = useState(businesses[0]?.business_id ?? '')
  const [teamName, setTeamName] = useState('')
  const [title, setTitle] = useState('')
  const [embedUrl, setEmbedUrl] = useState('')
  const [sortOrder, setSortOrder] = useState('10')
  const [error, setError] = useState<string | null>(null)

  // 입력 중에도 미리 본다. 저장을 눌러야 알려 주면 잘못된 링크를 몇 번씩 다시 붙여넣게 된다.
  const liveProblem = embedUrl.trim() === '' ? null : embedProblem(embedUrl)

  const submit = () => {
    setError(null)
    startTransition(async () => {
      const state = await saveProcessChart({ businessId, teamName, title, embedUrl, sortOrder })
      if (state.error) {
        setError(state.error)
        return
      }
      setTeamName('')
      setTitle('')
      setEmbedUrl('')
      router.refresh()
    })
  }

  const remove = (id: number, label: string) => {
    if (!window.confirm(`${label} 링크를 지울까요?\n\n시트 자체는 구글에 그대로 남습니다.`)) return
    startTransition(async () => {
      const state = await deleteProcessChart(id)
      if (state.error) setError(state.error)
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-line bg-panel p-3">
        <h3 className="text-[12.5px] font-semibold text-ink">링크는 &lsquo;웹에 게시&rsquo; 주소여야 합니다</h3>
        <ol className="mt-1.5 space-y-0.5 text-[11.5px] text-ink-dim">
          <li>1. 구글 시트에서 <strong>파일 → 공유 → 웹에 게시</strong></li>
          <li>2. 전체 문서 또는 원하는 시트를 고르고 <strong>게시</strong></li>
          <li>
            3. 나오는 주소를 그대로 붙여넣습니다 —{' '}
            <code className="rounded bg-raised px-1 text-[11px]">
              .../spreadsheets/d/e/2PACX-.../pubhtml
            </code>
          </li>
        </ol>
        <p className="mt-2 rounded-md bg-warning/10 px-2.5 py-1.5 text-[11.5px] text-warning">
          주소창의 편집 링크(<code>/edit</code>)를 넣으면 안 됩니다. 대시보드를 보는 사람이 그대로 시트를
          고칠 수 있게 됩니다.
        </p>
      </section>

      {canEdit ? (
        <section className="space-y-2 rounded-lg border border-line bg-panel p-3">
          <div className="flex flex-wrap gap-3">
            <label className="text-[11px] text-ink-dim">
              회사
              <select
                value={businessId}
                onChange={(e) => setBusinessId(e.target.value)}
                className="mt-1 block rounded-md border border-line bg-app px-2 py-1 text-[12px] text-ink"
              >
                {businesses.map((b) => (
                  <option key={b.business_id} value={b.business_id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] text-ink-dim">
              팀
              <input
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="경영지원"
                className="mt-1 block w-32 rounded-md border border-line bg-app px-2 py-1 text-[12px] text-ink"
              />
            </label>
            <label className="min-w-[200px] flex-1 text-[11px] text-ink-dim">
              제목
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="DY 경영지원 업무 프로세스"
                className="mt-1 block w-full rounded-md border border-line bg-app px-2 py-1 text-[12px] text-ink"
              />
            </label>
            <label className="text-[11px] text-ink-dim">
              순서
              <input
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                inputMode="numeric"
                className="mt-1 block w-16 rounded-md border border-line bg-app px-2 py-1 text-right text-[12px] text-ink tnum"
              />
            </label>
          </div>

          <label className="block text-[11px] text-ink-dim">
            게시 주소
            <input
              value={embedUrl}
              onChange={(e) => setEmbedUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/e/2PACX-.../pubhtml"
              className={`mt-1 block w-full rounded-md border bg-app px-2 py-1 text-[12px] text-ink ${
                liveProblem ? 'border-critical' : 'border-line'
              }`}
            />
          </label>
          {liveProblem ? (
            <p className="text-[11.5px] text-critical">{EMBED_PROBLEM_KO[liveProblem]}</p>
          ) : null}
          {error ? (
            <p className="rounded-md bg-critical/10 px-2.5 py-1.5 text-[11.5px] text-critical">{error}</p>
          ) : null}

          <button
            type="button"
            onClick={submit}
            disabled={pending || liveProblem !== null || embedUrl.trim() === ''}
            className="rounded-md bg-accent px-3.5 py-1.5 text-[12px] font-semibold text-app transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? '저장 중…' : '등록'}
          </button>
        </section>
      ) : (
        <p className="rounded-md bg-panel px-3 py-2 text-[12px] text-ink-dim">
          프로세스차트를 고칠 권한이 없습니다. (Chairman · Group CFO)
        </p>
      )}

      <section className="rounded-lg border border-line">
        {charts.length === 0 ? (
          <p className="px-3 py-4 text-center text-[12px] text-ink-muted">등록된 차트가 없습니다.</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {charts.map((c) => {
              const business = businesses.find((b) => b.business_id === c.business_id)
              return (
                <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="w-24 shrink-0 truncate text-[11.5px] text-ink-dim">
                    {business?.name ?? c.business_id}
                  </span>
                  <span className="w-20 shrink-0 truncate text-[11.5px] font-semibold text-ink">
                    {c.team_name}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-dim">{c.title}</span>
                  <a
                    href={c.embed_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="shrink-0 text-[11px] text-ink-muted hover:text-ink"
                  >
                    열기
                  </a>
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => remove(c.id, `${business?.name ?? c.business_id} ${c.team_name}`)}
                      aria-label={`${c.team_name} 링크 지우기`}
                      className="shrink-0 rounded p-1 text-ink-muted transition-colors hover:bg-raised hover:text-critical"
                    >
                      <Icon name="user-minus" className="size-3.5" />
                    </button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
