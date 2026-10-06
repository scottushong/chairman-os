'use client'

import { useState } from 'react'

import { removeMyPhotoAction, saveMyPhotoAction } from '@/app/actions/profile'
import { ProfilePhoto } from '@/components/settings/profile-photo'
import { FileDropZone } from '@/components/ui/file-drop-zone'
import { checkPhotoFile, PHOTO_MIME } from '@/lib/profile-photo'

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

  /** 공통 첨부 부품이 형식 · 2MB를 먼저 보고, 맞는 첫 장만 넘긴다. */
  async function uploadPhoto(file: File) {
    setError(null)
    const fd = new FormData()
    fd.set('photo', file)
    const result = await saveMyPhotoAction(fd)
    if (result.error) throw new Error(result.error)
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
        <FileDropZone
          label="프로필 사진 올리기"
          accept={PHOTO_MIME.join(',')}
          check={checkPhotoFile}
          max={1}
          upload={uploadPhoto}
          disabled={pending}
          pickLabel={pending ? '처리 중…' : path ? '사진 바꾸기' : '사진 올리기'}
          hint="PNG · JPG · WebP, 2MB까지 · 한 장만"
          extra={
            path ? (
              <button
                type="button"
                onClick={onRemove}
                disabled={pending}
                className="min-h-11 rounded-md px-2 text-t11h text-critical transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed lg:min-h-0 lg:py-1.5"
              >
                내리기
              </button>
            ) : null
          }
        />
        {error ? (
          <p role="alert" className="mt-1 text-t11 text-critical">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}
