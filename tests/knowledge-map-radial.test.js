const test = require('node:test')
const assert = require('node:assert/strict')
const { layoutKnowledgeRadially, spaceRadialCards } = require('../utils/knowledge-map-radial')
const { getKnowledgeMapCardMetrics, getKnowledgeMapTextCardMetrics, pointInRoundedRect } = require('../utils/knowledge-map-geometry')

test('radial layout handles empty and single-node graphs', () => {
  assert.deepEqual(layoutKnowledgeRadially([]), [])
  assert.deepEqual(layoutKnowledgeRadially([{id:'a'}])[0].layout, {x:0,y:0,level:0})
})

test('text-sized cards shrink for short names and wrap long names within their bounds', () => {
  const measure = text => Array.from(text).reduce((sum, c) => sum + (/[a-z]/i.test(c) ? 5 : 10), 0)
  const short = getKnowledgeMapTextCardMetrics('topic', '圆', measure)
  const medium = getKnowledgeMapTextCardMetrics('topic', '三角形的内角和', measure)
  const long = getKnowledgeMapTextCardMetrics('topic', '利用平行四边形的性质进行实际问题求解与证明', measure)
  assert(short.width < medium.width)
  assert(medium.width <= long.width)
  assert(long.height > short.height)
  assert(long.lines.length > 1)
  for (const card of [short, medium, long]) {
    assert(card.lines.every(line => measure(line) <= card.width - 28))
    assert(card.lines.length * card.lineHeight <= card.height - 20)
  }
  assert(getKnowledgeMapTextCardMetrics('topic', 'WWW', measure).width < getKnowledgeMapTextCardMetrics('topic', '圆圆圆', measure).width)
})

test('mixed text sizes stay separated and their actual cards remain the hit targets', () => {
  const nodes = layoutKnowledgeRadially(Array.from({length:600}, (_,id) => ({id, label:'知识点'.repeat(1 + id % 8)})))
  const initial = nodes.map(node => ({ ...getKnowledgeMapTextCardMetrics(node.nodeType, node.label, text => text.length * 11.5), node, centerX:node.layout.x, centerY:node.layout.y }))
  const cards = spaceRadialCards(initial)
  assert.equal(cards[0].centerX, 0)
  assert.equal(cards[0].centerY, 0)
  for (const card of cards) assert(pointInRoundedRect({x:card.centerX, y:card.centerY},card))
  for(let i=0;i<cards.length;i++) for(let j=i+1;j<cards.length;j++) {
    const a=cards[i], b=cards[j]
    assert(Math.abs(a.centerX-b.centerX)+1e-8 >= (a.width+b.width)/2+12 || Math.abs(a.centerY-b.centerY)+1e-8 >= (a.height+b.height)/2+12, `overlap ${i}/${j}`)
  }
})
test('radial layout centers the most connected real node without changing IDs', () => {
  const nodes = [{id:'a'},{id:'b'},{id:'c'}]
  const result = layoutKnowledgeRadially(nodes, [{from:'b',to:'a'},{from:'b',to:'c'}])
  assert.deepEqual(result.map(n => n.id), ['a','b','c'])
  assert.deepEqual(result[1].layout, {x:0,y:0,level:0})
  assert.equal(nodes[0].layout, undefined)
})
for (const count of [12,101,600]) test(`${count} nodes spread across four quadrants without overlapping cards`, () => {
  const nodes = layoutKnowledgeRadially(Array.from({length:count}, (_,id) => ({id})))
  const quadrants = [0,0,0,0]
  nodes.slice(1).forEach(({layout:p}) => {quadrants[(p.x<0?1:0)+(p.y<0?2:0)]++})
  assert(Math.max(...quadrants)-Math.min(...quadrants)<=4)
  for(let i=0;i<nodes.length;i++) for(let j=i+1;j<nodes.length;j++) {
    const a=nodes[i],b=nodes[j],am=getKnowledgeMapCardMetrics(a.nodeType),bm=getKnowledgeMapCardMetrics(b.nodeType)
    assert(Math.abs(a.layout.x-b.layout.x)>=(am.width+bm.width)/2+4 || Math.abs(a.layout.y-b.layout.y)>=(am.height+bm.height)/2+4, `overlap ${i}/${j}`)
  }
})
