import 'server-only'

import { createHash } from 'node:crypto'

/**
 * 비밀번호 정책 (Phase 6-2 블록 3) — 12자 이상 + 유출 목록 검사.
 *
 * 유출 검사는 Have I Been Pwned의 k-익명성 API다: SHA-1 해시의 **앞 5글자만** 보내고, 돌아온 목록에서
 * 나머지를 이 서버가 맞춰 본다. 비밀번호도 전체 해시도 밖으로 나가지 않는다. 키도 비용도 없다.
 * Supabase의 «유출 비밀번호 차단»(HIBP) 옵션은 요금제에 따라 쓸 수 없어서, 앱이 같은 검사를 한다 —
 * 대시보드에서 켤 수 있으면 둘 다 걸린다(OPERATIONS «비밀번호 정책»).
 *
 * API가 안 닿으면(네트워크) 막지 않는다 — 가입 · 변경 전체가 외부 서비스 하나에 묶이지 않게.
 * 대신 결과에 checked=false를 싣는다.
 */
export const PASSWORD_MIN = 12

export async function passwordProblem(password: string): Promise<string | null> {
  if (password.length < PASSWORD_MIN) return `비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다.`
  const { pwned } = await pwnedCount(password)
  if (pwned > 0) return '이 비밀번호는 유출된 비밀번호 목록에 있습니다. 다른 비밀번호를 쓰세요.'
  return null
}

export async function pwnedCount(password: string): Promise<{ pwned: number; checked: boolean }> {
  const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase()
  const prefix = sha1.slice(0, 5)
  const suffix = sha1.slice(5)
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' },
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return { pwned: 0, checked: false }
    const body = await res.text()
    for (const line of body.split('\n')) {
      const [s, n] = line.trim().split(':')
      if (s === suffix) return { pwned: Number(n) || 0, checked: true }
    }
    return { pwned: 0, checked: true }
  } catch {
    return { pwned: 0, checked: false }
  }
}
