// 「加导师妈妈微信」弹窗（2026-11-12 用户规则）：每次进小程序查一次；只有课程服务说该弹（付款的家长、导师接了单、
// 传了二维码、还没「已加微信」）才弹；没登录、读不到都不弹。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')

function mount({ session = true, contact = { show: true, orderId: '501', mentorName: '李导师' }, fails = false } = {}) {
  let definition
  const app = { globalData: { mentorContactPending: true } }
  const calls = { load: 0, download: 0, previews: [] }
  vm.runInNewContext(read('components/mentor-contact-popup/index.js'), {
    Component: (value) => { definition = value },
    getApp: () => app,
    wx: { previewImage: (o) => calls.previews.push(o) },
    require: () => ({
      hasSession: () => session,
      loadMentorContact: async () => { calls.load++; if (fails) throw new Error('down'); return contact },
      downloadMentorContactQr: async (orderId) => { calls.download++; return `/user/mentor-contact-${orderId}.jpg` }
    })
  })
  const component = { ...definition.methods, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch) } }
  return { component, app, calls, definition }
}

test('pops once per entry with the mentor mom QR; the next tab page does not ask again', async () => {
  const { component, app, calls } = mount()
  await component.check()
  assert.equal(component.data.visible, true)
  assert.equal(component.data.mentorName, '李导师')
  assert.equal(component.data.qrPath, '/user/mentor-contact-501.jpg')
  await component.check()
  assert.equal(calls.load, 1)
  // 下一次进入小程序（app.js onShow 重新挂上）才再查
  app.globalData.mentorContactPending = true
  await component.check()
  assert.equal(calls.load, 2)
  component.close()
  assert.equal(component.data.visible, false)
  component.data.qrPath = '/user/mentor-contact-501.jpg'
  component.preview()
  assert.equal(calls.previews[0].showmenu, true)
})

test('nothing pops when signed out, when the course service says no, or when it cannot be read', async () => {
  for (const options of [{ session: false }, { contact: { show: false } }, { fails: true }]) {
    const { component, calls } = mount(options)
    await component.check()
    assert.equal(component.data.visible, false, JSON.stringify(options))
    assert.equal(calls.download, 0)
  }
})

test('the popup is on all five tab pages, registered globally, and armed on every app show', () => {
  const app = JSON.parse(read('app.json'))
  assert.equal(app.usingComponents['mentor-contact-popup'], '/components/mentor-contact-popup/index')
  for (const page of app.tabBar.list.map((item) => item.pagePath)) assert.match(read(`${page}.wxml`), /<mentor-contact-popup \/>/, page)
  assert.match(read('app.js'), /onShow\(options\) \{[\s\S]*?this\.globalData\.mentorContactPending = true/)
  assert.match(read('components/mentor-contact-popup/index.wxml'), /show-menu-by-longpress/)
})
