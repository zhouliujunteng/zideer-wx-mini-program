const assert = require('node:assert/strict')
const test = require('node:test')

const pagePath = require.resolve('../pages/learning/index.js')

function loadPage() {
  delete require.cache[pagePath]
  let definition = null
  const navigations = []
  global.Page = (page) => { definition = page }
  global.wx = { navigateTo(options) { navigations.push(options) } }
  require(pagePath)
  const instance = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(values) { Object.assign(this.data, values) }
  }
  return { definition, instance, navigations }
}

test('learning task opens its live generation state without trusting a client course id', () => {
  const { definition, instance, navigations } = loadPage()
  instance.setData({ dashboard: { currentTask: { id: '6', generationCourseInstanceId: '11' } } })

  definition.openTask.call(instance, { currentTarget: { dataset: { id: '6' } } })
  definition.openTask.call(instance, { currentTarget: { dataset: { id: '7' } } })

  assert.deepEqual(navigations, [
    { url: '/learning/generation-status/index?planItemId=6&courseInstanceId=11' },
    { url: '/learning/generation-status/index?planItemId=7&courseInstanceId=' }
  ])
})
