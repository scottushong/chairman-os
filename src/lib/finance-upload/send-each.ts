/**
 * 여러 파일 올리기의 차례(화면 finance-upload-board.tsx · 검사 check-upload-hardening.ts) — 파일마다 한 요청.
 * 한 파일이 던져도(연결 끊김 · 시간 초과 · 서버 오류) 그 파일만 «실패» 카드가 되고 다음 파일로 간다. 순수(보내기는 one이 한다).
 */

export interface SendCard {
  file_name: string
  status: string
  message: string
}

export async function sendEach<F extends { name: string }, C extends SendCard>(
  files: F[],
  one: (f: F) => Promise<C[]>,
  failed: (fileName: string, message: string) => C,
  onProgress?: (done: number, total: number, f: F, cards: C[]) => void,
): Promise<C[]> {
  const out: C[] = []
  for (const [i, f] of files.entries()) {
    onProgress?.(i, files.length, f, out)
    try {
      out.push(...(await one(f)))
    } catch (e) {
      out.push(failed(f.name, `올리지 못했습니다(${e instanceof Error ? e.message.slice(0, 120) : '연결 끊김'}) — 이 파일만 다시 올려 주세요.`))
    }
  }
  onProgress?.(files.length, files.length, files[files.length - 1], out)
  return out
}
