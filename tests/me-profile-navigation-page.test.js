const assert = require('node:assert/strict')
const test = require('node:test')

const pagePath = require.resolve('../pages/me/index.js')

function loadPage() {
  delete require.cache[pagePath]
  let definition = null
  const navigations = []
  global.Page = (page) => { definition = page }
  global.getApp = () => ({ globalData: {} })
  global.wx = { navigateTo: (options) => navigations.push(options), showToast() {} }
  require(pagePath)
  return { definition, navigations }
}

test('profile header and learning profile entry both open the editable learning profile', () => {
  const { definition, navigations } = loadPage()
  const instance = { data: {}, setData() {} }

  definition.handleEntry.call(instance, { currentTarget: { dataset: { id: 'learningProfile' } } })

  assert.deepEqual(navigations, [{ url: '/pages/profile-setup/index?edit=1' }])
})
