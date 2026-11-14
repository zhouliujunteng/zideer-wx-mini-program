const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

// 会议约好后代理页面上的进会议链接（2026-11-14）：小程序孩子转发邀请页 / 复制小程序链接，网页端孩子复制网页版诊断室链接。
function loadPage(result) {
  let page
  const toasts = []
  let clipboard = ''
  const sandbox = {
    require: (name) => {
      if (name.endsWith('services/identity')) return { loadAgentTrial: async () => result, openAgentTrialTest() {}, requestAgentTrialMeeting() {}, loadAgentTrialScript() {}, downloadAgentTrialReport() {} }
      if (name.endsWith('utils/screen')) return { rpxToPx: (v) => v }
      if (name.endsWith('utils/grade-name')) return { gradeName: (g) => `${g}年级` }
      throw new Error('unexpected require ' + name)
    },
    Page: (def) => { page = def },
    wx: {
      getWindowInfo: () => ({ statusBarHeight: 20, windowWidth: 375 }),
      getMenuButtonBoundingClientRect: () => ({ top: 26, height: 32 }),
      showToast: (o) => toasts.push(o.title),
      setClipboardData: (o) => { clipboard = o.data; if (o.success) o.success() }
    },
    getCurrentPages: () => [1],
    console
  }
  vm.runInNewContext(read('agent/family-trial/index.js'), sandbox)
  page.data = JSON.parse(JSON.stringify(page.data))
  page.setData = function (patch) { Object.keys(patch).forEach((k) => { this.data[k] = patch[k] }) }
  return { page, toasts, clipboard: () => clipboard }
}

const base = (links) => ({
  family: { publicId: '100010', name: '张家长' },
  children: [{ studentProfileId: 601, name: '张一', grade: 5 }],
  test: { state: 'none' },
  meeting: { status: 'arranged', note: '周六上午', teacherName: '刘老师', children: [{ studentProfileId: 601, name: '张一', grade: 5 }], links },
  lessons: { used: 0, limit: 3 }
})

test('小程序孩子：能复制小程序链接，转发按钮带邀请页路径；右上角转发不带邀请', async () => {
  const { page, clipboard } = loadPage(base([{ studentProfileId: 601, name: '张一', kind: 'mini', url: '#小程序://知鹿学习/abc', path: '/learning/agent-invite/index?token=tok', scheduledAt: '2026-11-21T02:00:00Z', minutes: 45 }]))
  await page.load.call(page)
  const link = page.data.view.meetingLinks[0]
  assert.equal(link.web, false)
  assert.equal(link.title, '小程序会议链接')
  page.copyMeetingLink.call(page, { currentTarget: { dataset: { index: 0 } } })
  assert.equal(clipboard(), '#小程序://知鹿学习/abc')
  const shared = page.onShareAppMessage.call(page, { from: 'button', target: { dataset: { meeting: '1', index: 0 } } })
  assert.equal(shared.path, '/learning/agent-invite/index?token=tok')
  assert.equal(page.onShareAppMessage.call(page, { from: 'menu' }).path, '/pages/home/index')
})

test('网页端孩子：复制的是网页版诊断室链接，不出转发按钮', async () => {
  const { page, clipboard } = loadPage(base([{ studentProfileId: 601, name: '张一', kind: 'web', url: 'https://study.zideer.cn/portal/meeting/tok', path: '', scheduledAt: '', minutes: 45 }]))
  await page.load.call(page)
  const link = page.data.view.meetingLinks[0]
  assert.equal(link.web, true)
  page.copyMeetingLink.call(page, { currentTarget: { dataset: { index: 0 } } })
  assert.match(clipboard(), /https:\/\/study\.zideer\.cn\/portal\/meeting\/tok/)
  const wxml = read('agent/family-trial/index.wxml')
  assert.match(wxml, /wx:if="\{\{!item\.web\}\}"[^>]*open-type="share"/)
})

test('还没约好：没有链接', async () => {
  const { page } = loadPage(base(undefined))
  await page.load.call(page)
  assert.deepEqual(JSON.parse(JSON.stringify(page.data.view.meetingLinks)), [])
})
