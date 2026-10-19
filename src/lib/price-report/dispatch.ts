import 'server-only'

/**
 * «지금 업데이트» → GitHub Actions workflow_dispatch(macro-briefing.yml). 토큰은 env GITHUB_DISPATCH_TOKEN(이 저장소 Actions 쓰기만 있는
 * fine-grained 토큰 — 값은 대표가 Vercel에 넣는다). 없으면 버튼 자리에 «설정 전 — 자동 업데이트만 됩니다».
 * 시험은 fetchImpl로 가짜 GitHub를 넣는다(진짜 호출 0).
 */

export const DISPATCH_REPO = process.env.GITHUB_DISPATCH_REPO?.trim() || 'scottushong/chairman-os'
export const DISPATCH_WORKFLOW = 'macro-briefing.yml'

export function dispatchReady(): boolean {
  return !!process.env.GITHUB_DISPATCH_TOKEN?.trim()
}

export async function dispatchPriceReport(runId: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = process.env.GITHUB_DISPATCH_TOKEN?.trim()
  if (!token) return { ok: false, error: '자동 실행 토큰이 설정되지 않았습니다' }
  const ref = process.env.GITHUB_DISPATCH_REF?.trim() || 'master'
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${DISPATCH_REPO}/actions/workflows/${DISPATCH_WORKFLOW}/dispatches`, {
      method: 'POST',
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref, inputs: { run_id: runId, slot: 'manual' } }),
      signal: AbortSignal.timeout(15_000),
    })
    if (res.status === 204 || res.ok) return { ok: true }
    return { ok: false, error: `GitHub 실행 요청 실패(HTTP ${res.status})` }
  } catch (e) {
    return { ok: false, error: `GitHub 실행 요청 실패(${e instanceof Error ? e.message.slice(0, 80) : '?'})` }
  }
}
