import Link from 'next/link'

import { RuleEditor } from '@/components/attention/rule-editor'
import { PageHeader } from '@/components/layout/page-header'
import { Icon } from '@/components/ui/icon'
import { recordScreenRead } from '@/lib/activity-record'
import { RULE_UNIT } from '@/lib/attention/brief'
import { MEASURABLE_RULE_KEYS, windowMonths } from '@/lib/attention/rules'
import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'
import { ATTENTION_LEVEL_LABEL_KO } from '@/types'

/**
 * `/attention/rules` — 규칙 13종과 **회장 편집** (Phase 7 블록 B-3 · §18).
 *
 * 원문: *"규칙 임계값은 /attention/rules에서 회장 편집."*
 *
 * ■ 이 표가 답하는 질문 ■ "왜 DY가 yellow인가." 임계를 모르면 그 답을 읽을 수 없어서
 * **읽기는 활성 사용자 전부**다(0035 `exception_rules_read` = `is_active()`). 임계를 아는 것은
 * 그 회사의 매출을 아는 것이 아니다. **쓰기는 Chairman뿐이다** — 잴 대상이 잣대를 고치면
 * 지표가 지표가 아니게 된다.
 *
 * ■ 이 표가 말해야 하는 사실 셋 ■
 *   ① **수동 열 개에는 임계 칸이 없다.** 빈 칸이 아니라 «수동 플래그 규칙»이라고 적는다
 *      (0035의 `kind` 칸이 «설정이 덜 된 규칙»과 «원래 수동인 규칙»을 가르려고 생겼다).
 *   ② **오늘 실제로 잴 수 있는 규칙은 셋뿐이다.** 나머지 열은 원문대로 사람이 세우는
 *      플래그다. 잴 식이 없는데 «자동 감지»인 척하면 회장은 걸리지 않은 것을 «없는 것»으로
 *      읽는다 — `MEASURABLE_RULE_KEYS`가 그 셋을 들고 있고 화면은 그것을 읽는다(여기서
 *      목록을 다시 적지 않는다).
 *   ③ **단위가 규칙마다 다르다**(% · %p · 개월). 0035가 칸을 두지 않고 그 판단을 B-3에
 *      넘겼다 — 코드의 `RULE_UNIT`에서 읽어 값 옆에 적고, 그 표에 없는 규칙에는
 *      «단위 미표기»라고 쓴다(지어내지 않는다). 고른 이유는 `RuleEditor`의 머리 주석과
 *      DEFERRED에 있다.
 *
 * ■ 여기서 고친 임계가 이미 생긴 예외의 색을 바꾸지 않는다 ■ `exceptions.threshold`는
 * 걸린 순간의 값을 **복사해 둔 것**이고, `severity`는 만들어질 때 정해진다(0035).
 * 그 사실을 화면이 적는다 — 적지 않으면 임계를 고친 회장이 어제의 RED가 왜 그대로인지
 * 묻게 된다.
 */
export default async function AttentionRulesPage() {
  await recordScreenRead({ path: '/attention/rules', kind: 'page' })

  const [user, repo] = await Promise.all([currentUser(), getRepository()])
  const rules = await repo.listExceptionRules()
  // 쓰기 **여부**만 가른다 — 판정은 0035의 `exception_rules_write`가 한다.
  // 못 쓰는 사람에게는 편집 칸을 아예 그리지 않는다(눌러도 거부당하는 버튼을 두지 않는다).
  const canWrite = user?.role === 'Chairman'

  const metric = rules.filter((r) => r.kind === 'metric')
  const measurable = metric.filter((r) => MEASURABLE_RULE_KEYS.includes(r.rule_key))
  const disabled = rules.filter((r) => !r.enabled)

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-5">
      <PageHeader
        icon="settings"
        title="주의 규칙 · 임계값"
        code="§18 Trigger Rules"
        description="무엇을 «예외»로 볼 것인지 정하는 잣대입니다. 임계값은 회장님만 고칩니다."
      >
        <Link
          href="/attention"
          className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          주의 목록
        </Link>
      </PageHeader>

      <section className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile
          label="규칙"
          value={`${rules.length}종`}
          note={`수치 자동 ${metric.length} · 수동 플래그 ${rules.length - metric.length}. 목록과 순서는 §18 그대로입니다.`}
        />
        <Tile
          label="오늘 실제로 재는 규칙"
          value={`${measurable.length}종`}
          note="나머지 수치 규칙에는 이 저장소에 잴 식이 없습니다 — «안 걸렸다»가 아니라 «재지 않았다»입니다."
        />
        <Tile
          label="꺼 둔 규칙"
          value={`${disabled.length}종`}
          note={
            disabled.length === 0
              ? '모든 규칙이 켜져 있습니다.'
              : '꺼진 규칙은 야간 Job이 평가하지 않습니다 — 그 회사가 정상이라는 뜻이 아닙니다.'
          }
        />
      </section>

      {!canWrite ? (
        <p className="mt-3 rounded-lg bg-raised px-3 py-2 text-[11px] leading-relaxed text-ink-dim">
          임계값은 회장 계정에서만 고칠 수 있습니다(0035). 이 화면의 값은 그대로 읽을 수
          있습니다 — 임계를 알아야 «왜 이 회사가 yellow인가»를 읽을 수 있기 때문입니다.
        </p>
      ) : null}

      <section className="mt-3 rounded-xl border border-line-soft bg-panel p-3.5">
        <h2 className="mb-2 flex flex-wrap items-baseline gap-1.5 text-[13px] font-semibold">
          <Icon name="clipboard" className="size-4 text-ink-dim" />
          규칙 13종
          <span className="rounded bg-raised px-1.5 py-0.5 text-[9.5px] font-normal text-ink-dim">
            §18 목록 순서
          </span>
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] border-collapse text-[11.5px]">
            <thead>
              <tr className="border-b border-line-soft text-left text-[10.5px] text-ink-dim">
                <th className="py-1.5 pr-3 font-normal">규칙</th>
                <th className="py-1.5 pr-3 font-normal">종류</th>
                <th className="py-1.5 pr-3 font-normal">임계</th>
                <th className="py-1.5 pr-3 font-normal">창</th>
                <th className="py-1.5 pr-3 font-normal">출발 등급</th>
                <th className="py-1.5 font-normal">{canWrite ? '고치기' : '상태'}</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => {
                const unit = RULE_UNIT[r.rule_key] ?? null
                const canMeasure = MEASURABLE_RULE_KEYS.includes(r.rule_key)
                return (
                  <tr key={r.rule_key} className="border-b border-line-soft align-top last:border-0">
                    <td className="py-2 pr-3">
                      <span className="font-semibold text-ink">{r.name}</span>
                      <span className="ml-1.5 text-[10px] text-ink-muted">{r.rule_key}</span>
                      {!r.enabled ? (
                        <span className="ml-1.5 rounded bg-raised px-1.5 py-0.5 text-[9.5px] text-ink-dim">
                          꺼짐
                        </span>
                      ) : null}
                      {/* 수치 규칙인데 잴 식이 없는 경우. «안 걸렸다»로 읽히면 안 된다. */}
                      {r.kind === 'metric' && !canMeasure ? (
                        <span className="block text-[10px] leading-relaxed text-warning">
                          이 저장소에 잴 식이 없습니다 — 야간 Job이 이 규칙을 평가하지 않습니다.
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-[10.5px] text-ink-dim">
                      {r.kind === 'metric' ? '수치 자동' : '수동 플래그'}
                      {r.metric ? (
                        <span className="block text-[10px] text-ink-muted">{r.metric}</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 tnum">
                      {/* ① 빈 칸을 그리지 않는다. 수동 규칙에는 임계가 «없다». */}
                      {r.threshold === null ? (
                        <span className="text-[10.5px] text-ink-muted">
                          없음 (수동 플래그 규칙)
                        </span>
                      ) : (
                        <>
                          <span className="font-semibold text-ink">
                            {r.comparator} {r.threshold}
                            {/* ③ 단위는 코드의 RULE_UNIT에서 온다. 없으면 지어내지 않는다. */}
                            {unit ? <span className="ml-0.5 text-[10px] text-ink-dim">{unit}</span> : null}
                          </span>
                          {!unit ? (
                            <span className="block text-[10px] text-ink-muted">단위 미표기</span>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td className="py-2 pr-3 tnum">
                      {r.window_days === null ? (
                        <span className="text-[10.5px] text-ink-muted">없음</span>
                      ) : (
                        <>
                          <span className="text-ink">{r.window_days}일</span>
                          <span className="block text-[10px] text-ink-muted">
                            실제 {windowMonths(r.window_days)}개월로 접힘
                          </span>
                        </>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-[10.5px] text-ink-dim">
                      {r.severity_base} · {ATTENTION_LEVEL_LABEL_KO[r.severity_base]}
                    </td>
                    <td className="py-2">
                      {canWrite ? (
                        <RuleEditor rule={r} />
                      ) : (
                        <span className="text-[10.5px] text-ink-muted">
                          {r.enabled ? '켜짐' : '꺼짐'}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-3 space-y-1.5 rounded-xl border border-line-soft bg-panel p-3.5 text-[10.5px] leading-relaxed text-ink-muted">
        <p>
          <b className="text-ink-dim">지난 예외의 색은 바뀌지 않습니다.</b> 예외에는 걸린 순간의
          임계가 복사돼 있고 등급도 그때 정해집니다 — 여기서 임계를 고치면 <b>다음 밤부터</b>{' '}
          달라집니다. 어제의 RED가 그대로인 것은 고장이 아닙니다.
        </p>
        <p>
          <b className="text-ink-dim">출발 등급(severity_base)은 여기서 고치지 않습니다.</b>{' '}
          그 값은 §19의 «누가 손대는가»에서 나온 판단이고, 등급이 축 셋 이상으로 실제로 나오면
          점수가 그 자리를 대신합니다(오늘은 출처가 있는 축이 재무 하나뿐입니다).
        </p>
        <p>
          <b className="text-ink-dim">단위는 표에 칸이 없습니다.</b> 규칙 13종이 고정 사전이라
          단위는 규칙 하나에 붙은 사실로 보고 코드에 두었습니다(%·%p·개월). 그 목록에 없는
          규칙에는 «단위 미표기»라고 적습니다 — 화면이 단위를 지어내지 않습니다.
        </p>
      </div>

      <div className="pb-6" />
    </div>
  )
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border border-line-soft bg-panel p-3.5">
      <p className="flex items-center gap-1.5 text-[11px] text-ink-dim">
        <Icon name="target" className="size-3.5" />
        {label}
      </p>
      <p className="mt-1 text-[22px] font-bold leading-none text-ink tnum">{value}</p>
      <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-muted">{note}</p>
    </div>
  )
}
