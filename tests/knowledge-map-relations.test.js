const test = require('node:test')
const assert = require('node:assert/strict')
const { buildKnowledgeRelationGraph } = require('../utils/knowledge-map-relations')

test('relations keep cross-grade nodes, direction, mastery and deduplicate without self-links', () => {
  const graph = buildKnowledgeRelationGraph({id:'b',label:'一次函数',prerequisiteLinks:[
    {id:'a',label:'有理数',gradeLabel:'七年级'}, {id:'a',label:'有理数'}, {id:'b',label:'自身'}
  ], successorLinks:[{id:'c',label:'二次函数',gradeLabel:'九年级'}, {id:'a',label:'有理数'}]}, [{id:'b',status:'mastered'}])
  assert.deepEqual(graph.nodes.map(n=>n.id), ['b','a','c'])
  assert.equal(graph.nodes[0].status,'mastered')
  assert.deepEqual(graph.nodes[0].layout,{x:0,y:0,level:0})
  assert.equal(graph.nodes[1].gradeLabel,'七年级')
  assert.equal(graph.nodes[2].status,'unknown')
  assert.ok(graph.nodes[1].layout.x < 0)
  assert.ok(graph.nodes[2].layout.x > 0)
  assert.deepEqual(graph.edges.map(e=>[e.from,e.to]),[['a','b'],['b','c'],['b','a']])
})

test('empty relations retain a center and many relations occupy distinct radial positions', () => {
  assert.equal(buildKnowledgeRelationGraph({id:'b',label:'中心'}).nodes.length,1)
  const graph = buildKnowledgeRelationGraph({id:'b',label:'中心',successorLinks:Array.from({length:40},(_,i)=>({id:String(i),label:'长知识点名称'+i}))})
  assert.equal(new Set(graph.nodes.map(n=>`${n.layout.x},${n.layout.y}`)).size,41)
  assert.equal(graph.edges.length,40)
})
