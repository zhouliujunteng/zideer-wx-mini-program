const assert = require('node:assert/strict')
const test = require('node:test')

const identity = require('../services/identity')
const pagePath = require.resolve('../account/service-contact/index.js')

function loadPageWithContacts(result) {
  const original = identity.loadCurrentServiceContacts
  identity.loadCurrentServiceContacts = async () => result
  delete require.cache[pagePath]

  let definition = null
  const toasts = []
  global.Page = (page) => { definition = page }
  global.wx = {
    showToast(options) { toasts.push(options) },
    stopPullDownRefresh() {}
  }
  require(pagePath)
  identity.loadCurrentServiceContacts = original

  const instance = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(values) { Object.assign(this.data, values) }
  }
  return { definition, instance, toasts }
}

test('service contact page only opens a selected backend-issued HTTPS contact', async () => {
  const { definition, instance, toasts } = loadPageWithContacts({
    status: 'ready',
    contacts: [{ id: 'contact-1', title: '课程顾问', targetRef: 'https://service.example.com/contact' }]
  })

  await definition.loadPage.call(instance)
  assert.equal(instance.data.contacts.length, 1)

  definition.openContact.call(instance, { currentTarget: { dataset: { id: 'contact-1' } } })
  assert.equal(instance.data.selectedUrl, 'https://service.example.com/contact')

  definition.closeWebView.call(instance)
  assert.equal(instance.data.selectedUrl, '')

  instance.data.contacts = [{ id: 'invalid', title: '失效入口', targetRef: 'http://service.example.com/contact' }]
  definition.openContact.call(instance, { currentTarget: { dataset: { id: 'invalid' } } })
  assert.equal(instance.data.selectedUrl, '')
  assert.match(toasts.at(-1).title, /已失效/)
})

test('service contact page renders profile-incomplete state without opening a WebView', async () => {
  const { definition, instance } = loadPageWithContacts({ status: 'profile_incomplete', contacts: [] })
  await definition.loadPage.call(instance)
  assert.equal(instance.data.profileIncomplete, true)
  assert.deepEqual(instance.data.contacts, [])
  assert.equal(instance.data.selectedUrl, '')
})
