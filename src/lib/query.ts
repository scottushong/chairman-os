/**
 * 목록 화면의 필터는 URL에 둔다.
 *
 * 이유는 두 가지다. 하나는 이 프로젝트에 localStorage 저장소를 두지 않기로 한 것이고,
 * 다른 하나는 필터가 걸린 화면을 그대로 남에게 보낼 수 있어야 하기 때문이다 —
 * "biz_dy의 Blocked 업무를 봐 달라"가 링크 한 줄이 된다.
 *
 * 값이 없으면 키를 아예 뺀다. `?status=`가 붙은 URL과 안 붙은 URL이 같은 화면을 뜻하면
 * 지금 어느 탭이 켜져 있는지를 판정하는 자리가 두 곳으로 갈라진다.
 */
export function withParams(
  path: string,
  params: Record<string, string | undefined | null>,
): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value)
  }
  const qs = search.toString()
  return qs ? `${path}?${qs}` : path
}

/**
 * searchParams의 한 칸을 문자열 하나로 좁힌다.
 * 같은 키가 두 번 오면(?status=Todo&status=Done) 배열이 온다. 첫 값만 쓴다 —
 * 목록 필터는 배열을 뜻하도록 만들지 않았고, 조용히 무시하는 편이 화면이 비는 것보다 낫다.
 */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/** 알려진 값 중 하나일 때만 통과시킨다. URL은 사람이 손으로 고칠 수 있는 입력이다. */
export function oneOf<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  return value !== undefined && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined
}
