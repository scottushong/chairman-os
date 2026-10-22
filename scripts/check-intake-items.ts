/**
 * 0089 «받을 것»(owner_inputs) 검사 — DB · 네트워크 · AI 없음: npm run check:intake-items
 * (DB 문 자체 — 대표만 · Vault · 모양 — 는 check:migrations의 check-finance-mapping-db.ts 6절이 PGlite로 잰다.)
 *
 *   1) 모양 검사(checkServiceAccount = 0089 owner_input_google_sa_save와 같은 규칙): 가짜 키 통과 · 깨진 JSON · type · private_key 없음 · 이메일 · 프로젝트 · 크기.
 *      실패는 낱말만 — 본문 조각이 돌아오지 않는다.
 *   2) dummy 저장소(= 0089 거울): 대표만 적고 읽는다 · 직원 거부 · 직원에게 0줄 · 모양 · 원가 권한 줄 먼저 · 구글 키 본문은 저장 · 응답에 없다 ·
 *      잘못된 JSON 거부(오류에 본문 없음) · 스위치를 끄면 대표도 거부.
 *   3) 문장: 오류 낱말 → 사람 말(본문 · DB 원문 없음) · 로그 낱말.
 *   4) 평가방법 비교: 총평균 = 월 가중평균 · 이동평균 · 선입선출은 경고 · 명세서 그대로는 같음.
 *   5) AI 안 부름(정적): «받을 것» 파일 · 진짜 BOM 넣기 길이 AI 모듈을 import하지 않는다 · 액션 로그에 파일 · 본문 변수가 없다.
 *   6) 화면: /settings는 대표 · 스위치일 때만 카드를 읽고 그린다(직원에게 안 보임) · 기능 스위치 기본 대표만.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

process.env.NEXT_PUBLIC_DATA_MODE = 'dummy'
process.env.NEXT_PUBLIC_SUPABASE_URL = ''
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ''
delete process.env.DUMMY_OWNER_INPUTS

let passed = 0
const ok = async (name: string, fn: () => void | Promise<void>) => {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}
const ROOT = join(__dirname, '..')
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/** 진짜처럼 보이지 않는 가짜 키(FAKE). */
const FAKE = {
  type: 'service_account',
  project_id: 'fake-project-0089',
  private_key_id: 'FAKE0089',
  private_key: '-----BEGIN FAKE KEY-----\nFAKE-NOT-A-REAL-KEY-0089-DO-NOT-USE\n-----END FAKE KEY-----\n',
  client_email: 'fake-reader@fake-project-0089.iam.gserviceaccount.com',
}
const SECRET = /FAKE-NOT-A-REAL-KEY|private_key|BEGIN FAKE/

async function rejects(p: Promise<unknown>, word: RegExp, msg: string): Promise<string> {
  try {
    await p
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    assert.match(m, word, msg)
    return m
  }
  assert.fail(`${msg} — 거부하지 않았다`)
}

async function main() {
  const L = await import('../src/lib/owner-inputs')
  const { dummyRepository } = await import('../src/lib/repository/dummy')
  const { resetDummyOwnerInputs } = await import('../src/lib/repository/dummy-owner-inputs')
  const { DUMMY_UID } = await import('../src/lib/repository/dummy-org')
  const { FEATURES } = await import('../src/lib/features')

  console.log('모양 검사')
  await ok('가짜 키 통과 — 돌려주는 것은 이메일 · 프로젝트 id뿐', () => {
    const r = L.checkServiceAccount(JSON.stringify(FAKE))
    assert.deepEqual(r, { ok: true, summary: { client_email: FAKE.client_email, project_id: FAKE.project_id } })
    assert.doesNotMatch(JSON.stringify(r), SECRET)
  })
  await ok('깨진 JSON · type · private_key 없음 · 이메일 · 프로젝트 · 크기 거부 — 낱말만(본문 조각 없음)', () => {
    const { private_key: _k, ...noKey } = FAKE
    void _k
    const cases: [string, string][] = [
      [`{"type":"service_account","private_key":"FAKE-NOT-A-REAL-KEY-${'x'.repeat(40)}"`, 'sa_json'],
      ['[' + JSON.stringify(FAKE) + ']', 'sa_json'],
      [JSON.stringify({ ...FAKE, type: 'authorized_user' }), 'sa_type'],
      [JSON.stringify(noKey), 'sa_key'],
      [JSON.stringify({ ...FAKE, client_email: 'someone@gmail.com' }), 'sa_email'],
      [JSON.stringify({ ...FAKE, project_id: 'Bad Project!' }), 'sa_project'],
      ['{}', 'sa_size'],
      [JSON.stringify({ ...FAKE, pad: 'x'.repeat(L.SA_MAX_BYTES) }), 'sa_size'],
    ]
    for (const [text, want] of cases) {
      const r = L.checkServiceAccount(text)
      assert.deepEqual(r, { ok: false, error: want }, want)
      assert.doesNotMatch(JSON.stringify(r), SECRET)
    }
  })

  console.log('dummy 저장소(0089 거울)')
  resetDummyOwnerInputs()
  const as = (who: string) => {
    process.env.DUMMY_USER = who
  }
  await ok('직원(영업 직원 · DY 대표) — 적기 · 구글 올리기 거부 · 읽기 0줄', async () => {
    for (const who of ['sales_staff', 'dy_ceo']) {
      as(who)
      await rejects(dummyRepository.markOwnerInput('inventory_method', 'biz_dy', { method: 'fifo' }), /owner_input_denied/, `${who}가 적었다`)
      await rejects(dummyRepository.saveGoogleServiceAccount(JSON.stringify(FAKE)), /owner_input_denied/, `${who}가 구글 키를 올렸다`)
      assert.deepEqual(await dummyRepository.listOwnerInputs(), [], `${who}가 받을 것을 읽었다`)
    }
  })
  await ok('대표 — 재고평가방법 · 진짜 BOM 받음 · 바꾸기 · 모양 거부', async () => {
    as('chairman')
    await dummyRepository.markOwnerInput('inventory_method', 'biz_dy', { method: 'total_avg', memo: '세무사 확인(가짜)' })
    await dummyRepository.markOwnerInput('inventory_method', 'biz_dy', { method: 'moving_avg' })
    await dummyRepository.markOwnerInput('real_bom', 'biz_dy', { rows: 3 })
    const rows = (await dummyRepository.listOwnerInputs())!
    const inv = rows.find((r) => r.item_key === 'inventory_method')!
    assert.deepEqual(inv.summary, { method: 'moving_avg' })
    assert.equal(inv.received_by, DUMMY_UID.chair)
    for (const [item, scope, summary] of [
      ['inventory_method', 'biz_dy', { method: 'lifo' }],
      ['inventory_method', 'biz_dy', { method: 'fifo', memo: '가'.repeat(501) }],
      ['inventory_method', 'biz_nope', { method: 'fifo' }],
      ['real_bom', 'biz_dy', { rows: -1 }],
      ['real_bom', 'biz_dy', { rows: 1, file: 'x' }],
      ['google_sa', 'group', { client_email: 'x' }],
    ] as const) {
      await rejects(dummyRepository.markOwnerInput(item as 'real_bom', scope, summary as Record<string, unknown>), /owner_input_shape/, `${item} ${JSON.stringify(summary)}`)
    }
  })
  await ok('원가 관리 권한자 — 원가 권한 줄이 먼저 · 준 뒤에 적힌다', async () => {
    as('chairman')
    const people = await dummyRepository.listUserAccounts()
    const target = people.find((p) => p.role === 'Member' && p.business_ids.includes('biz_dy') && !p.modules.some((m) => m.module === '/costing/biz_dy'))!
    assert.ok(target, '시험할 직원이 없다')
    await rejects(dummyRepository.markOwnerInput('cost_manager', 'biz_dy', { user_id: target.user_id }), /owner_input_no_grant/, '원가 권한 없이 적었다')
    await dummyRepository.setModuleGrant(target.user_id, { module: '/costing/biz_dy', can_write: true, can_approve: false }, { user_id: DUMMY_UID.chair, role: 'Chairman' })
    await dummyRepository.markOwnerInput('cost_manager', 'biz_dy', { user_id: target.user_id })
    await dummyRepository.setModuleGrant(target.user_id, { module: '/costing/biz_dy', can_write: false, can_approve: false }, { user_id: DUMMY_UID.chair, role: 'Chairman' })
  })
  await ok('구글 서비스 계정 — 가짜 키 저장 · 응답 · 줄에 본문 없음 · 잘못된 JSON 거부(오류에 본문 없음)', async () => {
    as('chairman')
    const r = await dummyRepository.saveGoogleServiceAccount(JSON.stringify(FAKE))
    assert.deepEqual(r, { client_email: FAKE.client_email, project_id: FAKE.project_id })
    const all = JSON.stringify(await dummyRepository.listOwnerInputs())
    assert.doesNotMatch(all, SECRET, '받을 것 줄에 키 본문이 있다')
    assert.match(all, /fake-reader@fake-project-0089/)
    const m = await rejects(dummyRepository.saveGoogleServiceAccount(`{"type":"service_account","private_key":"FAKE-NOT-A-REAL-KEY-${'y'.repeat(40)}"`), /owner_input_sa_shape/, '깨진 JSON을 받았다')
    assert.doesNotMatch(m, SECRET, '오류에 본문이 실렸다')
    await rejects(dummyRepository.saveGoogleServiceAccount(JSON.stringify({ ...FAKE, type: 'user' })), /owner_input_sa_shape/, 'type이 다른 JSON을 받았다')
    const g = globalThis as { __dummyOwnerInputs?: unknown }
    assert.doesNotMatch(JSON.stringify(g.__dummyOwnerInputs), SECRET, 'dummy 저장소에 키 본문이 남았다')
  })
  await ok('스위치를 끄면 대표도 거부 · 0줄', async () => {
    as('chairman')
    await dummyRepository.setFeatureSwitch({ feature_key: 'owner_inputs', business_id: null, enabled: false, audience: 'chairman', reason: '검사 — 끄기' })
    await rejects(dummyRepository.markOwnerInput('real_bom', 'biz_dy', { rows: 1 }), /owner_input_denied/, '끈 뒤에 적었다')
    assert.deepEqual(await dummyRepository.listOwnerInputs(), [])
    await dummyRepository.setFeatureSwitch({ feature_key: 'owner_inputs', business_id: null, enabled: true, audience: 'chairman', reason: '검사 — 다시 켜기' })
    assert.equal((await dummyRepository.listOwnerInputs())!.length, 4)
  })

  console.log('문장 · 평가방법')
  await ok('오류 낱말 → 사람 말(DB 원문 · 본문 없음) · 로그 낱말', () => {
    const e = new Error('owner_input_sa_shape: FAKE-NOT-A-REAL-KEY detail')
    assert.equal(L.ownerInputMessage(e), L.OWNER_INPUT_ERROR.owner_input_sa_shape)
    assert.equal(L.ownerInputLogWord(e), 'owner_input_sa_shape')
    assert.equal(L.ownerInputLogWord(new Error('Supabase … FAKE-NOT-A-REAL-KEY')), 'failed')
    assert.equal(L.ownerInputMessage(new Error('new row violates … cost_costing_cap')), L.OWNER_INPUT_ERROR.cost_costing_cap)
    for (const t of Object.values(L.OWNER_INPUT_ERROR)) assert.doesNotMatch(t, /회장|Chairman/)
  })
  await ok('세무사 방법 vs 월별 손익 설정 — 총평균 = 월 가중평균 · 이동평균 · 선입선출 경고 · 명세서 그대로 같음 · 못 읽음 모름', () => {
    assert.equal(L.methodAgreement('total_avg', 'monthly_wa'), 'same')
    assert.equal(L.methodAgreement('moving_avg', 'monthly_wa'), 'differs')
    assert.equal(L.methodAgreement('fifo', 'monthly_wa'), 'differs')
    assert.equal(L.methodAgreement('fifo', 'statement'), 'same')
    assert.equal(L.methodAgreement('fifo', null), 'unknown')
  })

  console.log('AI 안 부름 · 본문 안 찍힘(정적)')
  const ownerFiles = [
    'src/lib/owner-inputs/index.ts',
    'src/app/actions/owner-inputs.ts',
    'src/components/settings/owner-inputs.tsx',
    'src/lib/repository/dummy-owner-inputs.ts',
    'src/lib/repository/supabase-owner-inputs.ts',
  ]
  const bomPath = ['src/app/actions/cost-import.ts', 'src/lib/cost-import/workbook.ts', 'src/lib/cost-import/plan.ts', 'src/lib/cost-import/spec.ts', 'src/lib/cost-import/values.ts', 'src/lib/cost-import/payload.ts', 'src/lib/cost-import/types.ts']
  const AI_IMPORT = /from ['"](@\/lib\/ai[^'"]*|@anthropic-ai\/[^'"]*|openai|@\/lib\/finance-upload\/ai[^'"]*|@\/lib\/attachments\/summarize[^'"]*|@\/lib\/intake\/(read|proposal)[^'"]*|@\/app\/actions\/(assistant|intake|finance-upload)[^'"]*)['"]/
  await ok('«받을 것» 파일 · 진짜 BOM 넣기 길이 AI 모듈을 import하지 않는다', () => {
    for (const f of [...ownerFiles, ...bomPath]) assert.doesNotMatch(src(f), AI_IMPORT, f)
    for (const f of ownerFiles) assert.doesNotMatch(src(f), /anthropic|messages\.create|callClaude|askAi/i, f)
  })
  await ok('액션 로그 · 오류에 파일 · 본문 변수가 없다(낱말만)', () => {
    const a = src('src/app/actions/owner-inputs.ts')
    const logs = [...a.matchAll(/console\.[a-z]+\(([^\n]*)\)/g)].map((m) => m[1])
    assert.ok(logs.length >= 3)
    for (const l of logs) assert.doesNotMatch(l, /\b(text|json|file|form|input)\b(?!\.)/, l)
    const s = src('src/lib/repository/supabase-owner-inputs.ts')
    assert.doesNotMatch(s, /error\.(details|hint)|\$\{error\.message\}/, 'DB 원문(DETAIL · 메시지)을 옮긴다')
    const sql = src('supabase/migrations/0089_finance_mapping.sql')
    const fn = sql.slice(sql.indexOf('create or replace function owner_input_google_sa_save'), sql.indexOf('revoke all on function owner_input_mark'))
    assert.doesNotMatch(fn, /raise (notice|warning|info|log)/, '정의자 함수가 notice를 낸다')
    assert.doesNotMatch(fn, /raise exception '[^']*%/, '오류 문장에 값을 끼운다')
    assert.match(fn, /exception when others then\s+v := null;/, 'JSON 해석 오류를 삼키지 않는다')
  })

  console.log('화면 · 스위치')
  await ok('/settings — 대표 · 스위치일 때만 읽고 그린다 · 직원 화면에 없음', () => {
    const page = src('src/app/(dashboard)/settings/page.tsx')
    assert.match(page, /const owner = isChairman && ownerOn \? await loadOwnerInputs\(repo\) : null/)
    assert.match(page, /\{owner \? \(/)
    assert.match(page, /isChairman = canEditChairmanRoutine\(user\)/)
    const card = src('src/components/settings/owner-inputs.tsx')
    assert.doesNotMatch(card, /회장|Chairman/, '카드 문구에 «회장»')
  })
  await ok('기능 스위치 owner_inputs — 기본 대표만', () => {
    const f = FEATURES.find((x) => x.key === 'owner_inputs')
    assert.equal(f?.defaultAudience, 'chairman')
  })

  console.log(`PASS: ${passed} intake-items checks (모양 · 대표만 · 직원 거부 · 직원 0줄 · 원가 권한 먼저 · 구글 키 본문 저장 · 응답 · 오류에 없음 · 잘못된 JSON 거부 · 스위치 · 문장 · 평가방법 비교 · AI import 없음 · 로그 낱말만 · 화면 대표만)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
