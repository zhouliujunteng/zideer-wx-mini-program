// 2026-09-25 订单记录、订单详情按设计语言重做：订单记录照「结算明细」+ 课程积分明细条目，
// 订单详情照课程积分页；去掉「查看课程积分」按钮。
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { groupOrdersByMonth, orderDetailView, orderTabsFor } = require('../commerce/order-view')
const paymentSwitchStub = require('./helpers/payment-switch-stub')
const webPayStub = require('./helpers/web-pay-stub')
const miniPayStub = require('./helpers/mini-pay-stub')

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')

const credit = (patch) => ({ id: 1, order_no: 'CL1', title: '体验积分包', order_kind: 'course_credit', status: '已支付', statusLabel: '已支付',
  amount: 9.9, amountDisplay: '9.90', beneficiaryName: '小鹿', created_at: '2026-09-25T10:05:00+08:00', product_version: { credit_amount: '100.00' }, ...patch })

test('order records are grouped by month and filtered by status tab', () => {
  const orders = [
    credit({ id: 3, status: '待支付', statusLabel: '待支付', created_at: '2026-09-25T10:05:00+08:00' }),
    credit({ id: 2, created_at: '2026-09-01T08:00:00+08:00' }),
    credit({ id: 1, status: '已取消', statusLabel: '已关闭', created_at: '2026-08-20T08:00:00+08:00', order_kind: 'library_membership', title: '知鹿会员 · 标准' })
  ]
  const all = groupOrdersByMonth(orders, 'all')
  assert.deepEqual(all.map(group => group.monthLabel), ['2026年9月', '2026年8月'])
  assert.deepEqual(all[0].records.map(record => record.id), ['3', '2'])
  const first = all[0].records[0]
  assert.equal(first.amount, '¥9.90')
  assert.equal(first.detail, '积分包 · 受益学生 小鹿')
  assert.equal(first.time, '09-25 10:05')
  assert.equal(first.tone, 'pending')
  assert.equal(all[1].records[0].tone, 'closed')
  assert.equal(all[1].records[0].detail, '知鹿会员 · 受益学生 小鹿')

  assert.deepEqual(groupOrdersByMonth(orders, '待支付').flatMap(group => group.records.map(record => record.id)), ['3'])
  assert.deepEqual(groupOrdersByMonth(orders, '已支付').flatMap(group => group.records.map(record => record.id)), ['2'])
  assert.deepEqual(orderTabsFor('待支付').map(tab => tab.isSelected), [false, true, false])
})

test('order detail only offers an action when there is something to do, never "view credits"', () => {
  assert.equal(orderDetailView(credit()).action, null)
  assert.deepEqual(orderDetailView(credit({ status: '待支付', statusLabel: '待支付' })).action, { id: 'pay', label: '继续支付' })
  assert.equal(orderDetailView(credit({ status: '已取消', statusLabel: '已关闭' })).action, null)
  assert.equal(orderDetailView(credit({ order_kind: 'library_membership' })).action.id, 'membership')
  for (const file of ['commerce/order-detail/index.wxml', 'commerce/order-detail/index.js', 'commerce/payment-result/index.wxml', 'commerce/order-view.js']) {
    assert.doesNotMatch(read(file), /查看课程积分/, file)
  }
})

test('order detail rows, credit batches and payment come from the real order', () => {
  const view = orderDetailView(credit({
    fulfilled_at: '2026-09-25T10:06:00+08:00',
    batches: [{ id: 8, original_credits: '100.00', remaining_credits: '80.00', active_at: '2026-09-25T10:06:00+08:00', expires_at: null }],
    payment: { statusLabel: '支付成功', grand_total_value: '9.9' }
  }))
  assert.deepEqual(view.rows.map(row => row.label), ['订单编号', '订单类型', '课程积分', '受益学生', '下单时间', '支付时间'])
  assert.equal(view.rows[0].copyable, true)
  assert.equal(view.rows[2].value, '100')
  assert.equal(view.rows[4].value, '2026-09-25 10:05')
  assert.deepEqual(view.batches[0], { id: '8', title: '发放 100 课程积分', meta: '2026年9月25日到账 · 长期有效', remaining: '剩余 80' })
  assert.deepEqual(view.payment.map(row => row.value), ['微信支付', '支付成功', '¥9.90'])
  assert.equal(view.icon, '/assets/commerce/course-points-star-generated.png')
  // 会员订单不显示课程积分行，插画换成会员皇冠；关闭的订单显示关闭时间
  const membership = orderDetailView(credit({ order_kind: 'library_membership', status: '已取消', closed_at: '2026-09-26T08:00:00+08:00' }))
  assert.deepEqual(membership.rows.map(row => row.label), ['订单编号', '订单类型', '受益学生', '下单时间', '关闭时间'])
  assert.equal(membership.icon, '/assets/me/membership-crown-matte.png')
})

test('continuing payment from order detail goes home once paid', async () => {
  let definition
  const switched = []
  const wx = {
    showToast() {}, switchTab(options) { switched.push(options.url) },
    getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 44 }),
    getMenuButtonBoundingClientRect: () => ({ top: 50, height: 32 })
  }
  vm.runInNewContext(read('commerce/order-detail/index.js'), {
    Page(page) { definition = page }, wx, getCurrentPages: () => [],
    require(name) {
      if (name.endsWith('/identity')) return { loadOrderDetail: async () => credit({ status: '待支付', statusLabel: '待支付' }), payWechatOrder: async () => ({}), isWechatPaymentCancelled: () => false }
      if (name.endsWith('/ui-assets')) return { attachUiAssets() {} }
      if (name.endsWith('/utils/screen')) return require('../utils/screen')
      if (name.endsWith('/order-view')) return require('../commerce/order-view')
      if (name.endsWith('/payment-done')) {
        const module = { exports: {} }
        vm.runInNewContext(read('commerce/payment-done.js'), { module, wx })
        return module.exports
      }
      if (name.endsWith('/payment-switch')) return paymentSwitchStub(wx)
      if (name.endsWith('/web-pay')) return webPayStub(wx)
      if (name.endsWith('/mini-pay')) return miniPayStub(() => ({ payWechatOrder: async () => ({}) }), webPayStub(wx))
      throw new Error(`Unexpected import ${name}`)
    }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch) } }
  page.onLoad({ orderId: '1' })
  await page.loadPage()
  assert.equal(page.data.view.action.id, 'pay')
  await page.handleAction()
  assert.deepEqual(switched, ['/pages/home/index'])
})

test('Android: continuing payment from order detail opens web payment', async () => {
  let definition
  let paid = 0
  const opened = []
  const wx = {
    showToast() {}, switchTab() {}, navigateTo(options) { opened.push(options.url) },
    getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 44 }),
    getMenuButtonBoundingClientRect: () => ({ top: 50, height: 32 })
  }
  vm.runInNewContext(read('commerce/order-detail/index.js'), {
    Page(page) { definition = page }, wx, getCurrentPages: () => [],
    require(name) {
      if (name.endsWith('/identity')) return { loadOrderDetail: async () => credit({ status: '待支付', statusLabel: '待支付' }), payWechatOrder: async () => { paid += 1 }, isWechatPaymentCancelled: () => false }
      if (name.endsWith('/ui-assets')) return { attachUiAssets() {} }
      if (name.endsWith('/utils/screen')) return require('../utils/screen')
      if (name.endsWith('/order-view')) return require('../commerce/order-view')
      if (name.endsWith('/payment-done')) return { goHomeAfterCreditPayment() {} }
      if (name.endsWith('/payment-switch')) return paymentSwitchStub(wx)
      if (name.endsWith('/web-pay')) return webPayStub(wx, { android: true })
      if (name.endsWith('/mini-pay')) return miniPayStub(() => ({ payWechatOrder: async () => { paid += 1 } }), webPayStub(wx, { android: true }))
      throw new Error(`Unexpected import ${name}`)
    }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch) } }
  page.onLoad({ orderId: '1' })
  await page.loadPage()
  await page.handleAction()
  assert.equal(paid, 0)
  assert.equal(opened.length, 1)
  assert.match(opened[0], /^\/commerce\/web-pay\/index\?orderId=[1-9][0-9]*&kind=credit$/)
})

test('order pages use the designer page shells instead of the old placeholder styles', () => {
  for (const name of ['orders', 'order-detail']) {
    assert.equal(JSON.parse(read(`commerce/${name}/index.json`)).navigationStyle, 'custom', name)
    const wxss = read(`commerce/${name}/index.wxss`)
    assert.doesNotMatch(wxss, /account-form\.wxss/, name)
    assert.doesNotMatch(read(`commerce/${name}/index.wxml`), /surface|state-panel/, name)
  }
  // 订单记录：结算明细的页签与列表卡
  const orders = read('commerce/orders/index.wxss')
  assert.match(orders, /\.orders-tabs \{[^}]*background: #EEF1EF/)
  assert.match(orders, /\.orders-module \{[^}]*border-radius: 40rpx/)
})
