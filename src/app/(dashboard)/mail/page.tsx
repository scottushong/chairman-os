import { headers } from 'next/headers'

import { PageHeader } from '@/components/layout/page-header'
import { DisconnectGmail } from '@/components/mail/disconnect-gmail'
import { recordScreenRead } from '@/lib/activity-record'
import { currentUser } from '@/lib/auth/session'
import { DEFAULT_TIMEZONE, isValidTimezone } from '@/lib/chairman-timezone'
import { DATA_MODE } from '@/lib/env'
import { googleConfig } from '@/lib/google/config'
import { summarizeMail, todayMail, type MailItem, type MailResult } from '@/lib/google/gmail'
import { tr, type Lang } from '@/lib/i18n'
import { getRepository } from '@/lib/repository'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * `/mail` — 회장의 오늘 받은 메일 (Phase 9 블록 4).
 *
 * 제목 · 발신 · 시각만. 열면 Gmail 새 탭. **이 앱에서 보내지 않는다** — 쓰기 · 답장 버튼이 없다.
 * 키맨(email 일치)에게서 온 메일은 맨 위로 올리고 표시한다 — 아침 브리핑의 «중요 발신자»와 같은 판정.
 *
 * 회장 전용이다. 직원 메일은 범위 밖이라(원문) 다른 역할에게는 그 사실만 말한다.
 */

const NOTICE: Record<string, { ko: string; tone: 'ok' | 'warn' }> = {
  connected: { ko: 'Gmail이 연결되었습니다 (읽기 전용).', tone: 'ok' },
  cancelled: { ko: 'Google 화면에서 연결을 취소했습니다.', tone: 'warn' },
  state: { ko: '연결 요청이 만료되었거나 이 브라우저에서 시작되지 않았습니다. 다시 눌러 주세요.', tone: 'warn' },
  exchange: { ko: 'Google에서 토큰을 받지 못했습니다. 잠시 후 다시 시도하세요.', tone: 'warn' },
  save: { ko: '토큰을 저장하지 못했습니다.', tone: 'warn' },
  forbidden: { ko: '저장이 거절되었습니다 — 회장 계정이 아니거나, 보내기 권한이 섞인 연결이었습니다.', tone: 'warn' },
  config: { ko: 'Google OAuth 설정(GOOGLE_CLIENT_ID · GOOGLE_CLIENT_SECRET)이 아직 없습니다.', tone: 'warn' },
}

function demoMail(): MailResult {
  const at = (h: number, m: number) => new Date(Date.UTC(2026, 8, 28, h - 9, m)).toISOString()
  const item = (id: string, subject: string, from: string, fromEmail: string, t: string): MailItem => ({
    id, threadId: id, subject, from, fromEmail, receivedAt: t, url: 'https://mail.google.com/',
  })
  return {
    state: 'ok',
    email: 'chairman@example.com (DUMMY)',
    items: [
      item('d1', '폴란드 1차 선적 서류 확인 부탁드립니다', 'Anna Kowalska', 'anna@sticky-pl.example', at(9, 12)),
      item('d2', 'VANA 캐나다 파일럿 주간 보고', 'VANA 대표', 'ceo@vana.example', at(8, 40)),
      item('d3', '[뉴스레터] 9월 넷째 주 반도체 소재 동향', 'Materials Weekly', 'news@materials.example', at(7, 5)),
    ],
  }
}

export default async function MailPage({ searchParams }: PageProps<'/mail'>) {
  await recordScreenRead({ path: '/mail', kind: 'page' })
  const user = await currentUser()
  const lang: Lang = user?.language ?? 'ko'
  const params = await searchParams
  const notice = NOTICE[String(params.google ?? '')]

  if (user?.role !== 'Chairman') {
    return (
      <div className="mx-auto max-w-[900px] px-6 py-10">
        <PageHeader
          icon="mail"
          title={tr(lang, '메일', 'Mail')}
          code="Phase 9 · Block 4"
          description={tr(lang, '이 화면은 회장님의 Gmail을 읽기 전용으로 보여 줍니다. 직원 메일은 범위 밖입니다.', 'Chairman’s Gmail (read-only). Staff mail is out of scope.')}
        />
      </div>
    )
  }

  const repo = await getRepository()
  const [keymen, initiativeKeymen] = await Promise.all([repo.listKeymen(), repo.listInitiativeKeymen()])
  const keymanEmails = new Set(
    [...keymen, ...initiativeKeymen].map((k) => k.email).filter((e): e is string => !!e),
  )
  const keymanByEmail = new Map(
    [...keymen, ...initiativeKeymen].filter((k) => k.email).map((k) => [k.email as string, k.name]),
  )

  const tzRaw = (await headers()).get('x-vercel-ip-timezone')
  const tz = isValidTimezone(tzRaw) ? tzRaw : DEFAULT_TIMEZONE
  const result: MailResult = DATA_MODE === 'dummy' ? demoMail() : await todayMail(await createSupabaseServerClient(), tz)

  const items = result.state === 'ok' ? result.items : []
  const summary = summarizeMail(items, keymanByEmail)
  const ordered = [...items].sort(
    (a, b) => Number(keymanEmails.has(b.fromEmail)) - Number(keymanEmails.has(a.fromEmail)) || b.receivedAt.localeCompare(a.receivedAt),
  )
  const time = new Intl.DateTimeFormat('ko-KR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-5">
      <PageHeader
        icon="mail"
        title={tr(lang, '메일', 'Mail')}
        code="Phase 9 · Block 4"
        description={tr(
          lang,
          '오늘 받은 메일(읽기 전용). 누르면 Gmail이 새 탭으로 열립니다. 이 앱에서는 메일을 보내지 않습니다.',
          'Today’s mail, read-only. Opens in Gmail. This app never sends mail.',
        )}
      >
        {result.state === 'ok' && DATA_MODE !== 'dummy' ? <DisconnectGmail /> : null}
      </PageHeader>

      {notice ? (
        <p className={`mt-3 rounded-lg border px-3 py-2 text-[12px] ${notice.tone === 'ok' ? 'border-ok/40 bg-raised' : 'border-warning/50 bg-raised'}`}>
          {notice.ko}
        </p>
      ) : null}

      {result.state === 'unconfigured' || (!googleConfig() && DATA_MODE !== 'dummy') ? (
        <section className="glass mt-4 rounded-glass p-5 text-[12.5px] leading-relaxed text-ink-dim">
          <p className="font-semibold text-ink">Google OAuth 설정이 아직 없습니다.</p>
          <p className="mt-1">
            환경변수 <code>GOOGLE_CLIENT_ID</code> · <code>GOOGLE_CLIENT_SECRET</code>를 넣으면 이 자리에 «Gmail 연결» 버튼이
            섭니다. 리디렉션 URI는 <code>{'{APP_BASE_URL}'}/api/google/callback</code>입니다(다르면 <code>GOOGLE_REDIRECT_URI</code>).
            요청 범위는 <code>gmail.readonly</code> 하나입니다.
          </p>
        </section>
      ) : result.state === 'disconnected' ? (
        <section className="glass mt-4 rounded-glass p-5 text-[12.5px] text-ink-dim">
          <p className="font-semibold text-ink">Gmail이 연결되어 있지 않습니다.</p>
          <p className="mt-1">읽기 전용으로 연결합니다. 보내기 · 수정 권한은 요청하지 않습니다.</p>
          {/* 라우트 핸들러로 가는 전체 이동이다(OAuth 리디렉션) — next/link가 아니다. */}
          <a href="/api/google/auth" className="mt-3 inline-block rounded-lg bg-accent px-3 py-2 text-[12.5px] font-semibold text-white">
            Gmail 연결
          </a>
        </section>
      ) : result.state === 'error' ? (
        <section className="glass mt-4 rounded-glass p-5 text-[12.5px] text-ink-dim">
          <p className="font-semibold text-ink">메일을 읽지 못했습니다.</p>
          <p className="mt-1 text-ink-muted">사유: {result.reason}</p>
          <a href="/api/google/auth" className="mt-3 inline-block text-[12px] underline">다시 연결</a>
        </section>
      ) : (
        <section className="glass mt-4 rounded-glass p-4">
          <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-[13.5px] font-semibold">오늘 받은 메일 {summary.count}통</h2>
            <span className="text-[12px] text-ink-dim">
              중요 발신자(키맨) <span className="font-semibold text-ink">{summary.keyman}</span>통
            </span>
            <span className="ml-auto text-[11px] text-ink-muted">{result.email}</span>
          </div>
          {keymanEmails.size === 0 ? (
            <p className="mb-2 rounded-md bg-raised px-2.5 py-1.5 text-[11px] text-ink-dim">
              키맨에 이메일이 한 명도 없어 «중요 발신자»를 셀 수 없습니다. 회사 · 이니셔티브의 키맨 칸에 이메일을 넣어 주세요.
            </p>
          ) : null}
          {ordered.length === 0 ? (
            <p className="py-4 text-center text-[12px] text-ink-muted">오늘 받은 메일이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-line-soft">
              {ordered.map((m) => {
                const keyman = keymanByEmail.get(m.fromEmail)
                return (
                  <li key={m.id}>
                    <a href={m.url} target="_blank" rel="noreferrer noopener" className="flex items-baseline gap-3 py-2 hover:text-accent">
                      <span className="w-12 shrink-0 text-[11px] text-ink-muted tnum">{time.format(new Date(m.receivedAt))}</span>
                      <span className="w-[180px] shrink-0 truncate text-[12px]">
                        {keyman ? <span className="mr-1 rounded bg-gold/20 px-1 text-[10px] font-semibold text-gold">키맨</span> : null}
                        {m.from}
                      </span>
                      <span className={`min-w-0 flex-1 truncate text-[12.5px] ${keyman ? 'font-semibold' : ''}`}>{m.subject}</span>
                    </a>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
