const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const test = require('node:test')

const pagePath = require.resolve('../pages/home/index.js')

test('home is an agent entry with seven tools and member courses below the composer', () => {
  const template = readFileSync(require.resolve('../pages/home/index.wxml'), 'utf8')
  const page = readFileSync(require.resolve('../pages/home/index.js'), 'utf8')

  assert.match(template, /agent-composer/)
  assert.match(template, /bindtap="sendPrompt"/)
  assert.match(template, /agent-tool-item[^>]*wx:for="{{agentTools}}"/)
  assert.match(template, /会员课程/)
  assert.match(page, /agentTools/)
  assert.match(page, /pages\/agent-chat\/index\?prompt=/)
})

function loadPage() {
  delete require.cache[pagePath]

  let definition = null
  const navigations = []
  global.Page = (page) => { definition = page }
  global.wx = {
    navigateTo(options) { navigations.push(options) }
  }
  require(pagePath)

  const instance = {
    data: JSON.parse(JSON.stringify(definition.data)),
    openLearningPlans: definition.openLearningPlans,
    setData(values) { Object.assign(this.data, values) }
  }
  return { definition, instance, navigations }
}

test('home overview navigates to the matching score forecast and learning plan pages', () => {
  const { definition, instance, navigations } = loadPage()
  instance.setData({ plan: { id: '42' } })

  definition.openScoreForecast.call(instance)
  definition.openLearningPlans.call(instance)
  definition.openCurrentPlan.call(instance)

  assert.deepEqual(navigations, [
    { url: '/diagnosis/score-forecast/index' },
    { url: '/diagnosis/plans/index' },
    { url: '/diagnosis/plan-detail/index?planId=42' }
  ])
})

test('home plan card falls back to the plan list when no current plan is available', () => {
  const { definition, instance, navigations } = loadPage()

  definition.openCurrentPlan.call(instance)

  assert.deepEqual(navigations, [{ url: '/diagnosis/plans/index' }])
})

test('home sends the composer prompt to the AI dialogue page with learning context', () => {
  const { definition, instance, navigations } = loadPage()

  instance.setData({ agentPrompt: '我想学会分数加减' })
  definition.sendPrompt.call(instance)

  assert.deepEqual(navigations, [
    { url: '/pages/agent-chat/index?prompt=%E6%88%91%E6%83%B3%E5%AD%A6%E4%BC%9A%E5%88%86%E6%95%B0%E5%8A%A0%E5%87%8F&universe=1' }
  ])

  instance.setData({ includeUniverse: false })
  definition.sendPrompt.call(instance)
  assert.match(navigations[1].url, /&universe=0$/)
})

test('home opens the current assessment workflow through the short assessment page', () => {
  const { definition, instance, navigations } = loadPage()

  instance.setData({ assessment: { id: '51', status: 'analyzing', subjectKey: 'Mathematics' } })
  definition.openAssessmentProgress.call(instance)
  instance.setData({ assessment: { id: '52', status: 'draft', subjectKey: 'Chinese' } })
  definition.openAssessmentProgress.call(instance)

  assert.deepEqual(navigations, [
    { url: '/assessment/short/index' },
    { url: '/assessment/short/index' }
  ])
})
