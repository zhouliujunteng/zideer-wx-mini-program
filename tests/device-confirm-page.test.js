const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

function setup(approve = async () => true) {
  let definition
  const modals = [], requests = [], changes = []
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../learning/device-confirm/index.js'), 'utf8'), {
    Page(value) { definition = value },
    require() { return { approveCourseDevice(code) { requests.push(code); return approve(code) } } },
    wx: { showModal(options) { modals.push(options) } }
  })
  const page = { ...definition, data: { ...definition.data }, setData(values) { changes.push(values); Object.assign(this.data, values) } }
  page.onLoad({ code: 'ABCD1234EF56' })
  return { page, modals, requests, changes }
}

test('pasted grouped device code preserves all twelve characters', () => {
  const { page } = setup()
  const template = fs.readFileSync(path.join(__dirname, '../learning/device-confirm/index.wxml'), 'utf8')
  const limit = Number(template.match(/maxlength="(\d+)"/)[1])
  page.changeCode({ detail: { value: 'abcd 1234 ef56'.slice(0, limit) } })
  assert.equal(page.data.code, 'ABCD1234EF56')
})

test('only one modal and approval can be in flight, using the code the user confirmed', async () => {
  const { page, modals, requests } = setup()
  const pending = page.approve()
  const repeated = page.approve()
  assert.equal(modals.length, 1)
  page.changeCode({ detail: { value: '111122223333' } })
  modals[0].success({ confirm: true })
  await pending; await repeated
  assert.deepEqual(requests, ['ABCD1234EF56'])
  assert.equal(page.data.approved, true)
  assert.equal(page.data.busy, false)
})

test('cancelled and failed modals unlock without sending approval', async () => {
  const { page, modals, requests } = setup()
  const cancelled = page.approve()
  modals[0].success({ confirm: false }); await cancelled
  assert.equal(page.data.busy, false)
  const failed = page.approve()
  modals[1].fail(); await failed
  assert.equal(page.data.busy, false)
  assert.deepEqual(requests, [])
})

test('closing the page while its modal is open cannot later authorize a device', async () => {
  const { page, modals, requests, changes } = setup()
  const pending = page.approve()
  page.onUnload?.()
  const count = changes.length
  modals[0].success({ confirm: true }); await pending
  assert.deepEqual(requests, [])
  assert.equal(changes.length, count)
})

test('a late network response cannot update an unloaded confirmation page', async () => {
  let finish
  const { page, modals, changes } = setup(() => new Promise(resolve => { finish = resolve }))
  const pending = page.approve()
  modals[0].success({ confirm: true })
  await Promise.resolve()
  page.onUnload?.()
  const count = changes.length
  finish(true); await pending
  assert.equal(changes.length, count)
})

test('server denial stays visible and a deliberate retry can succeed', async () => {
  let denied = true
  const { page, modals } = setup(async () => { if (denied) throw new Error('No course access') })
  const first = page.approve(); modals[0].success({ confirm: true }); await first
  assert.equal(page.data.approved, false)
  assert.equal(page.data.busy, false)
  assert.equal(page.data.error, 'No course access')
  denied = false
  const retry = page.approve(); modals[1].success({ confirm: true }); await retry
  assert.equal(page.data.approved, true)
  assert.equal(page.data.error, '')
})

test('changed account cannot receive the old account approval success', async () => {
  let token = 'first-account', request
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/identity.js'), 'utf8'), {
    module, require() { return { ...require('../config/index'), COURSE_PORTAL_ORIGIN: 'https://course.example' } },
    wx: { getStorageSync() { return token }, request(options) { if (!require('./helpers/verified-phone-session')(options)) request = options } }
  })
  const pending = module.exports.approveCourseDevice('ABCD 1234 EF56')
  await new Promise(setImmediate)
  assert.equal(request.data.code, 'ABCD1234EF56')
  assert.equal(request.header.authorization, 'Bearer first-account')
  token = 'second-account'
  request.success({ statusCode: 200, data: { approved: true } })
  await assert.rejects(pending, /账号已变化/)
})

test('WeChat request domain restrictions are reported separately from connectivity errors', async () => {
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/identity.js'), 'utf8'), {
    module, require() { return { ...require('../config/index'), COURSE_PORTAL_ORIGIN: 'https://course.example' } },
    wx: { getStorageSync() { return 'test-account' }, request(options) {
      if (!require('./helpers/verified-phone-session')(options)) options.fail({ errMsg: 'request:fail url not in domain list' })
    } }
  })
  await assert.rejects(module.exports.approveCourseDevice('ABCD1234EF56'), /request 合法域名/)
})
