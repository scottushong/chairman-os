/**
 * ECOUNT 엑셀 개요 (오프라인 · 읽기만 · DB 없음): npx tsx scripts/ecount-outline.ts <파일.xlsx> [...]
 *
 * 저장소 밖 실제 파일(docs/onboarding/ecount-real-files.md)이 업로드 파서를 지나는지, 시트마다 몇 행 · 몇 열인지만 찍는다.
 * 숫자 칸은 찍지 않는다(시트 이름 · 크기 · 개요만). 아무 데도 쓰지 않는다.
 */
import { readFileSync } from 'node:fs'

import { ecountBytesProblem, ecountFileProblem } from '../src/lib/ecount/excel/file-rules'
import { outlineWorkbook, readEcountWorkbook } from '../src/lib/ecount/excel/workbook'

async function main() {
  const files = process.argv.slice(2)
  if (files.length === 0) {
    console.error('사용: npx tsx scripts/ecount-outline.ts <파일.xlsx> [...]')
    process.exit(2)
  }
  let failed = 0
  for (const f of files) {
    const name = f.split(/[\\/]/).pop() ?? f
    const bytes = new Uint8Array(readFileSync(f))
    const problem = ecountFileProblem(name) ?? ecountBytesProblem(bytes.slice(0, 512))
    if (problem) {
      failed += 1
      console.log(`✕ ${name}: ${problem}`)
      continue
    }
    try {
      const sheets = await readEcountWorkbook(bytes)
      console.log(`✓ ${name}`)
      for (const o of outlineWorkbook(sheets)) console.log(`   ${JSON.stringify(o)}`)
    } catch (e) {
      failed += 1
      console.log(`✕ ${name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  process.exit(failed ? 1 : 0)
}

void main()
