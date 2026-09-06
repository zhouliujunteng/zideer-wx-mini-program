const assert = require('node:assert/strict')
const test = require('node:test')

const identity = require('../services/identity')
const pagePath = require.resolve('../pages/knowledge-map/index.js')

function loadPage() {
  const original = identity.loadKnowledgeMap
  identity.loadKnowledgeMap = async () => ({
    subjects: [{ key: 'Mathematics', name: '数学' }],
    activeSubject: '数学',
    activeSubjectKey: 'Mathematics',
    grade: '七年级',
    stats: { mastered: 0, learning: 0, weak: 0, unknown: 1 },
    nodes: [{ id: '81', label: '一次函数' }],
    edges: []
  })
  delete require.cache[pagePath]

  let definition = null
  const navigations = []
  global.getApp = () => ({ globalData: { navigation: {} } })
  global.Page = (page) => { definition = page }
  global.wx = {
    navigateTo(options) { navigations.push(options) },
    showToast() {}
  }
  require(pagePath)
  identity.loadKnowledgeMap = original

  const instance = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(values) { Object.assign(this.data, values) }
  }
  return { definition, instance, navigations }
}

test('knowledge map opens the current node detail and has no obsolete candidate placeholder action', () => {
  const { definition, instance, navigations } = loadPage()
  instance.setData({ selectedNode: { id: '81' }, activeSubjectKey: 'Mathematics' })

  definition.openTopicDetail.call(instance)

  assert.deepEqual(navigations, [{
    url: '/diagnosis/topic/index?topicId=81&subjectKey=Mathematics'
  }])
  assert.equal(definition.addToPlan, undefined)
})

test('knowledge map does not navigate when no node is selected', () => {
  const { definition, instance, navigations } = loadPage()

  definition.openTopicDetail.call(instance)

  assert.deepEqual(navigations, [])
})
