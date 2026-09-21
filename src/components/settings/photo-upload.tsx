'use client'

import { useRef, useState } from 'react'

import { removeMyPhotoAction, saveMyPhotoAction } from '@/app/actions/profile'
import { ProfilePhoto } from '@/components/settings/profile-photo'
import { PHOTO_MIME } from '@/lib/profile-photo'

/**
 * 프로필 사진 올리기·내리기 (0032).
 *
 * `components/initiatives/logo-upload.tsx`와 같은 모양이다. 다른 것은 **누구 것인가**뿐이고,
 * 그 차이가 이 컴포넌트에는 **나타나지 않는다** — 어느 사람의 사진인지 서버에 보내지
 * 않기 때문이다. 경로는 DB의 auth.uid()가 정한다.
 *
 * 낙관적 미리보기가 없다. 방금 고른 파일을 로컬 URL로 먼저 보여 주면 업로드가 실패했을 때
 * 화면에만 있는 사진이 그대로 남는다. 서버가 반영한 뒤 revalidatePath로 내려오는 새 서명
 * URL만 그린다(path/url prop이 부모 서버 컴포넌트에서 다시 내려온다).
 */
export function PhotoUpload({
  name,
  path,
  url,
}: {
  name: string
  path: string | null
  url?: string
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // 같은 파일을 다시 골라도 change 이벤트가 뜨도록 비워 둔다.
    if (!file) return
    setError(null)
    setPending(true)
    const fd = new FormData()
    fd.set('photo', file)
    const result = await saveMyPhotoAction(fd)
    setPending(false)
    if (result.error) setError(result.error)
  }

  async function onRemove() {
    setError(null)
    setPending(true)
    const result = await removeMyPhotoAction()
    setPending(false)
    if (result.error) setError(result.error)
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3">
      <ProfilePhoto name={name} path={path} url={url} size={64} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={pending}
            className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink disabled:opacity-50"
          >
            {pending ? '올리는 중…' : path ? '사진 바꾸기' : '사진 올리기'}
          </button>
          {path ? (
            <button
              type="button"
              onClick={onRemove}
              disabled={pending}
              className="rounded-md px-2 py-1.5 text-[11.5px] text-critical transition-colors hover:underline disabled:cursor-not-allowed"
            >
              내리기
            </button>
          ) : null}
          <input
            ref={inputRef}
            type="file"
            accept={PHOTO_MIME.join(',')}
            className="hidden"
            onChange={onPick}
          />
        </div>
        <p className="mt-1 text-[10.5px] text-ink-muted">PNG · JPG · WebP, 2MB까지</p>
        {error ? (
          <p role="alert" className="mt-1 text-[11px] text-critical">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}
