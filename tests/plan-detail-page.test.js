const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

function plans(status = 'generating') {
  return { plans: [{ id: 'plan-1', name: 'Plan', items: [{ id: 'item/1', status: 'available',
    statusLabel: 'Available', courseInstances: [{ status, contentVersionRef: 'lesson' }] }] }] }
}

function setup(load = async () => plans()) {
  let definition
  const notices = [], navigations = [], service = { load }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../diagnosis/plan-detail/index.js'), 'utf8'), {
    Page(value) { definition = value },
    require(name) {
      if (name === '../../utils/course-state') return require('../utils/course-state')
      return { loadCurrentLearningPlans: () => service.load() }
    },
    wx: { showToast(value) { notices.push(value.title) }, navigateBack(value) { value.fail() },
      switchTab(value) { navigations.push(value.url) } }
  })
  const page = { ...definition, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch) } }
  page.onLoad({ planId: 'plan-1' })
  return { page, service, notices, navigations }
}

test('returning to a plan refreshes its task status and preserves the task entry', async () => {
  const { page, service } = setup()
  await page.onShow()
  assert.equal(page.data.plan.items[0].taskStatusLabel, require('../utils/course-state').courseGenerationState({ status: 'generating' }).label)
  assert.equal(page.data.plan.items[0].generationUrl, '/learning/generation-status/index?planItemId=item%2F1')
  page.onHide()
  service.load = async () => plans('ready')
  await page.onShow()
  assert.equal(page.data.plan.items[0].taskStatusLabel, require('../utils/course-state').courseGenerationState({ status: 'ready', contentVersionRef: 'lesson' }).label)
  assert.equal(page.data.loading, false)
})

test('hidden plan pages ignore late replies and older replies cannot overwrite a newer load', async () => {
  const replies = []
  const { page } = setup(() => new Promise(resolve => replies.push(resolve)))
  const old = page.onShow()
  page.onHide()
  const latest = page.onShow()
  replies[1](plans('ready')); await latest
  const current = page.data.plan
  replies[0](plans('generating')); await old
  assert.equal(page.data.plan, current)
  const hidden = page.loadPlan()
  page.onUnload()
  replies[2](plans('failed')); await hidden
  assert.equal(page.data.plan, current)
})

test('missing plans and network errors have a retry path using the original plan id', async () => {
  const { page, service } = setup(async () => ({ plans: [] }))
  await page.onShow()
  assert.equal(page.data.failed, true)
  service.load = async () => { throw new Error('offline') }
  await page.loadPlan({ type: 'tap' })
  assert.equal(page.data.failed, true)
  service.load = async () => plans('ready')
  await page.loadPlan({ type: 'tap' })
  assert.equal(page.data.failed, false)
  assert.equal(page.data.plan.id, 'plan-1')
})

test('missing plan parameter returns to learning without reading another plan', async () => {
  const { page, navigations } = setup(() => { throw new Error('must not load') })
  page.onLoad({})
  await page.onShow()
  assert.deepEqual(navigations, ['/pages/learning/index'])
})
