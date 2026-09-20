/**
 * Phase 5-C 날씨 아이콘 매핑 검증 (오프라인, 네트워크 없음): npm run check:weather
 *
 * 무엇을 재나
 *   1) **라벨이 있는 코드는 전부 아이콘이 있다.** 이게 이 스크립트의 요점이다 —
 *      WMO 28개를 그림 여섯 개로 접다 보면 한두 코드가 조용히 빠지고,
 *      그 코드는 실제로 그런 날씨가 오는 날에만 화면에서 드러난다(뇌우·싸락눈은 몇 달에 한 번이다).
 *   2) 접는 규칙이 뜻대로인가 — 어는 비는 비 쪽, 싸락눈·소나기눈은 눈 쪽.
 *   3) 모르는 코드가 와도 그림이 빈칸이 되지 않는다.
 *      Open-Meteo가 코드를 늘려도 화면은 서 있어야 한다.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { WEATHER_CODE_LABEL_KO, WEATHER_ICON_NAMES, weatherIconFor } from '../src/lib/weather-codes'

function everyLabelledCodeHasAnIcon() {
  const codes = Object.keys(WEATHER_CODE_LABEL_KO).map(Number)
  assert.equal(codes.length, 28, 'WMO 라벨은 28개다 — 늘었다면 아이콘 매핑도 같이 봐야 한다')

  const missing = codes.filter((code) => !WEATHER_ICON_NAMES.includes(weatherIconFor(code)))
  assert.deepEqual(missing, [], `아이콘이 없는 코드: ${missing.join(', ')}`)
}

function foldingRules() {
  // 맑음 쪽
  assert.equal(weatherIconFor(0), 'sun', '맑음')
  assert.equal(weatherIconFor(1), 'sun', '대체로 맑음')

  // 구름 쪽 — 2 '구름 조금'부터는 해가 아니라 구름이다.
  assert.equal(weatherIconFor(2), 'cloud', '구름 조금')
  assert.equal(weatherIconFor(3), 'cloud', '흐림')

  // 안개
  assert.equal(weatherIconFor(45), 'fog', '안개')
  assert.equal(weatherIconFor(48), 'fog', '서리 안개')

  // 비 쪽 — 이슬비·비·소나기가 한 그림으로 접힌다.
  assert.equal(weatherIconFor(51), 'rain', '이슬비')
  assert.equal(weatherIconFor(61), 'rain', '비')
  assert.equal(weatherIconFor(80), 'rain', '소나기')
  // 어는 비/이슬비는 떨어질 때 액체라 비 쪽이다. 눈으로 보내면 화면이 거짓말을 한다.
  assert.equal(weatherIconFor(56), 'rain', '어는 이슬비')
  assert.equal(weatherIconFor(66), 'rain', '어는 비')

  // 눈 쪽
  assert.equal(weatherIconFor(71), 'snow', '눈')
  assert.equal(weatherIconFor(77), 'snow', '싸락눈')
  assert.equal(weatherIconFor(85), 'snow', '소나기눈')

  // 번개 — 우박을 동반해도 회장이 알아야 하는 것은 뇌우다.
  assert.equal(weatherIconFor(95), 'thunder', '뇌우')
  assert.equal(weatherIconFor(99), 'thunder', '뇌우(강한 우박)')
}

function unknownCodeStillDraws() {
  // Open-Meteo가 코드를 늘리거나 응답이 이상해도 빈칸이 되지 않는다.
  assert.ok(WEATHER_ICON_NAMES.includes(weatherIconFor(999)))
  assert.ok(WEATHER_ICON_NAMES.includes(weatherIconFor(-1)))
  // 라벨 쪽은 이미 '알 수 없음'으로 떨어진다. 그림도 같은 자리를 지켜야 한다.
  assert.equal(WEATHER_CODE_LABEL_KO[999], undefined)
}

/**
 * weather-codes.ts는 아무것도 import하지 않아야 한다.
 *
 * 이 칸이 있는 이유는 실제로 한 번 깨졌기 때문이다. 'use client'인 weather-panel.tsx가
 * lib/weather.ts에서 값 하나(weatherIconFor)를 가져오자 그 파일이 지나는 lib/geo.ts →
 * next/headers가 브라우저 번들로 끌려 들어가 빌드가 통째로 실패했다.
 *
 * **typecheck도 lint도 이걸 못 잡는다.** next build만 잡는다 — 그래서 여기 둔다.
 * 순수 어휘 모듈에 import가 하나라도 생기면 그 모듈은 더 이상 순수하지 않고,
 * 같은 함정이 조용히 돌아온다.
 */
function read(relative: string): string {
  return readFileSync(new URL(`../src/${relative}`, import.meta.url), 'utf8')
}

function importLines(source: string): string[] {
  return source
    .split('\n')
    .filter((line) => /^\s*import[\s{*'"]/.test(line) || /^\s*export\s+.*\bfrom\b/.test(line))
}

function vocabularyStaysImportFree() {
  // 순수 어휘 모듈 둘. 서버에 닿는 것을 하나라도 들이면 그 순간 클라이언트가 못 쓴다.
  for (const pure of ['lib/weather-codes.ts', 'lib/cities.ts']) {
    const imports = importLines(read(pure))
    assert.deepEqual(imports, [], `${pure}는 import가 없어야 한다. 생긴 줄: ${imports.join(' | ')}`)
  }

  // geo.ts는 서버 전용으로 봉해 둔다. 이 한 줄이 없으면 클라이언트가 끌어다 써도
  // 빌드가 'next/headers를 Pages Router에서 쓴다'는 엉뚱한 말로만 알려 준다.
  assert.ok(
    /^import 'server-only'$/m.test(read('lib/geo.ts')),
    "geo.ts 맨 위의 import 'server-only'가 사라졌다",
  )

  // weather.ts는 geo.ts를 몰라야 한다. 알면 날씨를 쓰는 모든 클라이언트가 서버 모듈에 걸린다 —
  // 이 저장소에서 실제로 빌드를 깨뜨린 경로가 정확히 이것이다.
  assert.ok(
    !read('lib/weather.ts').includes("@/lib/geo"),
    'weather.ts가 다시 geo.ts를 import한다 — 좌표 어휘는 lib/cities.ts에서 가져온다',
  )
}

everyLabelledCodeHasAnIcon()
foldingRules()
unknownCodeStillDraws()
vocabularyStaysImportFree()

console.log('PASS: WMO 28개 코드 전부 아이콘 보유, 어는 비→비 / 싸락눈→눈, 미지의 코드도 그려진다, 어휘 모듈 import 없음')
