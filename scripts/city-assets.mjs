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

async function closeups() {
  for (const [file, crop] of Object.entries(STAGE_CROP)) {
    const src = join(SRC, file)
    const meta = await sharp(src).metadata()
    const out = join(OUT, `stage-${crop.name}.webp`)
    await sharp(src)
      .extract({
        left: Math.round(meta.width * crop.left),
        top: Math.round(meta.height * crop.top),
        width: Math.round(meta.width * crop.width),
        height: Math.round(meta.height * crop.height),
      })
      .resize({ width: CLOSEUP_WIDTH })
      .webp({ quality: 80, effort: 6 })
      .toFile(out)
    console.log(`${out}  ${kb(out)}`)
  }
}

const missing = [...BACKGROUNDS.map((b) => b.src), ...Object.keys(STAGE_CROP)].filter(
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
