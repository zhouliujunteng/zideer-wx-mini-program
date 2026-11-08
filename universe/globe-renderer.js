// 「宇宙」Tab 的 3D 球体。Three.js 适配库约 600KB，放在 universe 分包里由
// pages/knowledge-universe 用 require.async 加载，不占主包体积。
// 渲染器源自设计师仓库 ui-ref/pages/knowledge-universe/globe-renderer.js。
const { createScopedThreejs } = require('./vendor/threejs-miniprogram')

function createSeededRandom(seed) {
  let value = seed >>> 0
  return function random() {
    value += 0x6d2b79f5
    let next = value
    next = Math.imul(next ^ (next >>> 15), next | 1)
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61)
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296
  }
}

function createLearningGlobe(canvas, width, height, knowledgeCards = []) {
  const THREE = createScopedThreejs(canvas)
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
  const pixelRatio = Math.min(wx.getWindowInfo ? wx.getWindowInfo().pixelRatio || 1 : 2, 2)
  renderer.setPixelRatio(pixelRatio)
  renderer.setSize(width, height, false)
  renderer.setClearColor(0x000000, 0)

  const scene = new THREE.Scene()
  const cameraDistance = 12.7
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100)
  camera.position.z = cameraDistance

  const universe = new THREE.Group()
  universe.rotation.x = -0.14
  let zoomScale = 0.95
  universe.scale.set(zoomScale, zoomScale, zoomScale)
  scene.add(universe)

  const globeRadius = 2.2
  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(globeRadius, 48, 36),
    new THREE.MeshPhongMaterial({
      color: 0xf0f2f0,
      emissive: 0xe9ece9,
      specular: 0xffffff,
      shininess: 24
    })
  )
  universe.add(globe)

  // Fine globe coordinates sit just above the sphere surface. The sphere's
  // depth buffer naturally hides the far-side halves of each line.
  const gridMaterial = new THREE.LineBasicMaterial({
    color: 0xaeb8b0,
    transparent: true,
    opacity: 0.34,
    depthWrite: false
  })
  const gridRadius = globeRadius + 0.009
  const addGridLine = (coordinates) => {
    const positions = []
    coordinates.forEach((coordinate) => {
      const latitude = coordinate[0] * Math.PI / 180
      const longitude = coordinate[1] * Math.PI / 180
      const latitudeRing = Math.cos(latitude)
      positions.push(
        Math.sin(longitude) * latitudeRing * gridRadius,
        Math.sin(latitude) * gridRadius,
        Math.cos(longitude) * latitudeRing * gridRadius
      )
    })
    const geometry = new THREE.BufferGeometry()
    geometry.addAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    universe.add(new THREE.Line(geometry, gridMaterial))
  }
  const longitudeLines = [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150, 180]
  longitudeLines.forEach((longitude) => {
    const coordinates = []
    for (let step = 0; step <= 72; step += 1) {
      coordinates.push([-90 + step * 2.5, longitude])
    }
    addGridLine(coordinates)
  })
  const latitudeLines = [-60, -40, -20, 0, 20, 40, 60]
  latitudeLines.forEach((latitude) => {
    const coordinates = []
    for (let step = 0; step <= 96; step += 1) {
      coordinates.push([latitude, -180 + step * 3.75])
    }
    addGridLine(coordinates)
  })

  // Lay each archipelago onto a lightly jittered latitude/longitude lattice.
  // Stable micro-perturbations preserve the ordered-but-natural clusters used
  // by the repository's constellation views without tracing real continents.
  const positions = []
  const colors = []
  const pointPalette = [
    [0.57, 0.65, 0.60], // sage
    [0.63, 0.71, 0.77], // mist blue
    [0.76, 0.68, 0.58], // warm sand
    [0.62, 0.72, 0.66]  // pale jade
  ]
  const random = createSeededRandom(20260923)
  const landmasses = [
    { lat: 49, lon: 12, latSpan: 18, lonSpan: 21, count: 86 },
    { lat: 25, lon: 48, latSpan: 12, lonSpan: 14, count: 48 },
    { lat: 17, lon: 91, latSpan: 14, lonSpan: 12, count: 58 },
    { lat: 43, lon: 137, latSpan: 13, lonSpan: 17, count: 72 },
    { lat: 15, lon: -112, latSpan: 15, lonSpan: 19, count: 74 },
    { lat: -18, lon: -72, latSpan: 20, lonSpan: 13, count: 82 },
    { lat: -42, lon: -8, latSpan: 11, lonSpan: 21, count: 52 },
    { lat: -29, lon: 56, latSpan: 12, lonSpan: 16, count: 56 },
    { lat: -17, lon: 126, latSpan: 12, lonSpan: 16, count: 57 },
    { lat: 66, lon: -43, latSpan: 8, lonSpan: 11, count: 32 },
    { lat: 5, lon: 169, latSpan: 7, lonSpan: 9, count: 29 },
    { lat: -57, lon: -139, latSpan: 7, lonSpan: 12, count: 28 }
  ]
  landmasses.forEach((mass, massIndex) => {
    const phase = random() * Math.PI * 2
    const rotation = (random() - 0.5) * 0.8
    const aspect = mass.lonSpan / mass.latSpan
    const columns = Math.max(5, Math.ceil(Math.sqrt(mass.count * 2 * aspect)))
    const rows = Math.max(4, Math.ceil(Math.sqrt(mass.count * 2 / aspect)))
    const stepX = (mass.lonSpan * 2) / columns
    const stepY = (mass.latSpan * 2) / rows
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const localX = -mass.lonSpan + (column + 0.5 + (random() - 0.5) * 0.34) * stepX
        const localY = -mass.latSpan + (row + 0.5 + (random() - 0.5) * 0.34) * stepY
        const normalizedX = localX / mass.lonSpan
        const normalizedY = localY / mass.latSpan
        const angle = Math.atan2(normalizedY, normalizedX)
        const distance = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY)
        const edge = 0.84 + 0.11 * Math.sin(angle * 3 + phase) + 0.07 * Math.cos(angle * 5 - phase)
        if (distance > edge) continue
        const longitude = mass.lon + localX * Math.cos(rotation) - localY * Math.sin(rotation)
        const latitude = Math.max(-78, Math.min(78, mass.lat + localX * Math.sin(rotation) + localY * Math.cos(rotation)))
        const latitudeRad = latitude * Math.PI / 180
        const longitudeRad = longitude * Math.PI / 180
        const surfaceRadius = globeRadius + 0.018 + (massIndex % 3) * 0.001
        positions.push(Math.sin(longitudeRad) * Math.cos(latitudeRad) * surfaceRadius, Math.sin(latitudeRad) * surfaceRadius, Math.cos(longitudeRad) * Math.cos(latitudeRad) * surfaceRadius)
        colors.push(...pointPalette[massIndex % pointPalette.length])
      }
    }
  })
  const pointGeometry = new THREE.BufferGeometry()
  pointGeometry.addAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  pointGeometry.addAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  // Use a few restrained pale hues across the knowledge archipelagos while
  // keeping the overall dot texture low contrast against the white sphere.
  universe.add(new THREE.Points(pointGeometry, new THREE.PointsMaterial({ color: 0xffffff, vertexColors: true, size: 0.115, transparent: true, opacity: 0.48, sizeAttenuation: true, depthWrite: false })))

  // A restrained, tilted dust ring extends the knowledge field beyond the
  // globe. Procedural points keep the bundle light; sphere depth hides the
  // section passing behind the planet while everything rotates as one object.
  const ringPositions = []
  const ringRandom = createSeededRandom(20260924)
  const ringInclineY = 0.43
  const ringInclineZ = 0.903
  const getRingPosition = (angle, ringRadius) => ({
    x: Math.cos(angle) * ringRadius,
    y: Math.sin(angle) * ringRadius * ringInclineY,
    z: Math.sin(angle) * ringRadius * ringInclineZ
  })
  for (let index = 0; index < 2400; index += 1) {
    const angle = ringRandom() * Math.PI * 2
    const ringRadius = 2.5 + ringRandom() * 1.1
    const ringPoint = getRingPosition(angle, ringRadius)
    const dust = (ringRandom() - 0.5) * 0.075
    ringPositions.push(
      ringPoint.x,
      ringPoint.y + dust,
      ringPoint.z + dust * 0.29
    )
  }
  const ringGeometry = new THREE.BufferGeometry()
  ringGeometry.addAttribute('position', new THREE.Float32BufferAttribute(ringPositions, 3))
  universe.add(new THREE.Points(ringGeometry, new THREE.PointsMaterial({
    color: 0xb9c2bc,
    size: 0.055,
    transparent: true,
    opacity: 0.42,
    sizeAttenuation: true,
    depthWrite: false
  })))

  const ringNodePositions = []
  for (let index = 0; index < 16; index += 1) {
    const angle = (index / 16) * Math.PI * 2 + 0.16
    const ringRadius = 2.58 + (index % 4) * 0.31
    const ringPoint = getRingPosition(angle, ringRadius)
    ringNodePositions.push(ringPoint.x, ringPoint.y, ringPoint.z)
  }
  const ringNodeGeometry = new THREE.BufferGeometry()
  ringNodeGeometry.addAttribute('position', new THREE.Float32BufferAttribute(ringNodePositions, 3))
  universe.add(new THREE.Points(ringNodeGeometry, new THREE.PointsMaterial({
    color: 0xfd7c02,
    size: 0.12,
    transparent: true,
    opacity: 1,
    sizeAttenuation: true,
    depthWrite: false
  })))

  // 球面知识点来自后端，可能在球体初始化之后才读到，所以单独可替换。
  const knowledgeMaterial = new THREE.PointsMaterial({ color: 0xfd7c02, size: 0.12, transparent: true, opacity: 1, sizeAttenuation: true })
  let knowledgePoints = null
  function setKnowledgePoints(cards = []) {
    if (knowledgePoints) {
      universe.remove(knowledgePoints)
      knowledgePoints.geometry.dispose()
      knowledgePoints = null
    }
    if (!cards.length) return
    const knowledgePositions = []
    cards.forEach((card) => {
      const latitude = card.latitude * Math.PI / 180
      const longitude = card.longitude * Math.PI / 180
      const ringRadius = Math.cos(latitude)
      knowledgePositions.push(Math.sin(longitude) * ringRadius * (globeRadius + 0.04), Math.sin(latitude) * (globeRadius + 0.04), Math.cos(longitude) * ringRadius * (globeRadius + 0.04))
    })
    const knowledgeGeometry = new THREE.BufferGeometry()
    knowledgeGeometry.addAttribute('position', new THREE.Float32BufferAttribute(knowledgePositions, 3))
    knowledgePoints = new THREE.Points(knowledgeGeometry, knowledgeMaterial)
    universe.add(knowledgePoints)
  }
  setKnowledgePoints(knowledgeCards)

  const light = new THREE.PointLight(0xffffff, 0.82, 18)
  light.position.set(-3.5, 3.6, 5)
  scene.add(light)
  scene.add(new THREE.AmbientLight(0xdfe4df, 0.72))

  let yaw = 0.2
  let pitch = -0.14
  let autoSpeed = 0.0008
  let frameId = null
  let destroyed = false
  let paused = false

  function renderFrame() {
    if (destroyed || paused) {
      frameId = null
      return
    }
    if (autoSpeed) yaw += autoSpeed
    universe.rotation.y = yaw
    universe.rotation.x = pitch
    renderer.render(scene, camera)
    frameId = canvas.requestAnimationFrame ? canvas.requestAnimationFrame(renderFrame) : setTimeout(renderFrame, 32)
  }
  renderFrame()

  return {
    setKnowledgePoints,
    projectPoints(cards = []) {
      // Derive overlay depth and position from the same world matrix Three.js
      // renders. This avoids a second, potentially divergent Euler calculation.
      universe.updateMatrixWorld(true)
      return cards.map((card) => {
        const latitude = card.latitude * Math.PI / 180
        const longitude = card.longitude * Math.PI / 180
        const ringRadius = Math.cos(latitude)
        const point = new THREE.Vector3(
          Math.sin(longitude) * ringRadius,
          Math.sin(latitude),
          Math.cos(longitude) * ringRadius
        )
        universe.localToWorld(point)
        return { x: point.x, y: point.y, depth: point.z }
      })
    },
    projectRingPoints(cards = []) {
      universe.updateMatrixWorld(true)
      return cards.map((card) => {
        const angle = card.angle * Math.PI / 180
        const ringPosition = getRingPosition(angle, card.radius)
        const point = new THREE.Vector3(ringPosition.x, ringPosition.y, ringPosition.z)
        universe.localToWorld(point)
        return { x: point.x, y: point.y, depth: point.z }
      })
    },
    rotateBy(dx, dy) {
      yaw += dx * 0.008
      pitch = Math.max(-0.78, Math.min(0.78, pitch + dy * 0.006))
      universe.rotation.y = yaw
      universe.rotation.x = pitch
    },
    getRotation() { return { yaw, pitch } },
    getCameraDistance() { return cameraDistance },
    getZoomScale() { return zoomScale },
    pause() {
      if (destroyed || paused) return
      paused = true
      if (canvas.cancelAnimationFrame && frameId !== null) canvas.cancelAnimationFrame(frameId)
      else if (frameId !== null) clearTimeout(frameId)
      frameId = null
    },
    resume() {
      if (destroyed || !paused) return
      paused = false
      if (frameId === null) renderFrame()
    },
    setZoomScale(value) {
      zoomScale = Math.max(0.4, Math.min(1.4, value))
      universe.scale.set(zoomScale, zoomScale, zoomScale)
      universe.updateMatrixWorld(true)
    },
    setAutoRotation(value) { autoSpeed = value ? 0.0008 : 0 },
    resize(nextWidth, nextHeight) {
      renderer.setSize(nextWidth, nextHeight, false)
      camera.aspect = nextWidth / nextHeight
      camera.updateProjectionMatrix()
    },
    destroy() {
      destroyed = true
      if (canvas.cancelAnimationFrame && frameId !== null) canvas.cancelAnimationFrame(frameId)
      else if (frameId !== null) clearTimeout(frameId)
      renderer.dispose()
    }
  }
}

module.exports = { createLearningGlobe }
