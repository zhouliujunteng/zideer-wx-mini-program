const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const test = require('node:test')

test('the primary tab keeps the learning universe and knowledge graph as switchable views', () => {
  const app = JSON.parse(readFileSync(require.resolve('../app.json'), 'utf8'))
  const tab = app.tabBar.list.find(item => item.pagePath === 'pages/knowledge-map/index')
  const template = readFileSync(require.resolve('../pages/knowledge-map/index.wxml'), 'utf8')
  const page = readFileSync(require.resolve('../pages/knowledge-map/index.js'), 'utf8')

  assert.equal(tab.text, '宇宙')
  assert.match(template, /学习宇宙/)
  assert.match(template, /知识图谱/)
  assert.match(template, /data-view="universe"/)
  assert.match(template, /data-view="graph"/)
  assert.match(page, /activeView: 'universe'/)
  assert.match(page, /switchMapView/)
  assert.match(page, /测评证据/)
  assert.match(page, /课程证据/)
})

test('AI acceptance tells the learner when a point enters the universe', () => {
  const result = readFileSync(require.resolve('../learning/acceptance-result/index.wxml'), 'utf8')
  const entry = readFileSync(require.resolve('../learning/acceptance-entry/index.wxml'), 'utf8')

  assert.match(result, /已进入你的学习宇宙/)
  assert.match(entry, /AI 验收通过后/)
  assert.doesNotMatch(result, /智能初评不会直接形成/)
})
