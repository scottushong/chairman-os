'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import type { KakaoConnection } from '@/types'

/**
 * 카카오 알림 연결 · 테스트 발송 (Phase 3-C). Chairman에게만 그려진다.
 *
 * 연결은 server action이 아니라 링크다 — 카카오 로그인 화면으로 **브라우저가 통째로**
 * 넘어갔다 돌아와야 하는 흐름이라 fetch로는 할 수 없다.
 *
 * 화면이 고르는 상태는 넷이다.
 *   연결 없음        "카카오 연결"
 *   동의 없음        "다시 연결" — 로그인은 됐는데 '카카오톡 메시지 전송' 체크를 풀고 넘어갔다.
 *                    선택 동의라 일어난다. 그대로 두면 아침 07:00에 -402로 조용히 실패한다.
 *   refresh 만료     "다시 연결" — 60일 동안 한 번도 안 갱신되면 여기로 온다.
 *   정상             "연결됨" + 테스트 발송
 *
 * access_token은 이 컴포넌트의 props에 없다. 0023 kakao_token_status()가 반환 목록에서
 * 뺐기 때문에 실수로 넘길 방법 자체가 없다.
 */

const NOTICE: Record<string, { tone: 'ok' | 'warn' | 'error'; text: string }> = {
  connected: { tone: 'ok', text: '카카오에 연결했습니다. 내일 아침 07시부터 브리핑이 카톡으로 옵니다.' },
  noscope: {
    tone: 'warn',
    text: '연결은 됐지만 “카카오톡 메시지 전송” 동의가 없습니다. 다시 연결하면서 그 항목을 체크해 주세요.',
  },
  cancelled: { tone: 'warn', text: '카카오 화면에서 취소했습니다. 연결되지 않았습니다.' },
  state: { tone: 'error', text: '연결 요청이 만료됐거나 확인되지 않았습니다. 다시 눌러 주세요.' },
  save: { tone: 'error', text: '토큰을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' },
  forbidden: { tone: 'error', text: '카카오 연결은 회장 계정만 할 수 있습니다.' },
  failed: { tone: 'error', text: '카카오와 토큰을 교환하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' },
  config: { tone: 'error', text: '카카오 환경변수가 설정되지 않았습니다. 배포 설정을 확인해 주세요.' },
}

function hasTalkMessage(scopes: string): boolean {
  return scopes.split(/[\s,]+/).includes('talk_message')
}

function formatDay(iso: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric',
  }).format(new Date(iso))
}

export function KakaoConnect({
  connection,
  notice,
  now,
}: {
  connection: KakaoConnection | null
  notice?: string
  /**
   * 기준 시각(ISO). 서버가 찍어 내려 준다 — 클라이언트 컴포넌트 렌더 중에 Date.now()를
   * 부르면 react-hooks/purity(React Compiler 규칙)가 순수하지 않은 호출로 잡아낸다.
   * page.tsx의 kstToday()와 같은 이유다.
   */
  now: string
}) {
  const router = useRouter()
  const [sending, setSending] = useState(false)
  const [, startTransition] = useTransition()
  const [result, setResult] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null)

  const banner = notice ? NOTICE[notice] : undefined
  const expired = connection ? Date.parse(connection.refresh_expires_at) <= Date.parse(now) : false
  const scopeMissing = connection ? !hasTalkMessage(connection.scopes) : false
  const healthy = connection !== null && !expired && !scopeMissing

  async function test() {
    setSending(true)
    setResult(null)
    try {
      const res = await fetch('/api/kakao/test', { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { sent?: boolean; skipped?: string; error?: string }
      // skipped(연결 없음·동의 없음·만료)와 error(발송 자체 실패)는 회장이 할 일이 다르다 —
      // skipped는 다시 연결하면 되고, error는 잠시 뒤 재시도할 일이다. 그래서 tone도 나눈다.
      setResult(
        body.sent
          ? { tone: 'ok', text: '보냈습니다. 카카오톡을 확인해 주세요.' }
          : body.skipped
            ? { tone: 'warn', text: body.skipped }
            : { tone: 'error', text: body.error ?? `발송 실패 (HTTP ${res.status})` },
      )
      startTransition(() => router.refresh())
    } catch (e) {
      setResult({ tone: 'error', text: e instanceof Error ? e.message : '발송 요청 실패' })
    } finally {
      setSending(false)
    }
  }

  const tone = (t: 'ok' | 'warn' | 'error') =>
    t === 'ok' ? 'text-ok' : t === 'warn' ? 'text-warning' : 'text-critical'

  return (
    <div>
      {banner ? (
        <p role="status" className={`mb-2 text-[11.5px] ${tone(banner.tone)}`}>
          {banner.text}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {healthy ? (
          <>
            <span className="flex items-center gap-1.5 text-[12px] text-ok">
              연결됨
            </span>
            <span className="text-[11px] text-ink-muted tnum">
              {formatDay(connection!.refresh_expires_at)}까지
            </span>
            <button
              type="button"
              onClick={test}
              disabled={sending}
              className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink disabled:cursor-wait disabled:opacity-60"
            >
              {sending ? '보내는 중…' : '테스트 발송'}
            </button>
            <a
              href="/api/kakao/auth"
              className="text-[11px] text-ink-muted underline-offset-2 hover:text-ink hover:underline"
            >
              다시 연결
            </a>
          </>
        ) : (
          <>
            {connection ? (
              <span className={`text-[12px] ${tone('warn')}`}>
                {expired ? '연결이 만료됐습니다.' : '메시지 전송 동의가 없습니다.'}
              </span>
            ) : null}
            <a
              href="/api/kakao/auth"
              className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-app transition-opacity hover:opacity-90"
            >
              {connection ? '다시 연결' : '카카오 연결'}
            </a>
          </>
        )}

        {result ? (
          <span role="status" className={`text-[11.5px] ${tone(result.tone)}`}>
            {result.text}
          </span>
        ) : null}
      </div>
    </div>
  )
}
