/**
 * 엑셀에서 복사한 열 하나를 12개월로 푼다 (Phase 2-C 블록 2).
 *
 * **못 읽은 칸은 0이 아니라 null이다.** 파서가 조용히 0을 넣으면 그 0이 요약 전표를 타고
 * 장부로 들어가, '그 달 매출 0원'이라는 없는 사실이 확정된다. 실패는 숫자가 아니라
 * 빈칸으로 남기고, 몇 칸이 실패했는지 화면이 말한다.
 *
 * 받는 모양은 둘이다. 열을 복사하면 줄바꿈, 행을 복사하면 탭으로 온다.
 * 회계 표기(천 단위 쉼표, 통화 기호, 괄호 음수)를 그대로 받는다 —
 * 회장이 붙여넣기 전에 엑셀에서 서식을 지우게 만들 이유가 없다.
 */

export interface PasteResult {
  /** 길이가 항상 slots다. 모자라면 null로 채우고 넘치면 자른다. */
  values: (number | null)[]
  /** 내용은 있는데 숫자로 못 읽은 칸 수. 빈 칸은 여기 세지 않는다. */
  failed: number
  /** slots를 넘겨 버린 칸 수. 조용히 자르지 않고 알린다. */
  overflow: number
}

/**
 * 한 칸을 숫자로. 못 읽으면 undefined, 빈 칸이면 null.
 *
 * 괄호는 회계에서 음수다 — (1,200)은 -1200이다. 이걸 1200으로 읽으면
 * 비용이 이익으로 뒤집힌다.
 */
function parseCell(raw: string): number | null | undefined {
  const text = raw.trim()
  if (text === '') return null

  const negative = /^\(.*\)$/.test(text)
  // 통화 기호·쉼표·공백을 걷어낸다. 남는 것은 부호와 숫자와 소수점뿐이어야 한다.
  const bare = (negative ? text.slice(1, -1) : text)
    .replace(/[₩$€¥£,\s]/g, '')
    .replace(/^\+/, '')

  if (!/^-?\d+(\.\d+)?$/.test(bare)) return undefined

  const value = Number(bare)
  if (!Number.isFinite(value)) return undefined
  // 원 단위로 반올림한다. 장부에 전 단위는 없다.
  return Math.round(negative ? -value : value)
}

export function parsePastedColumn(text: string, slots: number): PasteResult {
  // 줄바꿈 표기를 하나로 맞춘 뒤 탭·줄바꿈 **하나마다** 자른다.
  // 여러 개를 한 번에 자르면(\s+) 빈 칸이 사라져 그 뒤 달이 한 칸씩 앞으로 밀린다.
  const cells = text.replace(/\r\n?/g, '\n').split(/[\t\n]/)

  const values: (number | null)[] = []
  let failed = 0

  for (const cell of cells.slice(0, slots)) {
    const parsed = parseCell(cell)
    if (parsed === undefined) {
      failed += 1
      values.push(null)
    } else {
      values.push(parsed)
    }
  }

  while (values.length < slots) values.push(null)

  return { values, failed, overflow: Math.max(0, cells.length - slots) }
}
