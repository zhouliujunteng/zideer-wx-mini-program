const assert = require('node:assert/strict')
const test = require('node:test')

const identity = require('../services/identity')
const basicPath = require.resolve('../assessment/basic/index.js')
const analysisPath = require.resolve('../assessment/analysis/index.js')

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

test('completed basic assessment opens analysis instead of optional score entry', async () => {
  const originalSubmit = identity.submitCurrentBasicAssessment
  identity.submitCurrentBasicAssessment = async () => ({ status: 'completed' })
  delete require.cache[basicPath]

  let definition = null
  const redirects = []
  global.Page = (page) => { definition = page }
  global.wx = {
    showModal(options) { options.success() },
    redirectTo(options) { redirects.push(options) },
    showToast() {}
  }
  require(basicPath)
  identity.submitCurrentBasicAssessment = originalSubmit

  const instance = {
    data: { ...clone(definition.data), attempt: { id: '51' } },
    setData(values) { Object.assign(this.data, values) }
  }
  await definition.submitAssessment.call(instance)

  assert.deepEqual(redirects, [{ url: '/assessment/analysis/index?attemptId=51' }])
})

test('completed analysis exposes its report and optional evidence entry', async () => {
  const originalCenter = identity.loadAssessmentCenter
  identity.loadAssessmentCenter = async () => ({
    attempts: [{ id: '51', status: 'completed', statusLabel: '诊断已完成', subjectName: '数学', templateTitle: '基础测评' }]
  })
  delete require.cache[analysisPath]

  let definition = null
  const navigations = []
  const redirects = []
  global.Page = (page) => { definition = page }
  global.wx = {
    navigateTo(options) { navigations.push(options) },
    redirectTo(options) { redirects.push(options) },
    showToast() {}
  }
  require(analysisPath)
  identity.loadAssessmentCenter = originalCenter

  const instance = {
    data: { ...clone(definition.data), attemptId: '51' },
    setData(values) { Object.assign(this.data, values) }
  }
  await definition.loadStatus.call(instance)
  definition.goHistory.call(instance)
  definition.openSupplement.call(instance)

  assert.equal(instance.data.analysisReady, true)
  assert.equal(instance.data.canViewReport, true)
  assert.deepEqual(redirects, [{ url: '/diagnosis/report/index' }])
  assert.deepEqual(navigations, [{ url: '/assessment/recent-score/index?attemptId=51' }])
})
