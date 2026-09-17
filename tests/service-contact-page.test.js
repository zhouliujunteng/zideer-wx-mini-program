const assert = require('node:assert/strict')
const test = require('node:test')

const identity = require('../services/identity')
const pagePath = require.resolve('../account/service-contact/index.js')

function loadPageWithContacts(result, { chatError } = {}) {
  const original = identity.loadCurrentServiceContacts
  identity.loadCurrentServiceContacts = async () => result
  delete require.cache[pagePath]

  let definition = null
  const toasts = []
  const chats = []
  global.Page = (page) => { definition = page }
  global.wx = {
    showToast(options) { toasts.push(options) },
    stopPullDownRefresh() {},
    openCustomerServiceChat(options) {
      chats.push(options)
      if (chatError) options.fail(chatError)
      else options.success({ errMsg: 'openCustomerServiceChat:ok' })
    }
  }
  require(pagePath)
  identity.loadCurrentServiceContacts = original

  const instance = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(values) { Object.assign(this.data, values) }
  }
  return { definition, instance, toasts, chats }
}

test('service contact page opens a selected backend-issued enterprise WeChat chat', async () => {
  const { definition, instance, toasts, chats } = loadPageWithContacts({
    status: 'ready',
    contacts: [{
      id: 'contact-1',
      title: '课程顾问',
      corpId: 'ww1234567890abcdef',
      targetRef: 'https://work.weixin.qq.com/kfid/kfc1234567890abcdef'
    }]
  })

  await definition.loadPage.call(instance)
  assert.equal(instance.data.contacts.length, 1)

  await definition.openContact.call(instance, { currentTarget: { dataset: { id: 'contact-1' } } })
  assert.equal(chats.length, 1)
  assert.equal(chats[0].corpId, 'ww1234567890abcdef')
  assert.deepEqual(chats[0].extInfo, { url: 'https://work.weixin.qq.com/kfid/kfc1234567890abcdef' })
  assert.equal(instance.data.openingContactId, '')
  assert.equal(toasts.length, 0)

  instance.data.contacts = [{ id: 'invalid', title: '失效入口', corpId: '', targetRef: 'https://work.weixin.qq.com/kfid/kfc-invalid' }]
  await definition.openContact.call(instance, { currentTarget: { dataset: { id: 'invalid' } } })
  assert.equal(chats.length, 1)
  assert.match(toasts.at(-1).title, /已失效/)
})

test('service contact page reports a native chat launch failure and allows retry', async () => {
  const { definition, instance, toasts, chats } = loadPageWithContacts({
    status: 'ready',
    contacts: [{ id: 'contact-1', title: '课程顾问', corpId: 'ww1234567890abcdef', targetRef: 'https://work.weixin.qq.com/kfid/kfc1234567890abcdef' }]
  }, { chatError: { errMsg: 'openCustomerServiceChat:fail cancel' } })

  await definition.loadPage.call(instance)
  await definition.openContact.call(instance, { currentTarget: { dataset: { id: 'contact-1' } } })

  assert.equal(chats.length, 1)
  assert.equal(instance.data.openingContactId, '')
  assert.match(toasts.at(-1).title, /未打开/)
})

test('service contact page renders profile-incomplete state without opening a WebView', async () => {
  const { definition, instance } = loadPageWithContacts({ status: 'profile_incomplete', contacts: [] })
  await definition.loadPage.call(instance)
  assert.equal(instance.data.profileIncomplete, true)
  assert.deepEqual(instance.data.contacts, [])
  assert.equal(instance.data.openingContactId, '')
})
