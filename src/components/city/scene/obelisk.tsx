'use client'

import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Group, MeshStandardMaterial, PointLight } from 'three'

import { OBELISK } from './layout3d'
import { BOX, BOX_BASE, CYL, MAT, PYRAMID } from './shared'

const SHAFT_H = 15

/**
 * 회장 = 황동 오벨리스크. 접속 중이면 첨탑(피라미디온)이 금빛으로 켜진다 — bloom 문턱을 넘는
 * emissive 로. 오늘 브리핑이 끝났으면 발치에 금 봉인이 찍힌 흰 봉투가 떠 있다.
 */
export function Obelisk({ online, brief, still }: { online: boolean; brief: boolean; still: boolean }) {
  const tipMat = useRef<MeshStandardMaterial>(null)
  const glow = useRef<PointLight>(null)
  const envelope = useRef<Group>(null)

  useFrame((state, dt) => {
    const k = 1 - Math.exp(-dt * 2.5)
    const target = online ? 1 : 0
    const m = tipMat.current
    if (m) {
      // 켜짐은 천천히 숨쉬듯 — 가만한 금속이 아니라 «지금 있다»로 읽히게.
      const pulse = online && !still ? 0.85 + 0.15 * Math.sin(state.clock.elapsedTime * 1.6) : 1
      const cur = m.userData.on ?? 0
      const on = cur + (target - cur) * k
      m.userData.on = on
      m.emissiveIntensity = on * 5.5 * pulse
    }
    if (glow.current) glow.current.intensity = (tipMat.current?.userData.on ?? 0) * 40
    const env = envelope.current
    if (env) {
      const t = state.clock.elapsedTime
      env.position.y = 2.1 + (still ? 0 : Math.sin(t * 1.4) * 0.18)
      env.rotation.y = still ? 0.3 : Math.sin(t * 0.6) * 0.45
    }
  })

  return (
    <group position={OBELISK}>
      {/* 대리석 기단 두 단 */}
      <mesh geometry={BOX_BASE} material={MAT.marble} scale={[3.6, 0.5, 3.6]} castShadow receiveShadow />
      <mesh geometry={BOX_BASE} material={MAT.marbleShade} scale={[2.8, 0.5, 2.8]} position-y={0.5} castShadow receiveShadow />
      <mesh geometry={BOX_BASE} material={MAT.brass} scale={[2.0, 0.35, 2.0]} position-y={1.0} castShadow />
      {/* 사각 기둥 — 네모 단면 원뿔대(4면 실린더) */}
      <mesh position-y={1.35 + SHAFT_H / 2} rotation-y={Math.PI / 4} material={MAT.brass} castShadow>
        <cylinderGeometry args={[0.52, 0.86, SHAFT_H, 4, 1]} />
      </mesh>
      <mesh position-y={1.35 + SHAFT_H} scale={[0.52, 1.6, 0.52]} geometry={PYRAMID} castShadow>
        <meshStandardMaterial
          ref={tipMat}
          color="#c9a35a"
          metalness={1}
          roughness={0.2}
          emissive="#ffc766"
          emissiveIntensity={0}
        />
      </mesh>
      <pointLight ref={glow} position-y={1.35 + SHAFT_H + 1.4} color="#ffcf7a" intensity={0} distance={26} decay={2} />

      {brief && (
        <group ref={envelope} position={[0, 2.1, 2.3]}>
          <mesh geometry={BOX} material={MAT.paper} scale={[1.3, 0.85, 0.07]} castShadow />
          {/* 봉투 덮개 선 — 얇은 황동 띠 둘 대신 봉인 하나로 충분히 읽힌다 */}
          <mesh geometry={CYL} material={MAT.brass} rotation-x={Math.PI / 2} position-z={0.03} scale={[0.17, 0.05, 0.17]} />
        </group>
      )}
    </group>
  )
}
