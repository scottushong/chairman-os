import Link from 'next/link'
import { redirect } from 'next/navigation'

import { PageHeader } from '@/components/layout/page-header'
import { recordScreenRead } from '@/lib/activity-record'
import { currentUser } from '@/lib/auth/session'
import { kstToday } from '@/lib/chairman-project'
import { tr, type Lang } from '@/lib/i18n'
import { JITSI_ORIGIN, ROOM_PATTERN, meetRoom, roomOf } from '@/lib/meet'
import { getRepository } from '@/lib/repository'

/**
 * `/meet` — 화상회의 (Phase 9 블록 5, Jitsi Meet 임베드 · 계정 불필요).
 *
 * ?room=이 방 이름 모양(chairman-os-…)일 때만 iframe을 띄운다 — 주소창에 아무 문자열이나 넣어
 * 남의 사이트를 이 화면 안에 띄우지 못하게. 방 이름이 곧 입장권이라 화면에 방 이름을 크게 드러내지
 * 않고, «링크 복사»도 두지 않는다(초대는 일정의 참석자 알림으로 간다).
 *
 * 목록은 앞으로 2주의 «미팅» 일정 가운데 화상 링크가 있는 것. 일정 표는 회장 · 그룹 CFO만 읽는다
 * (0017) — 다른 역할에게는 목록이 비고, 알림으로 받은 링크로 들어온다.
 */

async function startInstant() {
  'use server'
  // 즉석 회의실. DB에 남기지 않는다 — 일정이 아니라 지금 여는 방이다.
  redirect(`/meet?room=${meetRoom(null, kstToday())}`)
}

export default async function MeetPage({ searchParams }: PageProps<'/meet'>) {
  await recordScreenRead({ path: '/meet', kind: 'page' })
  const params = await searchParams
  const raw = Array.isArray(params.room) ? params.room[0] : params.room
  const room = raw && ROOM_PATTERN.test(raw) ? raw : null

  const user = await currentUser()
  const lang: Lang = user?.language ?? 'ko'
  const repo = await getRepository()
  const today = kstToday()
  const until = new Date(`${today}T00:00:00Z`)
  until.setUTCDate(until.getUTCDate() + 14)
  const last = until.toISOString().slice(0, 10)
  const events = (await repo.listEvents().catch(() => []))
    .filter((e) => e.kind === 'Meeting' && roomOf(e.video_url) && (e.ends_on ?? e.starts_on) >= today && e.starts_on <= last)
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on))

  const displayName = user?.name ? `#userInfo.displayName=${encodeURIComponent(JSON.stringify(user.name))}` : ''

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      <PageHeader
        icon="video"
        title={tr(lang, '화상회의', 'Video meetings')}
        code="Phase 9 · Block 5"
        description={tr(
          lang,
          'Jitsi Meet(계정 불필요). 캘린더의 미팅 일정에서 «화상 링크 생성»을 누르면 참석자에게 알림이 갑니다.',
          'Jitsi Meet, no account needed. Create a link from a Meeting event to notify attendees.',
        )}
      >
        <form action={startInstant}>
          <button type="submit" className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-white">
            {tr(lang, '즉석 회의실 열기', 'Start instant room')}
          </button>
        </form>
      </PageHeader>

      <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        {room ? (
          <section className="overflow-hidden rounded-glass border border-line-soft bg-black" aria-label={tr(lang, '회의실', 'Room')}>
            <iframe
              title={tr(lang, '화상회의', 'Video meeting')}
              src={`${JITSI_ORIGIN}/${room}${displayName}`}
              allow="camera; microphone; fullscreen; display-capture; autoplay; clipboard-write"
              className="h-[72vh] min-h-[420px] w-full"
            />
            <div className="flex items-center justify-end gap-3 bg-panel px-3 py-2 text-[11.5px]">
              <a href={`${JITSI_ORIGIN}/${room}`} target="_blank" rel="noreferrer noopener" className="text-ink-dim hover:text-ink hover:underline">
                {tr(lang, '새 탭으로 열기', 'Open in new tab')}
              </a>
              <Link href="/meet" className="text-ink-dim hover:text-ink hover:underline">
                {tr(lang, '나가기', 'Leave')}
              </Link>
            </div>
          </section>
        ) : (
          <section className="glass rounded-glass p-6 text-[12.5px] leading-relaxed text-ink-dim">
            <p className="font-semibold text-ink">{tr(lang, '들어갈 회의를 고르세요.', 'Pick a meeting to join.')}</p>
            <p className="mt-1">
              {tr(
                lang,
                '오른쪽의 예정된 회의에 들어가거나, 알림으로 받은 링크를 누르거나, 즉석 회의실을 엽니다.',
                'Join a scheduled meeting, follow a notification link, or start an instant room.',
              )}
            </p>
          </section>
        )}

        <aside className="glass rounded-glass p-4">
          <h2 className="text-[13px] font-semibold">{tr(lang, '앞으로 2주 · 화상 회의', 'Next 2 weeks')}</h2>
          {events.length === 0 ? (
            <p className="mt-2 text-[12px] text-ink-muted">
              {tr(lang, '화상 링크가 있는 미팅이 없습니다.', 'No meetings with a video link.')}
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-line-soft">
              {events.map((e) => {
                const r = roomOf(e.video_url)!
                return (
                  <li key={e.event_id} className="py-2">
                    <Link href={`/meet?room=${r}`} className={`block text-[12.5px] ${r === room ? 'font-semibold text-accent' : 'hover:text-accent'}`}>
                      {e.title}
                    </Link>
                    <p className="text-[10.5px] text-ink-muted tnum">
                      {e.starts_on}
                      {e.location ? ` · ${e.location}` : ''} · {tr(lang, `참석 ${e.attendee_ids?.length ?? 0}명`, `${e.attendee_ids?.length ?? 0} invited`)}
                    </p>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>
      </div>
    </div>
  )
}
