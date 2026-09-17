function uniqueLinks(links, centerId) {
  const seen = new Set([centerId])
  return (links || []).filter(link => {
    if (!link || link.id == null || !String(link.id) || seen.has(String(link.id))) return false
    seen.add(String(link.id))
    return true
  }).map(link => ({ ...link, id: String(link.id) }))
}

// Keep the selected topic at the origin; prerequisites fan left, successors right.
function buildKnowledgeRelationGraph(detail, knownNodes = []) {
  const id = String(detail.id)
  const known = new Map(knownNodes.map(node => [String(node.id), node]))
  const prerequisites = uniqueLinks(detail.prerequisiteLinks, id)
  const successors = uniqueLinks(detail.successorLinks, id)
  const nodes = [{ ...detail, id, status: (known.get(id) || {}).status || 'unknown', nodeType: 'domain_root', layout: { x: 0, y: 0, level: 0 } }]
  const seen = new Set([id])
  const edges = []
  for (const [role, links, direction] of [['prerequisite', prerequisites, -1], ['successor', successors, 1]]) {
    const newLinks = links.filter(link => !seen.has(link.id))
    newLinks.forEach((link, index) => {
      const ring = Math.floor(index / 7)
      const count = Math.min(7, newLinks.length - ring * 7)
      const angle = count === 1 ? 0 : -Math.PI / 3 + (index % 7) / (count - 1) * Math.PI * 2 / 3
      const radius = 180 + ring * 160
      nodes.push({ ...link, status: (known.get(link.id) || {}).status || 'unknown', nodeType: 'topic', relationRole: role,
        layout: { x: direction * radius * Math.cos(angle), y: radius * Math.sin(angle), level: ring + 1 } })
      seen.add(link.id)
    })
    links.forEach(link => edges.push({ id: `${role}:${link.id}:${id}`, from: direction < 0 ? link.id : id, to: direction < 0 ? id : link.id, strength: 'hard', relationRole: role }))
  }
  return { nodes, edges, radial: true, relationFocus: true, prerequisites, successors }
}

module.exports = { buildKnowledgeRelationGraph }
