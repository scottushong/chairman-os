import type { CityCharacter, CityMotion } from '@/lib/city-live'

import s from './city-live.module.css'

/**
 * 그림 위에 서는 사람 하나 (Phase 8 G-2b) — 캐릭터 여덟 × 동작 넷을 SVG 한 벌로.
 *
 * 팔 · 다리를 따로 그려 두고 CSS(city-live.module.css)가 흔든다. 그림을 동작마다 따로 그리면
 * 여덟 × 넷 = 서른두 장이 되고, 한 사람의 옷색을 고치는 날 서른두 곳을 고친다.
 * 동작을 멈추는 것(«동작 줄이기»)도 CSS 한 줄이다 — 멈춘 자세가 그대로 그 동작의 한 장면이다.
 *
 * viewBox 20×36. 발끝이 (10, 36)이다 — 부르는 쪽은 이 점을 길목에 맞춘다(translate(-50%, -100%)).
 */

interface Look {
  shirt: string
  pants: string
  skin: string
  hair: string
  /** 머리 모양 — 짧게 · 길게 · 묶음. */
  hairStyle: 'short' | 'long' | 'tail'
  /** 넥타이 · 조끼 · 목걸이 같은 한 가지. */
  extra?: 'tie' | 'vest' | 'pin'
  extraColor?: string
}

const LOOK: Record<Exclude<CityCharacter, 'robot'>, Look> = {
  staff1: { shirt: '#4f7cac', pants: '#2d3a4a', skin: '#f1c9a5', hair: '#2b2118', hairStyle: 'short' },
  staff2: { shirt: '#d8a878', pants: '#3b3b3b', skin: '#f3d2b3', hair: '#4a2f1d', hairStyle: 'long' },
  staff3: { shirt: '#7fa37a', pants: '#34423a', skin: '#e7b894', hair: '#1c1c1c', hairStyle: 'short' },
  staff4: { shirt: '#c9737b', pants: '#3a3440', skin: '#f0c7a4', hair: '#6b4a2b', hairStyle: 'tail' },
  lead: { shirt: '#f4f4f0', pants: '#26323d', skin: '#eec3a0', hair: '#231a14', hairStyle: 'short', extra: 'vest', extraColor: '#2a7f7a' },
  ceo: { shirt: '#1f2a44', pants: '#1a2236', skin: '#eab99a', hair: '#8a8a8a', hairStyle: 'short', extra: 'tie', extraColor: '#b3303a' },
  chairman: { shirt: '#15151a', pants: '#101014', skin: '#ecc0a0', hair: '#c9c9c9', hairStyle: 'short', extra: 'pin', extraColor: '#d4af61' },
}

export function CityCharacterSvg({
  character,
  motion,
  className = '',
}: {
  character: CityCharacter
  motion: CityMotion
  className?: string
}) {
  const cls = `${s.character} ${s[`m_${motion}`]} ${className}`
  if (character === 'robot') return <RobotSvg className={cls} motion={motion} />
  const look = LOOK[character]
  const seated = motion === 'desk'

  return (
    <svg viewBox="0 0 20 36" className={cls} aria-hidden="true">
      {/* 그림자 */}
      <ellipse cx="10" cy="35.2" rx="5.2" ry="1" fill="rgba(0,0,0,.28)" />

      {/* 다리 — 앉으면 책상 뒤로 숨는다. */}
      {seated ? null : (
        <>
          <g className={s.legL}>
            <rect x="7.2" y="22" width="2.6" height="12" rx="1.2" fill={look.pants} />
            <rect x="6.8" y="33" width="3.2" height="1.6" rx=".8" fill="#1a1a1a" />
          </g>
          <g className={s.legR}>
            <rect x="10.2" y="22" width="2.6" height="12" rx="1.2" fill={look.pants} />
            <rect x="10" y="33" width="3.2" height="1.6" rx=".8" fill="#1a1a1a" />
          </g>
        </>
      )}

      <g className={s.torso}>
        {/* 뒤쪽 팔(왼쪽) */}
        <g className={s.armL}>
          <rect x="4.2" y="12.5" width="2.4" height="9.5" rx="1.2" fill={look.shirt} />
          <circle cx="5.4" cy="22.2" r="1.2" fill={look.skin} />
        </g>

        {/* 몸통 */}
        <rect x="6.2" y="11.5" width="7.6" height="12" rx="2.4" fill={look.shirt} />
        {look.extra === 'vest' ? (
          <path d="M6.6 13 L9 12 L10 17 L11 12 L13.4 13 L13.4 22.5 L6.6 22.5 Z" fill={look.extraColor} />
        ) : null}
        {look.extra === 'tie' ? (
          <>
            <path d="M8.6 11.6 L10 13.2 L11.4 11.6 Z" fill="#f2f2f2" />
            <path d="M9.4 13 L10.6 13 L11 19 L10 20.4 L9 19 Z" fill={look.extraColor} />
          </>
        ) : null}
        {look.extra === 'pin' ? (
          <>
            <path d="M8.6 11.6 L10 13.2 L11.4 11.6 Z" fill="#f2f2f2" />
            <path d="M9.5 13 L10.5 13 L10.8 18.5 L10 19.6 L9.2 18.5 Z" fill={look.extraColor} />
            <circle cx="12.2" cy="14.2" r=".7" fill={look.extraColor} />
          </>
        ) : null}

        {/* 머리 */}
        {look.hairStyle === 'long' ? <rect x="5.8" y="3.4" width="8.4" height="10" rx="3.6" fill={look.hair} /> : null}
        <circle cx="10" cy="7.2" r="3.9" fill={look.skin} />
        <path
          d={look.hairStyle === 'short' ? 'M6.1 6.8 Q6.4 2.6 10 2.8 Q13.8 2.6 13.9 6.8 Q12.6 4.8 10 4.9 Q7.4 4.8 6.1 6.8 Z' : 'M6 7.4 Q6 2.4 10 2.6 Q14 2.4 14 7.4 Q12.8 4.6 10 4.8 Q7.2 4.6 6 7.4 Z'}
          fill={look.hair}
        />
        {look.hairStyle === 'tail' ? <ellipse cx="14.4" cy="7.4" rx="1.3" ry="2.6" fill={look.hair} /> : null}

        {/* 서류 — 들고 걷기 */}
        {motion === 'carry' ? (
          <g>
            <rect x="8.4" y="14.6" width="7.4" height="5.6" rx=".5" fill="#fbfaf6" stroke="#b9b2a2" strokeWidth=".35" />
            <path d="M9.4 16.2 H14.6 M9.4 17.5 H14 M9.4 18.8 H13" stroke="#b9b2a2" strokeWidth=".35" />
          </g>
        ) : null}

        {/* 앞쪽 팔(오른쪽) */}
        <g className={s.armR}>
          <rect x="13.4" y="12.5" width="2.4" height="9.5" rx="1.2" fill={look.shirt} />
          <circle cx="14.6" cy="22.2" r="1.2" fill={look.skin} />
        </g>
      </g>

      {/* 책상 — 앉아 일하기 */}
      {seated ? <Desk /> : null}
    </svg>
  )
}

function Desk() {
  return (
    <g>
      <rect x="1" y="21.5" width="18" height="2" rx=".6" fill="#6b4f36" />
      <rect x="2.2" y="23.5" width="1.4" height="11.5" fill="#57402b" />
      <rect x="16.4" y="23.5" width="1.4" height="11.5" fill="#57402b" />
      <rect x="5.5" y="15.8" width="9" height="5.4" rx=".6" fill="#20262e" />
      <rect x="6.1" y="16.4" width="7.8" height="4.2" rx=".3" fill="#7fd3e6" className={s.screen} />
      <rect x="9.4" y="21.1" width="1.2" height=".6" fill="#20262e" />
    </g>
  )
}

function RobotSvg({ className, motion }: { className: string; motion: CityMotion }) {
  return (
    <svg viewBox="0 0 20 36" className={className} aria-hidden="true">
      <ellipse cx="10" cy="35.2" rx="5" ry="1" fill="rgba(0,0,0,.28)" />
      {motion === 'desk' ? null : (
        <>
          <g className={s.legL}>
            <rect x="7" y="24" width="2.6" height="10" rx="1" fill="#c9d2dc" />
          </g>
          <g className={s.legR}>
            <rect x="10.4" y="24" width="2.6" height="10" rx="1" fill="#c9d2dc" />
          </g>
        </>
      )}
      <g className={s.torso}>
        <g className={s.armL}>
          <rect x="3.6" y="14" width="2.2" height="8.5" rx="1.1" fill="#d7dee6" />
        </g>
        <rect x="5.6" y="12.8" width="8.8" height="12" rx="3" fill="#eef2f6" stroke="#b9c4cf" strokeWidth=".4" />
        <circle cx="10" cy="18.6" r="1.4" fill="#35d0e0" className={s.blink} />
        <line x1="10" y1="2" x2="10" y2="4.8" stroke="#9aa7b4" strokeWidth=".6" />
        <circle cx="10" cy="1.8" r="1" fill="#35d0e0" className={s.blink} />
        <rect x="5.4" y="4.6" width="9.2" height="7.4" rx="2.6" fill="#eef2f6" stroke="#b9c4cf" strokeWidth=".4" />
        <rect x="6.6" y="6.6" width="6.8" height="2.8" rx="1.4" fill="#12303a" />
        <rect x="7.4" y="7.4" width="5.2" height="1.2" rx=".6" fill="#35d0e0" />
        <g className={s.armR}>
          <rect x="14.2" y="14" width="2.2" height="8.5" rx="1.1" fill="#d7dee6" />
        </g>
      </g>
      {motion === 'desk' ? <Desk /> : null}
    </svg>
  )
}

