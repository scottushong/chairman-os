import { photoInitial } from '@/lib/profile-photo'

/**
 * 사람 얼굴 동그라미 (0032). 서버·클라이언트 어디서나 쓰는 순수 컴포넌트다.
 *
 * next/image를 쓰지 않는다 — 서명 URL이 1시간마다 바뀌어(signProfilePhotos) 최적화 캐시가
 * 매번 빗나가고, 그 최적화가 수십 KB짜리 얼굴 사진에 주는 값보다 유지비가 크다
 * (components/initiatives/initiative-logo.tsx가 로고에 내린 것과 같은 판단).
 *
 * **path가 있는데 url이 없을 수 있다.** 서명이 실패했거나(정책이 막았거나 네트워크)
 * 그 사람의 사진을 볼 권한이 없을 때다. 그때는 이름 첫 글자로 떨어진다 — 깨진 이미지
 * 아이콘을 그리지 않는다. 사진이 안 보이는 것이 화면이 안 보이는 것보다 낫다.
 */
export function ProfilePhoto({
  name,
  path,
  url,
  size = 32,
}: {
  name: string
  /** user_profiles.photo_path. null이면 사진이 없다. */
  path: string | null
  /** signProfilePhotos()가 이 path에 내준 서명 URL. */
  url?: string
  size?: number
}) {
  const style = { width: size, height: size } as const

  if (path && url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={`${name} 프로필 사진`}
        style={style}
        className="shrink-0 rounded-full border border-line-soft object-cover"
      />
    )
  }

  return (
    <span
      style={{ ...style, fontSize: Math.max(11, Math.round(size * 0.42)) }}
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full bg-raised font-semibold text-ink-dim"
    >
      {photoInitial(name)}
    </span>
  )
}
