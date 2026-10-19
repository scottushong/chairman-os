/**
 * 스크린숏 두 장 비교 — 크기 · 픽셀이 다른 비율(채널 차이 > 24)과 다른 곳의 세로 범위(위에서 몇 px).
 *   npx tsx scripts/diff-shots.ts <a.png> <b.png>
 */
import sharp from 'sharp'

async function main() {
  const [a, b] = process.argv.slice(2)
  const [A, B] = await Promise.all([a, b].map((p) => sharp(p).raw().ensureAlpha().toBuffer({ resolveWithObject: true })))
  console.log(`크기 ${A.info.width}x${A.info.height} vs ${B.info.width}x${B.info.height}`)
  const w = Math.min(A.info.width, B.info.width)
  const h = Math.min(A.info.height, B.info.height)
  let diff = 0
  const rows = new Set<number>()
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * A.info.width + x) * 4
      const j = (y * B.info.width + x) * 4
      if (Math.abs(A.data[i] - B.data[j]) > 24 || Math.abs(A.data[i + 1] - B.data[j + 1]) > 24 || Math.abs(A.data[i + 2] - B.data[j + 2]) > 24) {
        diff += 1
        rows.add(Math.floor(y / 50) * 50)
      }
    }
  }
  console.log(`다른 픽셀 ${diff} / ${w * h} = ${((diff / (w * h)) * 100).toFixed(3)}%`)
  console.log(`다른 줄(50px 단위): ${[...rows].sort((p, q) => p - q).slice(0, 40).join(', ')}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
