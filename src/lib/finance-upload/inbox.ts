/**
 * 0082 자료 올리기 수신함 — 화면(브라우저)과 서버가 같이 쓰는 순수 부분. 브라우저 번들에 들어가므로 서버 모듈을 들이지 않는다.
 * 경로 = «<회사>/<본인 uid>/<임의 이름>.<확장자>». 최종 판정은 DB 정책 fin_inbox_object_ok(0082)다.
 */

export const FIN_INBOX = 'fin-upload-inbox'

/** 0082 수신함 경로 모양인가(회사 · 본인 · 이름 한 칸). */
export function inboxPathOk(path: string, businessId: string, userId: string): boolean {
  const p = path.split('/')
  // 이름 칸은 «임의 id[.확장자]»만 — «..» 같은 점 이름을 받지 않는다.
  return p.length === 3 && p[0] === businessId && p[1] === userId && /^[A-Za-z0-9_-]{1,100}(\.[a-z0-9]{1,5})?$/.test(p[2])
}

/** 화면이 만드는 수신함 경로 — 이름은 임의(원래 파일 이름은 요청에 따로 싣는다), 확장자만 남긴다. */
export function inboxPath(businessId: string, userId: string, fileName: string, id: string): string {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(fileName)?.[1]?.toLowerCase()
  return `${businessId}/${userId}/${id}${ext ? `.${ext}` : ''}`
}
