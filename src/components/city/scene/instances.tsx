'use client'

import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import { Euler, Matrix4, Quaternion, Vector3, type BufferGeometry, type InstancedMesh, type Material } from 'three'

import type { V3 } from './layout3d'

/** 인스턴스 한 칸 — 위치 · y 회전 · 크기. */
export interface Inst {
  p: V3
  ry?: number
  s: V3
}

const m4 = new Matrix4()
const q = new Quaternion()
const e = new Euler()
const vp = new Vector3()
const vs = new Vector3()

export function writeInstances(mesh: InstancedMesh, list: Inst[]) {
  list.forEach((it, i) => {
    q.setFromEuler(e.set(0, it.ry ?? 0, 0))
    m4.compose(vp.set(it.p[0], it.p[1], it.p[2]), q, vs.set(it.s[0], it.s[1], it.s[2]))
    mesh.setMatrixAt(i, m4)
  })
  mesh.count = list.length
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingSphere()
}

/** 크기가 정해진(capacity 고정) 인스턴스 메시에 목록을 쓴다. count 는 프레임 루프가 따로 줄일 수 있다. */
export function useInstances(ref: RefObject<InstancedMesh | null>, list: Inst[]) {
  useLayoutEffect(() => {
    if (ref.current) writeInstances(ref.current, list)
  }, [ref, list])
}

/**
 * 움직이지 않는 반복 형상(가로등 · 대로 · 비계 · 멀리 보이는 건물)을 한 번의 draw call 로.
 * 목록 길이가 바뀌면 key 로 메시를 새로 만든다 — InstancedMesh 의 capacity 는 늘릴 수 없다.
 */
export function StaticInstances({
  geometry,
  material,
  list,
  castShadow = false,
  receiveShadow = false,
  children,
}: {
  geometry: BufferGeometry
  /** 없으면 children 의 재질(투명도를 따로 움직이는 비계 같은 것)을 붙인다. */
  material?: Material
  list: Inst[]
  castShadow?: boolean
  receiveShadow?: boolean
  children?: ReactNode
}) {
  const ref = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    if (ref.current) writeInstances(ref.current, list)
  }, [list])
  return (
    <instancedMesh
      key={list.length}
      ref={ref}
      args={[geometry, material, Math.max(1, list.length)]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
    >
      {children}
    </instancedMesh>
  )
}
