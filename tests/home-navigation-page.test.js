const assert = require('node:assert/strict')
const test = require('node:test')

const pagePath = require.resolve('../pages/home/index.js')

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
