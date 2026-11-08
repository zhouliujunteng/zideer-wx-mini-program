const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

// 兑换码页的兑换记录（2026-10-06）：输入兑换码不能把记录冲成占位文字；超过 3 条才有「全部记录」，点了能展开 / 收起。

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')

function record(id, extra = {}) {
  return { id, status: 'succeeded', statusLabel: '兑换成功', benefits: { course_credit: 100 * id }, code_masked: `ZL-****${id}`, redeemed_at: `2026-10-0${id}T08:00:00Z`, ...extra }
}

function loadPage(records) {
  let definition
  vm.runInNewContext(read('pages/redemption/index.js'), {
    Page(value) { definition = value },
    getCurrentPages: () => [],
    setTimeout, clearTimeout,
    wx: { showToast() {} },
    require(name) {
      if (name.endsWith('/services/identity')) return { loadCurrentGrowthCenter: async () => ({ student: { id: 7 }, redemptionRecords: records }) }
      if (name.endsWith('/services/ui-assets')) return { attachUiAssets() {} }
      throw new Error(`Unexpected import ${name}`)
    }
  })
  return { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch) } }
}

test('typing a code keeps every record readable instead of resetting it to placeholder copy', async () => {
  const page = loadPage([record(1), record(2, { benefits: { coin: 50 } })])
  await page.loadPage()
  page.handleInput({ detail: { value: 'a' } })
  page.handleInput({ detail: { value: 'ab' } })
  assert.deepEqual(page.data.model.history.map((item) => item.title), ['课程积分 +100', '金币 +50'])
  assert.deepEqual(page.data.model.history.map((item) => item.code), ['兑换码 ZL-****1', '兑换码 ZL-****2'])
  assert.equal(page.data.model.history[0].time, '2026.10.01')
  assert.equal(page.data.model.inputValue, 'AB')
})

test('more than three records collapse behind 全部记录 and expand on tap', async () => {
  const page = loadPage([1, 2, 3, 4, 5].map((id) => record(id)))
  await page.loadPage()
  assert.equal(page.data.model.historyCountLabel, '共 5 条')
  assert.equal(page.data.model.historyActionLabel, '全部记录')
  assert.equal(page.data.model.history.length, 3)
  page.toggleHistory()
  assert.equal(page.data.model.history.length, 5)
  assert.equal(page.data.model.historyActionLabel, '收起')
  page.handleInput({ detail: { value: 'x' } })
  assert.equal(page.data.model.history.length, 5, '输入兑换码不收起已展开的记录')
  page.toggleHistory()
  assert.equal(page.data.model.history.length, 3)
})

test('three or fewer records have no dead 全部记录 link, and an empty list has no count label', async () => {
  const few = loadPage([record(1, { status: 'failed', statusLabel: '兑换失败' })])
  await few.loadPage()
  assert.equal(few.data.model.historyActionLabel, '')
  assert.equal(few.data.model.history[0].statusTone, 'failed')
  const none = loadPage([])
  await none.loadPage()
  assert.equal(none.data.model.historyCountLabel, '')
  const wxml = read('pages/redemption/index.wxml')
  assert.match(wxml, /bindtap="toggleHistory"/)
  assert.match(wxml, /还没有兑换记录/)
})
