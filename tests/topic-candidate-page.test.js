const assert = require('node:assert/strict')
const test = require('node:test')

const identity = require('../services/identity')
const pagePath = require.resolve('../diagnosis/topic/index.js')

function loadPage({ candidateState, addResult = { status: 'added' } }) {
  const original = {
    add: identity.addCurrentTopicCandidate,
    candidates: identity.loadCurrentTopicCandidates,
    map: identity.loadKnowledgeMap,
    remove: identity.removeCurrentTopicCandidate
  }
  const calls = []
  const toasts = []
  identity.loadKnowledgeMap = async () => ({
    nodes: [{ id: 81, label: '一次函数', status: 'unknown', statusLabel: '待测', evidence: '暂无', prerequisites: '无', contribution: '待测' }]
  })
  identity.loadCurrentTopicCandidates = async () => candidateState
  identity.addCurrentTopicCandidate = async (topicId) => {
    calls.push({ type: 'add', topicId })
    return addResult
  }
  identity.removeCurrentTopicCandidate = async (topicId) => {
    calls.push({ type: 'remove', topicId })
    return { status: 'removed' }
  }
  delete require.cache[pagePath]
  let definition = null
  global.Page = (page) => { definition = page }
  global.wx = { showToast(options) { toasts.push(options) }, navigateBack() {} }
  require(pagePath)
  Object.assign(identity, {
    addCurrentTopicCandidate: original.add,
    loadCurrentTopicCandidates: original.candidates,
    loadKnowledgeMap: original.map,
    removeCurrentTopicCandidate: original.remove
  })

  const instance = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(values) { Object.assign(this.data, values) }
  }
  instance.loadCandidateState = definition.loadCandidateState
  instance.toggleCandidate = definition.toggleCandidate
  return { definition, instance, calls, toasts }
}

test('topic page removes an existing candidate and restores it through the current-user flows', async () => {
  const { definition, instance, calls, toasts } = loadPage({
    candidateState: { status: 'ready', candidates: [{ topicId: '81', status: 'active' }] },
    addResult: { status: 'reactivated' }
  })

  await definition.loadTopic.call(instance, '81', 'Mathematics')
  assert.equal(instance.data.candidateActive, true)

  await definition.toggleCandidate.call(instance)
  assert.deepEqual(calls, [{ type: 'remove', topicId: 81 }])
  assert.equal(instance.data.candidateActive, false)
  assert.equal(toasts.at(-1).title, '已移出候选')

  await definition.toggleCandidate.call(instance)
  assert.deepEqual(calls, [{ type: 'remove', topicId: 81 }, { type: 'add', topicId: 81 }])
  assert.equal(instance.data.candidateActive, true)
  assert.equal(toasts.at(-1).title, '已恢复到候选')
})

test('topic page asks for profile completion without attempting a candidate write', async () => {
  const { definition, instance, calls, toasts } = loadPage({
    candidateState: { status: 'profile_incomplete', candidates: [] }
  })

  await definition.loadTopic.call(instance, '81', 'Mathematics')
  await definition.toggleCandidate.call(instance)

  assert.deepEqual(calls, [])
  assert.match(toasts.at(-1).title, /完善学习档案/)
})
