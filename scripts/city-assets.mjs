/**
 * 그룹 시티 배경 이미지 만들기 (Phase 8 블록 G-1): npm run city:assets
 *
 * 회장이 `public/city/`에 넣은 원본 PNG는 한 장에 9~10MB다(2752×1536 · 2400×1792).
 * 그대로 두면 두 가지가 동시에 나빠진다.
 *
 *   · 폰에서 60fps로 그릴 화면의 첫 그림이 10MB다. 배경 한 장에 10초를 쓰면
 *     그 위에 올리는 캐릭터가 아무리 가벼워도 «빠른 화면»이 되지 않는다.
 *   · 일곱 장이 67MB다. 저장소에 넣으면 clone·배포마다 그 무게가 따라다닌다.
 *
 * 그래서 **원본은 git에 넣지 않고**(.gitignore `/public/city/*.png`) 여기서 만든
 * `public/city/gen/*.webp`만 커밋한다. 화면은 gen/만 본다 — 원본이 없는 머신에서도,
 * 배포에서도 같은 그림이 선다.
 *
 * **원본은 회장의 머신에만 있다.** 지우지 않는다(CLAUDE.md의 «되돌릴 수 없는 삭제»),
 * 다시 만들 일이 생기면 원본을 같은 자리에 두고 이 스크립트를 다시 돌린다.
 *
 * 단계 이미지(foundation/frame/finishing/lot)는 도시 전체가 그려진 한 장이라
 * 핫스팟 위에 겹쳐 놓을 수 있는 조각이 아니다. 그래서 **그 장의 주인공만 잘라**
 * 우측 패널의 클로즈업으로 쓴다 — 잘라 내는 자리(STAGE_CROP)가 이 파일의 유일한 판단이다.
 */
import { mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import sharp from 'sharp'

const SRC = 'public/city'
const OUT = 'public/city/gen'

/** 전경. 폭 셋을 만든다 — 폰(1280) · 노트북(1920) · 원본 폭(2752). */
const BACKGROUNDS = [
  { src: 'city-day.png', name: 'day' },
  { src: 'city-dusk.png', name: 'dusk' },
]
const WIDTHS = [1280, 1920, 2752]

/**
 * 단계 이미지에서 «그 장이 말하는 것»이 있는 자리. 0~1 비율이다(좌·상·폭·높이).
 * 눈으로 재서 넣었다. 원본이 바뀌면 여기도 같이 본다.
 */
const STAGE_CROP = {
  'stage-foundation.png': { name: 'foundation', left: 0.2, top: 0.36, width: 0.6, height: 0.6 },
  'stage-frame.png': { name: 'frame', left: 0.45, top: 0.0, width: 0.5, height: 0.95 },
  'stage-finishing.png': { name: 'finishing', left: 0.46, top: 0.03, width: 0.5, height: 0.92 },
  'lot.png': { name: 'lot', left: 0.42, top: 0.5, width: 0.48, height: 0.5 },
}
/**
 * 5개사 클로즈업. 한 장(`dy,vana, sticky, hof, boram.png`)에 다섯 건물이 다 있고 영문 라벨이
 * 그림에 박혀 있어서, **라벨을 피해** 건물만 잘라 낸다. 파일 이름은 business_id의 꼬리다
 * (biz_dy → company-dy) — 화면은 lib/city.ts의 COMPANY_CLOSEUP으로 이 이름을 찾는다.
 *
 * Boram은 원본에 라벨이 없다(HOF 라벨이 두 번 찍혀 있다). 오른쪽 아래 계단식 건물을
 * Boram으로 읽었다 — 넷이 라벨로 자리를 차지하고 남은 주인공 건물이 그것뿐이다.
 */
const COMPANY_SRC = 'dy,vana, sticky, hof, boram.png'
const COMPANY_CROP = {
  dy: { left: 0.13, top: 0.35, width: 0.3, height: 0.26 },
  vana: { left: 0.36, top: 0.04, width: 0.14, height: 0.42 },
  sticky: { left: 0.6, top: 0.15, width: 0.23, height: 0.35 },
  hof: { left: 0.5, top: 0.592, width: 0.23, height: 0.19 },
  boram: { left: 0.77, top: 0.62, width: 0.19, height: 0.24 },
}

const CLOSEUP_WIDTH = 900

const kb = (p) => `${Math.round(statSync(p).size / 1024)}KB`

async function backgrounds() {
  for (const bg of BACKGROUNDS) {
    const src = join(SRC, bg.src)
    for (const width of WIDTHS) {
      const out = join(OUT, `${bg.name}-${width}.webp`)
      await sharp(src).resize({ width }).webp({ quality: 78, effort: 6 }).toFile(out)
      console.log(`${out}  ${kb(out)}`)
    }
  }
}

/**
 * 한 장에서 비율 상자 하나를 잘라 CLOSEUP_WIDTH로 맞춘다. 상자가 그보다 좁으면
 * 늘리지 않는다 — VANA 탑은 원본에서 폭이 340px 남짓이라 900으로 늘리면 뭉개진다.
 */
async function crop(src, box, out) {
  const meta = await sharp(src).metadata()
  await sharp(src)
    .extract({
      left: Math.round(meta.width * box.left),
      top: Math.round(meta.height * box.top),
      width: Math.round(meta.width * box.width),
      height: Math.round(meta.height * box.height),
    })
    .resize({ width: CLOSEUP_WIDTH, withoutEnlargement: true })
    .webp({ quality: 80, effort: 6 })
    .toFile(out)
  console.log(`${out}  ${kb(out)}`)
}

async function closeups() {
  for (const [file, box] of Object.entries(STAGE_CROP)) {
    await crop(join(SRC, file), box, join(OUT, `stage-${box.name}.webp`))
  }
}

async function companies() {
  for (const [name, box] of Object.entries(COMPANY_CROP)) {
    await crop(join(SRC, COMPANY_SRC), box, join(OUT, `company-${name}.webp`))
  }
}

const missing = [...BACKGROUNDS.map((b) => b.src), ...Object.keys(STAGE_CROP), COMPANY_SRC].filter(
  (f) => !readdirSync(SRC).includes(f),
)
if (missing.length > 0) {
  // 원본이 없는 머신에서도 이 스크립트를 돌릴 일이 있다(clone 직후). 만들지 못한다고
  // 분명히 말하고 멈춘다 — 이미 있는 gen/은 건드리지 않는다.
  console.error(`원본이 없다: ${missing.join(', ')} — public/city/에 원본 PNG를 두고 다시 돌린다.`)
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })
await backgrounds()
await closeups()
await companies()
