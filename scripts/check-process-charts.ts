/**
 * Phase 5-D 프로세스차트 링크 검증 (오프라인, 네트워크 없음): npm run check:process-charts
 *
 * 무엇을 재나
 *   1) **편집 링크가 막히는가.** 이 스크립트의 요점이다 — 편집 링크를 대시보드 iframe에
 *      걸면 화면을 보는 사람이 그대로 시트를 고칠 수 있게 된다. 겉모습이 게시 링크와
 *      비슷해서 눈으로는 잘 구분되지 않는다.
 *   2) 화면의 정규식과 **0021의 check 제약이 같은 모양**인가. 한쪽만 고치면
 *      화면이 받은 값을 DB가 거부하거나(사용자는 이유를 모른다) 그 반대가 된다.
 *   3) CSP frame-src의 출처와 코드가 쓰는 출처가 같은가. 다르면 iframe이 조용히 빈칸이 된다.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  EMBED_ORIGIN,
  EMBED_PROBLEM_KO,
  PUBHTML_PATTERN,
  embedProblem,
  embedSrc,
} from '../src/lib/process-chart'

const PUBLISHED =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQyRIlUseLHMSeJT0Tr8HvnL0MmHpE8IeR0zx4AvVhJc5HJkcRZ_rzxy14l6pssZHdvXsRceC3mZPi5/pubhtml'

function acceptsPublishedLinks() {
  assert.equal(embedProblem(PUBLISHED), null)
  // 시드에 넣은 두 번째 링크도 통과해야 한다.
  assert.equal(
    embedProblem(
      'https://docs.google.com/spreadsheets/d/e/2PACX-1vTR5jxnGGpYiiu-GBVI-45HmeRSbcKV5XzzD15NsxrwrWPaxJAPuSTQAuf6t1psQPg96ECH-p6TARRs/pubhtml',
    ),
    null,
  )
  // 게시 링크에 붙는 쿼리(gid 등)가 있어도 받는다.
  assert.equal(embedProblem(`${PUBLISHED}?gid=0&single=true`), null)
  // 앞뒤 공백은 다듬는다 — 복사하면 흔히 붙는다.
  assert.equal(embedProblem(`  ${PUBLISHED}  `), null)
}

function refusesEverythingElse() {
  assert.equal(embedProblem(''), 'empty')
  assert.equal(embedProblem('   '), 'empty')

  // **편집 링크.** 가장 위험한 입력이라 따로 집어낸다.
  assert.equal(
    embedProblem('https://docs.google.com/spreadsheets/d/1AbC_dEfGh123/edit#gid=0'),
    'edit_link',
  )
  assert.equal(
    embedProblem('https://docs.google.com/spreadsheets/d/1AbC_dEfGh123/view'),
    'edit_link',
  )

  // 구글 시트가 아닌 주소. 다른 도메인을 iframe에 걸 길을 남기지 않는다.
  assert.equal(embedProblem('https://example.com/sheet/pubhtml'), 'not_google_sheets')
  assert.equal(embedProblem('https://docs.google.com.evil.test/spreadsheets/d/e/x/pubhtml'), 'not_google_sheets')
  assert.equal(embedProblem('https://docs.google.com/document/d/e/2PACX-1vX/pub'), 'not_google_sheets')
  // http는 받지 않는다.
  assert.equal(embedProblem(PUBLISHED.replace('https://', 'http://')), 'not_google_sheets')

  // 시트지만 게시가 아닌 것.
  assert.equal(embedProblem('https://docs.google.com/spreadsheets/d/e/2PACX-1vX/'), 'not_published')

  // 안내 문장이 모든 낱말에 있다 — 낱말만 던지면 화면이 무엇을 보여 줄지 모른다.
  for (const problem of ['empty', 'not_google_sheets', 'edit_link', 'not_published'] as const) {
    assert.ok(EMBED_PROBLEM_KO[problem].length > 0)
  }
}

/**
 * 화면과 DB가 같은 모양을 받아야 한다.
 * 0021의 check 제약 문자열을 직접 읽어 비교한다 — 주석으로 '같아야 한다'고 적는 것으로는
 * 한쪽만 고치는 일을 못 막는다.
 */
function screenAndDatabaseAgree() {
  const sql = readFileSync(new URL('../supabase/migrations/0021_process_charts.sql', import.meta.url), 'utf8')
  const constraint = sql.match(/embed_url ~ '([^']+)'/)?.[1]
  assert.ok(constraint, '0021에서 embed_url check 제약을 찾지 못했다')

  // 두 곳의 표기 차이만 걷어내고 비교한다. 같은 정규식인데 적는 법이 다르다:
  //   SQL 문자열은 백슬래시를 한 번 더 쓰지 않고,
  //   JS 정규식 리터럴은 슬래시를 \/ 로 이스케이프해야 한다.
  const normalize = (re: string) => re.split('\\/').join('/')
  const fromSql = normalize(constraint)
  const fromCode = normalize(PUBHTML_PATTERN.source)
  assert.equal(
    fromSql,
    fromCode,
    `화면(${fromCode})과 0021(${fromSql})의 링크 규칙이 다르다 — 한쪽만 고쳤다`,
  )
}

function cspMatchesTheOrigin() {
  const config = readFileSync(new URL('../next.config.ts', import.meta.url), 'utf8')
  assert.ok(
    config.includes(`frame-src 'self' ${EMBED_ORIGIN}`),
    `next.config.ts의 CSP frame-src가 ${EMBED_ORIGIN}을 담고 있어야 한다 — 없으면 iframe이 조용히 빈칸이 된다`,
  )
}

function embedSrcAddsWidgetParams() {
  assert.equal(embedSrc(PUBLISHED), `${PUBLISHED}?widget=true&headers=false`)
  // 이미 쿼리가 있으면 &로 잇는다. ?를 두 번 쓰면 구글이 주소를 못 읽는다.
  assert.equal(
    embedSrc(`${PUBLISHED}?gid=0`),
    `${PUBLISHED}?gid=0&widget=true&headers=false`,
  )
}

acceptsPublishedLinks()
refusesEverythingElse()
screenAndDatabaseAgree()
cspMatchesTheOrigin()
embedSrcAddsWidgetParams()

console.log(
  'PASS: 게시 링크만 통과, 편집 링크 차단, 화면 규칙 = 0021 check 제약, CSP frame-src 일치',
)
