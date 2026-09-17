const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path')
const draft = () => ({ revision: 'r1', title: '电子转移', mode: 'course', outlines: [
  { id: 's1', type: 'slide', title: '讲解', description: '说明', keyPoints: ['电子守恒'], order: 1 },
  { id: 'a1', type: 'interactive', title: '实验', description: '说明', keyPoints: [], order: 2, widgetOutline: { concept: '电子' } }
] })
function setup(overrides = {}) {
  let definition
  const sent = [], modals = []
  const service = { loadCourseOutline: async () => ({ outlineDraft: draft() }), saveCourseOutline: async (id, value, confirm) => {
    sent.push({ id, value, confirm }); return { outlineDraft: { ...value, revision: confirm ? value.revision : 'r2', ...(confirm ? { confirmedAt: 'now' } : {}) } }
  }, ...overrides }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../learning/outline/index.js'), 'utf8'), { Page(value) { definition = value }, require: () => service, wx: { showToast() {}, showModal(value) { modals.push(value) }, navigateBack() {}, enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {} } })
  const page = { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value) } }
  return { page, sent, service, modals }
}
test('editing and reordering keep interaction config, and a save adopts the new revision', async () => {
  const { page, sent } = setup(); await page.onLoad({ courseInstanceId: '9' })
  page.moveChapter({ currentTarget: { dataset: { id: 'a1', direction: -1 } } })
  page.updateChapter({ currentTarget: { dataset: { id: 'a1', field: 'title' } }, detail: { value: '新实验' } })
  await page.saveDraft()
  assert.equal(sent[0].value.outlines[0].widgetOutline.concept, '电子')
  assert.equal(sent[0].value.outlines[0].title, '新实验')
  assert.equal(page.data.draft.revision, 'r2'); assert.equal(page.data.dirty, false)
})
test('blank chapters block confirmation and repeated taps cannot submit twice', async () => {
  let resolve, count = 0
  const { page } = setup({ saveCourseOutline: (_id, value) => { count++; return new Promise(done => { resolve = () => done({ outlineDraft: { ...value, confirmedAt: 'now' } }) }) } })
  await page.onLoad({ courseInstanceId: '9' }); page.addChapter(); await page.confirmGeneration()
  assert.equal(count, 0); assert.match(page.data.errorMessage, /标题/)
  page.removeChapter({ currentTarget: { dataset: { id: page.data.draft.outlines[2].id } } })
  const pending = page.confirmGeneration(); await page.confirmGeneration(); assert.equal(count, 1)
  resolve(); await pending; assert.equal(page.data.completed, true)
})
test('a failed save preserves local edits and stale reads cannot overwrite an unloaded page', async () => {
  const { page } = setup({ saveCourseOutline: async () => { throw new Error('网络中断') } })
  await page.onLoad({ courseInstanceId: '9' }); page.updateTitle({ detail: { value: '本地标题' } }); await page.saveDraft()
  assert.equal(page.data.draft.title, '本地标题'); assert.equal(page.data.dirty, true)
  let resolve; const other = setup({ loadCourseOutline: () => new Promise(done => { resolve = done }) }).page
  const loading = other.onLoad({ courseInstanceId: '9' }); other.onUnload(); resolve({ outlineDraft: draft() }); await loading
  assert.equal(other.data.draft, null)
})
test('cancelling while hidden clears the saving lock and shows stopped state on return', async () => {
  let resolve
  const { page, modals } = setup({ cancelCourseOutline: () => new Promise(done => { resolve = done }) })
  await page.onLoad({ courseInstanceId: '9' }); page.cancelGeneration()
  const pending = modals[0].success({ confirm: true }); page.onHide(); resolve(); await pending; page.onShow()
  assert.equal(page.data.saving, false); assert.equal(page.data.stopped, true)
  await page.confirmGeneration(); assert.equal(page.data.completed, false)
})
test('cancel failure while hidden retains retry access and unloaded responses are ignored', async () => {
  let reject
  const { page, modals } = setup({ cancelCourseOutline: () => new Promise((_resolve, fail) => { reject = fail }) })
  await page.onLoad({ courseInstanceId: '9' }); page.cancelGeneration()
  const pending = modals[0].success({ confirm: true }); page.onHide(); reject(new Error('网络中断')); await pending; page.onShow()
  assert.equal(page.data.saving, false); assert.equal(page.data.errorMessage, '网络中断')
  page.cancelGeneration(); const stale = modals[1].success({ confirm: true }); page.onUnload()
  const before = JSON.stringify(page.data); reject(new Error('旧响应')); await stale
  assert.equal(JSON.stringify(page.data), before)
})
test('reopening a failed generation cannot edit or confirm its retained outline', async () => {
  const { page, sent } = setup({ loadCourseOutline: async () => ({ status: 'failed', outlineDraft: draft() }) })
  await page.onLoad({ courseInstanceId: '9' }); page.updateTitle({ detail: { value: '修改' } }); await page.confirmGeneration()
  assert.equal(page.data.stopped, true); assert.equal(page.data.draft.title, '电子转移'); assert.equal(sent.length, 0)
})
test('switching chapter types resets obsolete configuration and saves editable quiz settings', async () => {
  const { page, sent } = setup(); await page.onLoad({ courseInstanceId: '9' })
  page.changeType({ currentTarget: { dataset: { id: 'a1' } }, detail: { value: '1' } })
  page.updateConfig({ currentTarget: { dataset: { id: 'a1', field: 'questionCount' } }, detail: { value: '5' } })
  page.updateConfig({ currentTarget: { dataset: { id: 'a1', field: 'questionTypes' } }, detail: { value: ['single', 'text'] } })
  await page.saveDraft()
  const item = sent[0].value.outlines[1]
  assert.equal(item.type, 'quiz'); assert.equal(item.widgetOutline, undefined)
  assert.equal(item.editorConfig.quizConfig.questionCount, 5)
  assert.equal(item.editorConfig.quizConfig.questionTypes.join(','), 'single,text')
})
test('changing interaction kind drops stale internals and roleplay can be switched off', async () => {
  const { page, sent } = setup(); await page.onLoad({ courseInstanceId: '9' })
  page.updateConfig({ currentTarget: { dataset: { id: 'a1', field: 'widgetType' } }, detail: { value: '3' } })
  assert.equal(page.data.draft.outlines[1].widgetType, 'game')
  page.changeType({ currentTarget: { dataset: { id: 'a1' } }, detail: { value: '3' } })
  page.updateConfig({ currentTarget: { dataset: { id: 'a1', field: 'targetSkills' } }, detail: { value: '观察\n' } })
  assert.equal(page.data.draft.outlines[1].targetSkillsText, '观察\n')
  page.updateConfig({ currentTarget: { dataset: { id: 'a1', field: 'scenarioRoleplay' } }, detail: { value: true } })
  assert.equal(page.data.draft.outlines[1].pblConfig.scenarioBrief, '说明')
  page.updateConfig({ currentTarget: { dataset: { id: 'a1', field: 'scenarioRoleplay' } }, detail: { value: false } })
  await page.saveDraft()
  assert.equal(sent[0].value.outlines[1].editorConfig.pblConfig.scenarioBrief, undefined)
  assert.equal(sent[0].value.outlines[1].editorConfig.pblConfig.projectTopic, '实验')
})
