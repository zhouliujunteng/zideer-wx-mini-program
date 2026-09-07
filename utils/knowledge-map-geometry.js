function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function measureWidth(measureText, text) {
  try {
    const measured = measureText(text)
    const width = typeof measured === 'number' ? measured : measured && measured.width
    return isFiniteNumber(width) ? width : Infinity
  } catch (error) {
    return Infinity
  }
}

function fitTextLines(label, maxWidth, measureText, maxLines = 2) {
  const width = Number(maxWidth)
  const lineLimit = Math.floor(Number(maxLines))
  const chars = Array.from(label == null ? '' : String(label).replace(/\r\n?/g, '\n'))
  if (!chars.length || !Number.isFinite(width) || width <= 0 ||
      !Number.isFinite(lineLimit) || lineLimit <= 0 || typeof measureText !== 'function') return []

  const lines = []
  let index = 0
  while (index < chars.length && lines.length < lineLimit) {
    let line = ''
    let consumed = false
    while (index < chars.length) {
      const char = chars[index]
      if (char === '\n') {
        index += 1
        consumed = true
        break
      }
      if (measureWidth(measureText, line + char) > width) break
      line += char
      index += 1
      consumed = true
    }
    if (!consumed) {
      if (measureWidth(measureText, '…') <= width) lines.push('…')
      return lines
    }
    lines.push(line)
  }

  if (index < chars.length) {
    if (!lines.length) lines.push('')
    let lastLine = lines[lines.length - 1]
    while (lastLine && measureWidth(measureText, lastLine + '…') > width) {
      lastLine = Array.from(lastLine).slice(0, -1).join('')
    }
    lines[lines.length - 1] = measureWidth(measureText, lastLine + '…') <= width
      ? lastLine + '…'
      : lastLine
  }
  return lines
}

function normalizeRect(rect) {
  const source = rect || {}
  let x = isFiniteNumber(source.x) ? source.x : (isFiniteNumber(source.left) ? source.left : 0)
  let y = isFiniteNumber(source.y) ? source.y : (isFiniteNumber(source.top) ? source.top : 0)
  let width = isFiniteNumber(source.width)
    ? source.width
    : (isFiniteNumber(source.right) ? source.right - x : 0)
  let height = isFiniteNumber(source.height)
    ? source.height
    : (isFiniteNumber(source.bottom) ? source.bottom - y : 0)
  if (width < 0) { x += width; width = -width }
  if (height < 0) { y += height; height = -height }
  return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height }
}

function getRadius(rect, width, height) {
  const source = rect || {}
  const value = [source.radius, source.cornerRadius, source.borderRadius, source.r]
    .find(isFiniteNumber)
  return clamp(value == null ? 0 : value, 0, Math.min(width, height) / 2)
}

function getRectCenter(rect) {
  const normalized = normalizeRect(rect)
  return { x: normalized.x + normalized.width / 2, y: normalized.y + normalized.height / 2 }
}

const KNOWLEDGE_MAP_LAYOUT_PROFILES = {
  compact: { scaleX: 0.72, scaleY: 0.78, horizontalGap: 28, verticalGap: 22 },
  medium: { scaleX: 0.76, scaleY: 0.84, horizontalGap: 30, verticalGap: 25 },
  large: { scaleX: 0.72, scaleY: 0.9, horizontalGap: 32, verticalGap: 29 },
  dense: { scaleX: 0.68, scaleY: 0.95, horizontalGap: 34, verticalGap: 34 }
}

function getKnowledgeMapLayoutProfile(nodeCount) {
  const count = Math.max(0, Math.floor(Number(nodeCount) || 0))
  if (count <= 12) return { ...KNOWLEDGE_MAP_LAYOUT_PROFILES.compact, tier: 'compact' }
  if (count <= 40) return { ...KNOWLEDGE_MAP_LAYOUT_PROFILES.medium, tier: 'medium' }
  if (count <= 100) return { ...KNOWLEDGE_MAP_LAYOUT_PROFILES.large, tier: 'large' }
  return { ...KNOWLEDGE_MAP_LAYOUT_PROFILES.dense, tier: 'dense' }
}

function projectKnowledgeMapPoint(layout, profile = KNOWLEDGE_MAP_LAYOUT_PROFILES.compact) {
  const source = layout || {}
  const x = isFiniteNumber(source.x) ? source.x : 0
  const y = isFiniteNumber(source.y) ? source.y : 0
  return {
    x: x * (isFiniteNumber(profile.scaleX) ? profile.scaleX : KNOWLEDGE_MAP_LAYOUT_PROFILES.compact.scaleX),
    y: y * (isFiniteNumber(profile.scaleY) ? profile.scaleY : KNOWLEDGE_MAP_LAYOUT_PROFILES.compact.scaleY)
  }
}

function getKnowledgeMapCardMetrics(nodeType) {
  if (nodeType === 'domain_root') {
    return { width: 120, height: 50, radius: 12, fontSize: 11.5, fontWeight: 700 }
  }
  if (nodeType === 'branch') {
    return { width: 102, height: 44, radius: 10, fontSize: 10, fontWeight: 600 }
  }
  return { width: 92, height: 40, radius: 9, fontSize: 9.5, fontWeight: 500 }
}

function getCardBoundaryAnchor(card, toward, gap = 0) {
  const rect = normalizeRect(card)
  const radius = getRadius(card, rect.width, rect.height)
  const centerX = rect.x + rect.width / 2
  const centerY = rect.y + rect.height / 2
  const targetX = toward && isFiniteNumber(toward.x) ? toward.x : centerX
  const targetY = toward && isFiniteNumber(toward.y) ? toward.y : centerY
  const dx = targetX - centerX
  const dy = targetY - centerY
  const offset = isFiniteNumber(gap) ? gap : 0
  let x
  let y
  let normalX = 0
  let normalY = 0

  const useVerticalSide = (!dx && !dy) || !dy || (dx && Math.abs(dx) * rect.height >= Math.abs(dy) * rect.width)
  if (useVerticalSide) {
    normalX = dx < 0 ? -1 : 1
    x = normalX < 0 ? rect.left : rect.right
    y = dx ? centerY + dy * (rect.width / 2) / Math.abs(dx) : centerY
    y = clamp(y, rect.top + radius, rect.bottom - radius)
  } else {
    normalY = dy < 0 ? -1 : 1
    y = normalY < 0 ? rect.top : rect.bottom
    x = centerX + dx * (rect.height / 2) / Math.abs(dy)
    x = clamp(x, rect.left + radius, rect.right - radius)
  }

  return { x: x + normalX * offset, y: y + normalY * offset, normalX, normalY }
}

function getCardSideAnchor(card, side, gap = 0) {
  const rect = normalizeRect(card)
  const offset = isFiniteNumber(gap) ? gap : 0
  const centerX = rect.x + rect.width / 2
  const centerY = rect.y + rect.height / 2
  if (side === 'left') return { x: rect.left - offset, y: centerY, normalX: -1, normalY: 0, side }
  if (side === 'top') return { x: centerX, y: rect.top - offset, normalX: 0, normalY: -1, side }
  if (side === 'bottom') return { x: centerX, y: rect.bottom + offset, normalX: 0, normalY: 1, side }
  return { x: rect.right + offset, y: centerY, normalX: 1, normalY: 0, side: 'right' }
}

function getKnowledgeMapEdgePorts(fromCard, toCard, gap = 0) {
  const fromCenter = getRectCenter(fromCard)
  const toCenter = getRectCenter(toCard)
  const dx = toCenter.x - fromCenter.x
  const dy = toCenter.y - fromCenter.y
  const averageWidth = Math.max(1, (normalizeRect(fromCard).width + normalizeRect(toCard).width) / 2)
  const averageHeight = Math.max(1, (normalizeRect(fromCard).height + normalizeRect(toCard).height) / 2)
  const usesHorizontalPorts = Math.abs(dx) / averageWidth >= Math.abs(dy) / averageHeight
  let sourceSide
  let targetSide
  if (usesHorizontalPorts) {
    sourceSide = dx < 0 ? 'left' : 'right'
    targetSide = dx < 0 ? 'right' : 'left'
  } else {
    sourceSide = dy < 0 ? 'top' : 'bottom'
    targetSide = dy < 0 ? 'bottom' : 'top'
  }
  return {
    axis: usesHorizontalPorts ? 'horizontal' : 'vertical',
    source: getCardSideAnchor(fromCard, sourceSide, gap),
    target: getCardSideAnchor(toCard, targetSide, gap)
  }
}

function expandRect(rect, padding) {
  const normalized = normalizeRect(rect)
  const amount = isFiniteNumber(padding) ? padding : 0
  return {
    x: normalized.x - amount,
    y: normalized.y - amount,
    width: normalized.width + amount * 2,
    height: normalized.height + amount * 2
  }
}

function getBounds(rects, padding = 0) {
  if (!Array.isArray(rects) || !rects.length) return expandRect({}, padding)
  const normalized = rects.map(normalizeRect)
  const left = Math.min(...normalized.map((rect) => rect.left))
  const top = Math.min(...normalized.map((rect) => rect.top))
  const right = Math.max(...normalized.map((rect) => rect.right))
  const bottom = Math.max(...normalized.map((rect) => rect.bottom))
  return expandRect({ x: left, y: top, width: right - left, height: bottom - top }, padding)
}

function buildBezierEdgeGeometry(fromCard, toCard, gap = 3, bendDirection = 0) {
  const fromCenter = getRectCenter(fromCard)
  const toCenter = getRectCenter(toCard)
  const ports = getKnowledgeMapEdgePorts(fromCard, toCard, 0)
  const sourceAnchor = ports.source
  const targetAnchor = ports.target
  const centerDx = toCenter.x - fromCenter.x
  const centerDy = toCenter.y - fromCenter.y
  const centerDistance = Math.hypot(centerDx, centerDy)
  const directionX = centerDistance ? centerDx / centerDistance : 0
  const directionY = centerDistance ? centerDy / centerDistance : 0
  const boundaryClearance =
    (targetAnchor.x - sourceAnchor.x) * directionX +
    (targetAnchor.y - sourceAnchor.y) * directionY
  if (boundaryClearance <= 0) {
    const midpoint = {
      x: (sourceAnchor.x + targetAnchor.x) / 2,
      y: (sourceAnchor.y + targetAnchor.y) / 2
    }
    return {
      start: midpoint,
      end: midpoint,
      cp1: midpoint,
      cp2: midpoint,
      bounds: getBounds([midpoint]),
      axis: ports.axis,
      sourceSide: sourceAnchor.side,
      targetSide: targetAnchor.side
    }
  }
  const requestedGap = Math.max(0, isFiniteNumber(gap) ? gap : 0)
  const safeGap = Math.min(requestedGap, boundaryClearance / 4)
  const start = getCardSideAnchor(fromCard, sourceAnchor.side, safeGap)
  const end = getCardSideAnchor(toCard, targetAnchor.side, safeGap)
  const distance = Math.hypot(end.x - start.x, end.y - start.y)
  const primaryDistance = ports.axis === 'horizontal'
    ? Math.abs(end.x - start.x)
    : Math.abs(end.y - start.y)
  const handleLength = Math.min(Math.max(18, primaryDistance * 0.46), distance * 0.48, 128)
  const cp1 = {
    x: start.x + start.normalX * handleLength,
    y: start.y + start.normalY * handleLength
  }
  const cp2 = {
    x: end.x + end.normalX * handleLength,
    y: end.y + end.normalY * handleLength
  }
  const bendSign = Number(bendDirection) < 0 ? -1 : (Number(bendDirection) > 0 ? 1 : 0)
  const secondaryDistance = ports.axis === 'horizontal'
    ? Math.abs(end.y - start.y)
    : Math.abs(end.x - start.x)
  const bend = bendSign && secondaryDistance < Math.max(8, primaryDistance * 0.12)
    ? clamp(distance * 0.085, 6, 18) * bendSign
    : 0
  if (ports.axis === 'horizontal') {
    cp1.y += bend
    cp2.y -= bend
  } else {
    cp1.x += bend
    cp2.x -= bend
  }
  const bounds = getBounds([start, cp1, cp2, end])
  return { start, end, cp1, cp2, bounds, axis: ports.axis, sourceSide: start.side, targetSide: end.side }
}

function getKnowledgeMapPresentation(options) {
  const source = options || {}
  const nodeCount = Math.max(0, Math.floor(Number(source.nodeCount) || 0))
  const viewportWidth = Math.max(1, Number(source.viewportWidth) || 1)
  const viewportHeight = Math.max(1, Number(source.viewportHeight) || 1)
  const bounds = normalizeRect(source.bounds)
  if (!nodeCount || !bounds.width || !bounds.height) {
    return { defaultScale: 1, minScale: 0.6, maxScale: 1.8, panPadding: 32, initialFocus: 'center', fitScale: 1 }
  }
  const fitScale = Math.min(
    Math.max(1, viewportWidth - 32) / bounds.width,
    Math.max(1, viewportHeight - 32) / bounds.height
  )
  let idealScale
  let minimumDefault
  let maximumDefault
  let panPadding
  let initialFocus = 'center'
  if (nodeCount <= 12) {
    idealScale = 0.9
    minimumDefault = 0.78
    maximumDefault = 1.05
    panPadding = 36
  } else if (nodeCount <= 40) {
    idealScale = 0.72
    minimumDefault = 0.64
    maximumDefault = 0.9
    panPadding = 40
  } else if (nodeCount <= 100) {
    idealScale = 0.6
    minimumDefault = 0.52
    maximumDefault = 0.78
    panPadding = 44
  } else {
    idealScale = 0.5
    minimumDefault = 0.46
    maximumDefault = 0.62
    panPadding = 48
    initialFocus = 'root'
  }
  const defaultScale = clamp(Math.max(fitScale * 0.98, idealScale), minimumDefault, maximumDefault)
  return {
    defaultScale,
    minScale: Math.min(defaultScale, Math.max(0.1, fitScale * 0.82)),
    maxScale: clamp(Math.max(1.75, defaultScale * 3.2), 1.75, 2.5),
    panPadding,
    initialFocus,
    fitScale
  }
}

function distanceToRoundedRect(point, rect) {
  if (!point || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) return Infinity
  const normalized = normalizeRect(rect)
  const radius = getRadius(rect, normalized.width, normalized.height)
  const centerX = normalized.x + normalized.width / 2
  const centerY = normalized.y + normalized.height / 2
  const innerHalfWidth = Math.max(0, normalized.width / 2 - radius)
  const innerHalfHeight = Math.max(0, normalized.height / 2 - radius)
  const dx = Math.abs(point.x - centerX) - innerHalfWidth
  const dy = Math.abs(point.y - centerY) - innerHalfHeight
  const outsideX = Math.max(dx, 0)
  const outsideY = Math.max(dy, 0)
  const signedDistance = Math.hypot(outsideX, outsideY) + Math.min(Math.max(dx, dy), 0) - radius
  return Math.max(0, signedDistance)
}

function shouldShowKnowledgeMapLabel(fontSize, scale, nodeType, gestureLod, isSelected, isStressFixture = true) {
  // Keep the label draw decision stable during a pinch. Hiding leaf labels in
  // gesture frames made text flash off and back on when the gesture ended.
  return Number(fontSize) > 0 && Number(scale) > 0
}

function getKnowledgeMapStatusMarkMetrics(scale, cardHeight) {
  const safeCardHeight = Math.max(1, Number(cardHeight) || 0)
  // Both anchor and glyph are card-relative world geometry. The badge therefore
  // shrinks with its node instead of staying screen-sized and looking enlarged.
  const anchorInset = clamp(safeCardHeight * 0.2, 7.5, 10)
  const lineWidth = clamp(safeCardHeight * 0.028, 0.8, 1.2)
  const maxExtent = Math.max(1, anchorInset - lineWidth - 1.2)
  return {
    xInset: anchorInset,
    radius: Math.min(clamp(safeCardHeight * 0.075, 1.4, 3.2), maxExtent),
    halfWidth: Math.min(clamp(safeCardHeight * 0.105, 1.8, 3.8), maxExtent),
    lineWidth,
    checkDrop: Math.min(clamp(safeCardHeight * 0.06, 1.4, 2.8), maxExtent),
    checkRise: Math.min(clamp(safeCardHeight * 0.08, 1.8, 3.6), maxExtent),
    checkRun: Math.min(clamp(safeCardHeight * 0.1, 2.2, 4.5), maxExtent)
  }
}

function getKnowledgeMapConnectionPortMetrics(scale, cardHeight) {
  const safeScale = Math.max(Number(scale) || 0, 0.08)
  const renderedCardHeight = Math.max(0, Number(cardHeight) * safeScale || 0)
  const renderedRadius = clamp(renderedCardHeight * 0.085, 1.8, 3.2)
  const renderedStrokeWidth = clamp(renderedRadius * 0.5, 1, 1.4)
  return {
    radius: renderedRadius / safeScale,
    strokeWidth: renderedStrokeWidth / safeScale
  }
}

function getVisibleCanvasRect(width, height, clipHeight, followOffset, useClip = true) {
  const canvasWidth = Math.max(0, Number(width) || 0)
  const canvasHeight = Math.max(0, Number(height) || 0)
  if (!useClip) return { x: 0, y: 0, width: canvasWidth, height: canvasHeight }
  const top = clamp(Number(followOffset) || 0, 0, canvasHeight)
  const requestedHeight = Number(clipHeight)
  const visibleHeight = clamp(
    Number.isFinite(requestedHeight) ? requestedHeight : canvasHeight,
    0,
    canvasHeight - top
  )
  return { x: 0, y: top, width: canvasWidth, height: visibleHeight }
}

function pointInRoundedRect(point, rect, hitSlop = 0) {
  if (!point || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) return false
  const normalized = normalizeRect(rect)
  const slop = Math.max(0, isFiniteNumber(hitSlop) ? hitSlop : 0)
  const expanded = expandRect(normalized, slop)
  const radius = clamp(getRadius(rect, normalized.width, normalized.height) + slop,
    0, Math.min(expanded.width, expanded.height) / 2)
  const right = expanded.x + expanded.width
  const bottom = expanded.y + expanded.height
  if (point.x < expanded.x || point.x > right || point.y < expanded.y || point.y > bottom) return false
  if (!radius) return true
  const nearestX = clamp(point.x, expanded.x + radius, right - radius)
  const nearestY = clamp(point.y, expanded.y + radius, bottom - radius)
  const dx = point.x - nearestX
  const dy = point.y - nearestY
  return dx * dx + dy * dy <= radius * radius
}

function rectIntersectsRect(a, b) {
  const first = normalizeRect(a)
  const second = normalizeRect(b)
  return first.left <= second.right && first.right >= second.left &&
    first.top <= second.bottom && first.bottom >= second.top
}

module.exports = {
  fitTextLines,
  getKnowledgeMapLayoutProfile,
  projectKnowledgeMapPoint,
  getKnowledgeMapCardMetrics,
  getCardBoundaryAnchor,
  getCardSideAnchor,
  getKnowledgeMapEdgePorts,
  buildBezierEdgeGeometry,
  getKnowledgeMapPresentation,
  distanceToRoundedRect,
  shouldShowKnowledgeMapLabel,
  getKnowledgeMapStatusMarkMetrics,
  getKnowledgeMapConnectionPortMetrics,
  getVisibleCanvasRect,
  pointInRoundedRect,
  rectIntersectsRect,
  expandRect,
  getBounds
}
