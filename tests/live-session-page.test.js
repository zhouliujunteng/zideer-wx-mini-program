const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const pageSource = fs.readFileSync(path.join(__dirname, '../learning/live-session/index.js'), 'utf8')
const template = fs.readFileSync(path.join(__dirname, '../learning/live-session/index.wxml'), 'utf8')

const SESSION = {
  id: '7',
  sessionNo: 'LS-20260921-02',
  serviceMode: 'parallel_coaching',
  status: 'in_progress',
  scheduledStart: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  scheduledEnd: new Date(Date.now() + 35 * 60 * 1000).toISOString(),
  capacity: 1,
  meetingRef: '',
  actualStart: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  teacher: { id: '3', displayName: '王老师', status: 'active' }
}

function loadPage({ schedule, currentUser = { profile: { nickname: '小鹿', avatar_url: 'https://cdn.example.com/a.png' } } } = {}) {
  let definition
  const calls = { toasts: [], navigations: [], clipboard: [], intervals: 0, clearedIntervals: 0 }
  vm.runInNewContext(pageSource, {
    Page(config) { definition = config },
    getCurrentPages: () => [{}, {}],
    setInterval: () => { calls.intervals += 1; return 99 },
    clearInterval: () => { calls.clearedIntervals += 1 },
    setTimeout: () => 1,
    clearTimeout: () => {},
    console,
    wx: {
      getWindowInfo: () => ({ statusBarHeight: 44, windowHeight: 812, windowWidth: 375 }),
      getMenuButtonBoundingClientRect: () => ({ top: 48, height: 32, left: 283 }),
      showToast: (options) => calls.toasts.push(options.title),
      navigateTo: (options) => calls.navigations.push(options.url),
      navigateBack: () => calls.navigations.push('back'),
      switchTab: (options) => calls.navigations.push(options.url),
      setClipboardData: (options) => { calls.clipboard.push(options.data); if (options.success) options.success() }
    },
    require(name) {
      if (name.endsWith('/identity')) {
        return {
          loadCurrentLiveSchedule: async () => schedule,
          loadCurrentUser: async () => currentUser
        }
      }
      if (name.endsWith('/live-session-view')) return require('../services/live-session-view')
      if (name.endsWith('/ui-assets')) return { attachUiAssets: () => Promise.resolve({}) }
      throw new Error(`Unexpected import ${name}`)
    }
  })

  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) {
      for (const [key, value] of Object.entries(patch)) {
        if (!key.includes('.')) { this.data[key] = value; continue }
        const parts = key.split('.')
        let target = this.data
        for (const part of parts.slice(0, -1)) target = target[part]
        target[parts[parts.length - 1]] = value
      }
    }
  }
  return { page, calls }
}

const schedule = (overrides = {}) => ({
  profile: { id: '9', nickname: '小鹿', realName: '' },
  sessions: [{ id: '31', status: 'confirmed', attendanceSeconds: 0, session: { ...SESSION, ...overrides } }],
  assignments: []
})

test('the page renders the session the entry pointed at', async () => {
  const { page } = loadPage({ schedule: schedule() })
  page.onLoad({ participantId: '31' })
  await page.loadPage()
  assert.equal(page.data.loadState, 'ready')
  assert.equal(page.data.model.teacher.name, '王老师')
  assert.equal(page.data.model.statusLabel, '进行中')
  assert.equal(page.data.model.participants[1].name, '小鹿')
  assert.equal(page.data.model.participants[1].avatarSrc, 'https://cdn.example.com/a.png')
})

test('a participant id that is not in the schedule shows the unavailable state', async () => {
  const { page } = loadPage({ schedule: schedule() })
  page.onLoad({ participantId: '999' })
  await page.loadPage()
  assert.equal(page.data.loadState, 'missing')
  assert.match(page.data.stateTitle, /暂不可查看/)
})

test('a failed schedule read keeps the reason instead of an empty page', async () => {
  const { page } = loadPage({ schedule: undefined })
  page.onLoad({ participantId: '31' })
  await page.loadPage()
  assert.equal(page.data.loadState, 'failed')
  assert.ok(page.data.stateCopy.length > 0)
})

test('profile read failures still render the meeting with a fallback learner name', async () => {
  const { page } = loadPage({ schedule: schedule(), currentUser: null })
  page.onLoad({ participantId: '31' })
  await page.loadPage()
  assert.equal(page.data.loadState, 'ready')
  assert.equal(page.data.model.participants[1].name, '小鹿')
  assert.equal(page.data.model.participants[1].avatarSrc, '')
})

test('the join button never fakes entering a meeting that has no link', async () => {
  const { page, calls } = loadPage({ schedule: schedule() })
  page.onLoad({ participantId: '31' })
  await page.loadPage()
  assert.equal(page.data.model.meeting.canJoin, false)
  page.handleJoin()
  assert.equal(calls.clipboard.length, 0)
  assert.match(calls.toasts[0], /尚未配置/)
})

test('a configured meeting link is copied out for the real meeting app', async () => {
  const { page, calls } = loadPage({ schedule: schedule({ meetingRef: 'https://meeting.example.com/s/abc' }) })
  page.onLoad({ participantId: '31' })
  await page.loadPage()
  assert.equal(page.data.model.meeting.canJoin, true)
  page.handleJoin()
  assert.deepEqual(calls.clipboard, ['https://meeting.example.com/s/abc'])
  assert.match(calls.toasts[0], /已复制/)
})

test('a cancelled session sends the student back to self-study', async () => {
  const { page, calls } = loadPage({ schedule: schedule({ status: 'cancelled' }) })
  page.onLoad({ participantId: '31' })
  await page.loadPage()
  assert.equal(page.data.model.statusLabel, '会议异常')
  page.handleJoin()
  assert.deepEqual(calls.navigations, ['/learning/daily-task/index'])
})

test('the live timer runs only while the session is live and stops on hide', async () => {
  const { page, calls } = loadPage({ schedule: schedule() })
  page.onLoad({ participantId: '31' })
  await page.loadPage()
  assert.equal(calls.intervals, 1)
  page.onHide()
  assert.equal(calls.clearedIntervals, 1)

  const ended = loadPage({ schedule: schedule({ status: 'completed' }) })
  ended.page.onLoad({ participantId: '31' })
  await ended.page.loadPage()
  assert.equal(ended.calls.intervals, 0)
})

test('the template keeps the design sheet structure and the global dev reset', () => {
  assert.match(template, /live-session-sheet/)
  assert.match(template, /live-session-status-dot-\{\{model\.statusTone\}\}/)
  assert.match(template, /<dev-reset-fab\s*\/>/)
  // 设计稿的本地状态切换菜单只用于预览，正式页面不能带。
  assert.doesNotMatch(template, /state-toggle|stateOptions/)
})
