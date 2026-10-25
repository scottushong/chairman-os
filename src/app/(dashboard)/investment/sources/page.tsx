import { CollectNowButton, ManualHoldingsForm, SettingsForm } from '@/components/investment/forms'
import { InvCard, NoData, PageTitle, StatusBadge, T, Td, Th } from '@/components/investment/ui'
import { kstToday } from '@/lib/chairman-project'
import { secUserAgent } from '@/lib/investment/collect/http'
import { seoulDateTime } from '@/lib/investment/format'
import { investmentViewer } from '@/lib/investment/screen'
import { sourceStatus } from '@/lib/investment/view'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** 데이터 상태 — 경로마다 LIVE · PARTIAL · DEMO · UNAVAILABLE · DISABLED, 마지막 성공 시각, 오늘 호출, 필요한 키(이름만), 수집 기록, 손 입력. */
export default async function SourcesPage() {
  const { repo, admin } = await investmentViewer()
  const [sources, runs, settings] = await Promise.all([repo.invSources(), repo.invRuns(10), repo.invSettings()])
  const ua = secUserAgent()
  const today = kstToday()
  const usedToday = sources.filter((s) => s.calls_day === today).reduce((t, s) => t + s.calls_today, 0)

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="데이터 상태" sub="무료 · 공식 경로만. 실제 데이터가 없는 칸은 꾸며 채우지 않고 상태로 보입니다." right={admin ? <CollectNowButton /> : null} />

      <InvCard title="수집 경로" sub={`오늘(서울) 외부 호출 ${usedToday} / 한도 ${settings.collect_daily_limit}회 · 수집은 Integration 계정(수집 전용) · 매일 06:30 KST cron`}>
        <T minWidth={760}>
          <thead>
            <tr><Th>경로</Th><Th>상태</Th><Th>마지막 성공</Th><Th n>오늘 호출</Th><Th>키</Th><Th>메모 · 최근 오류</Th></tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.source_id}>
                <Td><a href={s.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-ink hover:text-accent hover:underline lg:min-h-0">{s.label}</a><div className="text-[13px] text-ink-muted">{s.cadence}</div></Td>
                <Td><StatusBadge status={sourceStatus(s)} /></Td>
                <Td>{s.last_success_at ? seoulDateTime(s.last_success_at) : '없음'}</Td>
                <Td n>{s.calls_day === today ? s.calls_today : 0}</Td>
                <Td className="text-[13px]">{s.key_env ? `${s.key_env} ${process.env[s.key_env]?.trim() ? '(있음)' : '(없음)'}` : '필요 없음'}</Td>
                <Td className="max-w-[360px] text-[13px] whitespace-normal text-ink-muted">
                  {s.status_note ?? ''}
                  {s.last_error ? <div className="text-critical">최근 오류({seoulDateTime(s.last_attempt_at)}): {s.last_error.slice(0, 200)}</div> : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </T>
        <ul className="flex flex-col gap-1 text-[13px] text-ink-muted">
          <li><StatusBadge status="LIVE" /> 공식 경로에서 받아 기준일 · 출처가 있음 · <StatusBadge status="PARTIAL" /> 일부만(분기말만 · 공개 범위 일부) · <StatusBadge status="UNAVAILABLE" /> 받지 못함(키 없음 · 사이트 차단 · 수집 전) · <StatusBadge status="DEMO" /> 원문 예시 값 · <StatusBadge status="DISABLED" /> 대표가 끔</li>
          <li>SEC Fair Access: User-Agent {ua.configured ? '환경변수 SEC_USER_AGENT 사용' : '«DY Industry chairman-os»(SEC_USER_AGENT 비어 있음 — 회사명 + 연락 이메일을 넣기 권함)'} · 초당 4회 이하 · 429/5xx는 1·2·4초 뒤 다시.</li>
        </ul>
      </InvCard>

      <InvCard title="수집 기록" sub="최근 10번 — 단계마다 성공 · 호출 수 · 메모">
        {runs.length === 0 ? (
          <NoData need="아직 수집한 적이 없습니다." />
        ) : (
          <ul className="flex flex-col gap-2">
            {runs.map((r) => (
              <li key={r.run_id} className="rounded-lg border border-line-soft p-2.5">
                <div className="flex flex-wrap items-center gap-2 text-[14px]">
                  <span className="font-semibold">#{r.run_id}</span>
                  <span className="text-ink-muted">{seoulDateTime(r.started_at)} · {r.trigger === 'cron' ? '자동(cron)' : r.trigger === 'manual' ? '대표 «지금 수집»' : '시험'}</span>
                  <span className={r.ok === false ? 'text-critical' : r.ok ? 'text-ok' : 'text-ink-muted'}>{r.ok === null ? '진행 중 · 끊김' : r.ok ? '성공' : '일부 실패'}</span>
                  <span className="text-ink-muted">호출 {r.calls}회</span>
                </div>
                <ul className="mt-1 grid gap-x-4 sm:grid-cols-2">
                  {(r.steps ?? []).map((s, i) => (
                    <li key={i} className={`text-[13px] ${s.ok ? 'text-ink-muted' : 'text-critical'}`}>{s.ok ? '✓' : '✗'} {s.step} — {s.note}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </InvCard>

      {admin ? (
        <>
          <InvCard id="manual" title="공개 보유 손 입력" sub="자동 수집이 막힌 공식 자료(Fundsmith Factsheet · Pershing 사이트) — 출처 주소 · 자료 기준일 필수, 공개일은 따로. 공개하지 않은 포지션은 적지 않는다.">
            <ManualHoldingsForm />
          </InvCard>
          <InvCard title="설정" sub="하루 외부 호출 한도 · BUY 최소 데이터 품질 · 월 투자 예정액(실측이 아니라 계획 값)">
            <SettingsForm limit={settings.collect_daily_limit} quality={settings.data_quality_min} budget={settings.monthly_budget_krw} />
          </InvCard>
        </>
      ) : null}
    </div>
  )
}
