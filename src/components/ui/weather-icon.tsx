import type { WeatherIconName } from '@/lib/weather-codes'

/**
 * 날씨 그림 여섯 개. components/ui/icon.tsx와 같은 규칙이다 —
 * 외부 아이콘 패키지를 넣지 않고 24×24 stroke path만 들고 간다.
 *
 * Icon의 IconName union에 넣지 않은 이유는 그쪽이 **내비게이션 어휘**이기 때문이다.
 * 메뉴 아이콘은 하나에 path 하나지만 날씨는 구름 위에 빗줄기가 얹히는 식으로 겹쳐 그려야 해서
 * 자료 구조가 다르다(문자열 하나 vs 배열). 한 union에 밀어 넣으면 Icon이 둘 다 알아야 한다.
 *
 * 구름은 비·눈·번개·안개가 공유한다 — 같은 자리에 같은 모양으로 앉아야
 * 날씨가 바뀔 때 그림이 튀지 않고 아래쪽 표식만 갈린다.
 */

/** 비·눈·번개가 쓰는 구름. 아래에 표식이 붙도록 위로 올려 앉혔다. */
const CLOUD_HIGH = 'M7.5 14.5h9.8a3.7 3.7 0 0 0 .3-7.4 5.5 5.5 0 0 0-10.6-1.3A4 4 0 0 0 7.5 14.5Z'

const PATHS: Record<WeatherIconName, string[]> = {
  sun: [
    'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z',
    'M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2',
    'm5.1 5.1 1.4 1.4M17.5 17.5l1.4 1.4M5.1 18.9l1.4-1.4M17.5 6.5l1.4-1.4',
  ],
  // 구름만 있는 날은 구름을 가운데로 내려 앉힌다 — 아래에 붙을 표식이 없다.
  cloud: ['M7.5 18h9.8a3.7 3.7 0 0 0 .3-7.4 5.5 5.5 0 0 0-10.6-1.3A4 4 0 0 0 7.5 18Z'],
  // 안개는 구름 아래를 가로줄로 지운다. 길이를 달리해 흩어지는 결을 준다.
  fog: [CLOUD_HIGH, 'M4.5 18h15M7 21h12'],
  // 비는 기울어진 선이다. 눈(점)과 한눈에 갈려야 해서 각도를 준다.
  rain: [CLOUD_HIGH, 'm9 17.5-1.5 3.5M13 17.5l-1.5 3.5M17 17.5l-1.5 3.5'],
  // 눈은 점이다. stroke-linecap="round"라 길이 0인 path가 동그란 점으로 찍힌다
  // (icon.tsx의 'more'가 쓰는 것과 같은 수법).
  snow: [CLOUD_HIGH, 'M9 18v.01M12.5 20.5v.01M16 18v.01M12.5 17v.01'],
  // 번개는 구름 아래 한 줄기만. 두 줄기를 그리면 이 크기에서 뭉친다.
  thunder: [CLOUD_HIGH, 'm13.5 16-4 5h3.5l-1 3'],
}

interface WeatherIconProps {
  name: WeatherIconName
  className?: string
}

/**
 * aria-hidden이다. 이름은 곁의 라벨(WEATHER_CODE_LABEL_KO)이 글자로 말한다 —
 * 그림과 라벨이 같은 이름을 두 번 읽히면 스크린 리더에서 '맑음 맑음'이 된다.
 */
export function WeatherIcon({ name, className = 'size-[18px]' }: WeatherIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
