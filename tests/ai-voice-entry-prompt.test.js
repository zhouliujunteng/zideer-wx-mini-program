const assert = require('node:assert/strict')
const test = require('node:test')

const pagePath = require.resolve('../pages/ai-voice/index.js')

function loadPage() {
  delete require.cache[pagePath]

  let definition = null
  global.Page = (page) => { definition = page }
  global.wx = {
    getWindowInfo() {
      return {
        windowWidth: 375,
        windowHeight: 667,
        statusBarHeight: 20,
        screenHeight: 667,
        safeArea: { bottom: 667 }
      }
    },
    getMenuButtonBoundingClientRect() {
      return { left: 276, top: 26, width: 87, height: 32 }
    }
  }
  require(pagePath)
  return definition
}

test('AI dialogue restores the original homepage prompt after navigation encoding', () => {
  const definition = loadPage()
  const instance = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(values) { Object.assign(this.data, values) }
  }

  definition.onLoad.call(instance, { prompt: encodeURIComponent('我想学会分数加减') })

  assert.equal(instance.data.model.conversation.messages[0].text, '我想学会分数加减')
})
