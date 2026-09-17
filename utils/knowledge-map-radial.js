// A stable sunflower layout spreads cards over a disk without fixed rows.
// Coordinates are already in canvas-world units; do not apply grid scaling.
function layoutKnowledgeRadially(nodes, edges = []) {
  if (!nodes.length) return []
  const degree = new Map(nodes.map(node => [String(node.id), 0]))
  edges.forEach(edge => {
    for (const id of [edge.from, edge.to]) {
      const key = String(id)
      if (degree.has(key)) degree.set(key, degree.get(key) + 1)
    }
  })
  const root = nodes.reduce((best, node) => degree.get(String(node.id)) > degree.get(String(best.id)) ? node : best, nodes[0])
  let position = 0
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  return nodes.map(node => {
    if (node === root) return { ...node, nodeType: 'domain_root', layout: { x: 0, y: 0, level: 0 } }
    position += 1
    const radius = 80 * Math.sqrt(position)
    const angle = (position - 1) * goldenAngle - Math.PI / 2
    return { ...node, nodeType: 'topic', layout: { x: radius * Math.cos(angle), y: radius * Math.sin(angle), level: 1 } }
  })
}

// Expand the disk uniformly to fit measured cards, preserving its radial shape.
function spaceRadialCards(cards, gap = 12) {
  let expansion = 1
  for (let i = 0; i < cards.length; i += 1) {
    for (let j = i + 1; j < cards.length; j += 1) {
      const a = cards[i], b = cards[j]
      const dx = Math.abs(a.centerX - b.centerX)
      const dy = Math.abs(a.centerY - b.centerY)
      const horizontal = dx ? ((a.width + b.width) / 2 + gap) / dx : Infinity
      const vertical = dy ? ((a.height + b.height) / 2 + gap) / dy : Infinity
      const required = Math.min(horizontal, vertical)
      if (Number.isFinite(required)) expansion = Math.max(expansion, required)
    }
  }
  return cards.map(card => {
    const centerX = card.centerX * expansion
    const centerY = card.centerY * expansion
    return { ...card, centerX, centerY, x: centerX - card.width / 2, y: centerY - card.height / 2 }
  })
}

module.exports = { layoutKnowledgeRadially, spaceRadialCards }
