// 做题中途切回页面会静默刷新：还是同一道题时，不能清掉学生已经点选的答案。
const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')

function fixture(call) {
  let definition
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assessment/short/index.js'), 'utf8'), {
    Page: (p) => { definition = p }, require: () => ({ call, reportView: (r) => r }), wx: { showModal() {}, navigateTo() {}, showToast() {} }, Date, setInterval, clearInterval
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(v) { Object.assign(this.data, v) } }
  page.onLoad({ mode: 'resume', attemptId: 'a1' })
  page.visible = true
  return page
}

const attempt = (questionId, answeredCount) => ({
  id: 'a1', status: 'draft', revision: 1, answeredCount, totalQuestions: 5, roundCount: 1,
  current: { id: questionId, options: [{ value: 'A', label: '甲' }, { value: 'B', label: '乙' }] }
})

test('silent refresh on the same question keeps the selected answer', async () => {
  let current = attempt('q1', 0)
  const page = fixture(async () => ({ attempt: current }))
  await page.loadPage()
  page.setData({ answer: 'B', optionList: page.data.optionList.map((o) => ({ ...o, isSelected: o.value === 'B' })) })
  await page.loadPage(true)
  assert.equal(page.data.answer, 'B')
  assert.equal(page.data.optionList.find((o) => o.value === 'B').isSelected, true)
  current = attempt('q2', 1)
  await page.loadPage(true)
  assert.equal(page.data.answer, '')
  page.stopTimer()
})

test('hiding pauses question time; foreground revisits retain their accumulated seconds', async () => {
 const oldNow=Date.now; let now=100000; Date.now=()=>now
 let sent
 const page=fixture(async (op,payload)=>{if(op==='answer')sent=payload;return {attempt:attempt('q1',0)}})
 try {
  await page.loadPage(); page.setData({answer:'A'}); now+=10000;page.onHide();
  now+=120000;page.visible=true;await page.loadPage(true);now+=5000;
  await page.next({currentTarget:{dataset:{}}})
  assert.equal(sent.secondsUsed,15)
  assert.equal(sent.timingMethod,'foreground-v1')
 } finally {page.stopTimer();Date.now=oldNow}
})
