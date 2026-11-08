const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

// 「我的课程」里的「我的定制课程」（未学 / 已学、按系列分组）与课程库按系列查看（2026-10-06，更新日志 1.0.3）。

const { normalizeAgentCourse, agentCourseCard, agentCourseDetail } = require('../utils/agent-course-view')
const { customCourseView, seriesGroups, seriesFilterTabs, filterBySeries } = require('../utils/my-course-groups')

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')

function raw(stageId, extra = {}) {
  return {
    stageId,
    title: stageId.replace('stage-', '课程 '),
    status: 'completed',
    canLearn: true,
    progress: { total: 4, done: 4, percent: 100 },
    pages: [],
    createdAt: '2026-10-05T08:00:00.000Z',
    ...extra
  }
}

function card(stageId, extra = {}, index = 0) {
  return agentCourseCard(normalizeAgentCourse(raw(stageId, extra)), index)
}

const FRACTIONS = { id: 'folder-a', title: '分数加减法' }
const DECIMALS = { id: 'folder-b', title: '小数乘法' }

test('custom course cards carry the series and whether the course is learned', () => {
  const done = card('stage-a1', { series: FRACTIONS, learning: { completed: 4, total: 4, allRecorded: true } })
  assert.equal(done.seriesId, 'folder-a')
  assert.equal(done.seriesTitle, '分数加减法')
  assert.equal(done.learnState, 'completed')
  assert.equal(done.learned, true)
  assert.equal(done.subtitle, '已学完')
  const half = card('stage-a2', { series: FRACTIONS, learning: { completed: 1, total: 4, allRecorded: false } })
  assert.equal(half.learnState, 'in_progress')
  assert.equal(half.learned, false)
  assert.equal(half.subtitle, '已学 1 / 4 页')
  const fresh = card('stage-c1')
  assert.equal(fresh.seriesTitle, '')
  assert.equal(fresh.learnState, 'not_started', '没读到学习进度按没学')
  const making = card('stage-m1', { status: 'generating', canLearn: false, progress: { total: 4, done: 1, percent: 25 }, learning: { completed: 4, total: 4, allRecorded: true } })
  assert.equal(making.learnState, 'generating')
  assert.equal(making.learned, false, '还在制作的课不会因为脏数据算成已学')
  // 系列只认 id 与名称都在的
  assert.equal(card('stage-x', { series: { id: 'folder-z', title: '  ' } }).seriesId, '')
})

test('the course page subtitle names the series', () => {
  const course = normalizeAgentCourse(raw('stage-a1', { series: FRACTIONS }))
  assert.match(agentCourseDetail(course).subtitle, /^系列：分数加减法 · 10月5日制作$/)
  assert.equal(agentCourseDetail(normalizeAgentCourse(raw('stage-c1'))).subtitle, '10月5日制作')
})

test('我的定制课程 splits learned from unlearned and groups each by series, loose lessons last', () => {
  const courses = [
    card('stage-m1', { status: 'generating', canLearn: false, series: DECIMALS, progress: { total: 3, done: 1, percent: 30 } }),
    card('stage-a1', { series: FRACTIONS, learning: { completed: 4, total: 4, allRecorded: true } }),
    card('stage-a2', { series: FRACTIONS, learning: { completed: 1, total: 4, allRecorded: false } }),
    card('stage-c1'),
    { id: '88', kind: 'plan', title: '学习计划课', subtitle: '数学 · 待学习' }
  ]
  const unlearned = customCourseView(courses, 'unlearned')
  assert.deepEqual(unlearned.filters.map((item) => [item.id, item.count, item.active]), [['unlearned', 3, true], ['learned', 1, false]])
  assert.deepEqual(unlearned.groups.map((group) => [group.title, group.courses.map((item) => item.stageId)]), [
    ['小数乘法', ['stage-m1']],
    ['分数加减法', ['stage-a2']],
    ['单节课程', ['stage-c1']]
  ])
  assert.equal(unlearned.groups[1].meta, '1 节')
  const learned = customCourseView(courses, 'learned')
  assert.deepEqual(learned.groups.map((group) => group.courses.map((item) => item.stageId)), [['stage-a1']])
  assert.equal(customCourseView([], 'learned').count, 0)
  assert.match(customCourseView([], 'learned').emptyText, /还没有学完/)
  assert.equal(customCourseView(courses, 'bogus').filter, 'unlearned')
})

test('without any series the custom courses stay one untitled group', () => {
  const groups = seriesGroups([card('stage-c1'), card('stage-c2')])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].title, '')
})

test('the course library offers one tab per series plus single lessons, only when a series exists', () => {
  const courses = [
    card('stage-a1', { series: FRACTIONS }),
    card('stage-a2', { series: FRACTIONS }),
    card('stage-b1', { series: DECIMALS }),
    card('stage-c1'),
    { id: '88', kind: 'plan', title: '学习计划课' }
  ]
  const tabs = seriesFilterTabs(courses, 'folder-a')
  assert.deepEqual(tabs.map((tab) => [tab.label, tab.count, tab.active]), [
    ['全部', 5, false], ['分数加减法', 2, true], ['小数乘法', 1, false], ['单节课程', 2, false]
  ])
  assert.deepEqual(filterBySeries(courses, 'folder-a').map((item) => item.stageId), ['stage-a1', 'stage-a2'])
  assert.equal(filterBySeries(courses, 'single').length, 2)
  assert.equal(filterBySeries(courses, 'all').length, 5)
  assert.deepEqual(seriesFilterTabs([card('stage-c1')]), [], '只有单节课时不画筛选条')
  assert.equal(seriesFilterTabs(courses, 'folder-gone').find((tab) => tab.active).id, 'all')
})

function loadLearningPage(myCourses) {
  let definition
  vm.runInNewContext(read('pages/learning/index.js'), {
    Page(value) { definition = value },
    getApp: () => ({ globalData: {} }),
    setTimeout, clearTimeout, console,
    wx: { getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 20 }), getMenuButtonBoundingClientRect: () => ({ top: 26, height: 32, left: 280, width: 87 }), showToast() {} },
    require(name) {
      if (name.endsWith('/utils/my-course-groups')) return require('../utils/my-course-groups')
      if (name.endsWith('/services/live-tab-service')) return { getLiveLearningModel: async () => ({ model: { myCourses }, dashboard: null, access: 'ready' }), getLearningSkeletonModel: () => ({}) }
      if (name.endsWith('/utils/screen')) return { rpxToPx: (value) => value / 2, getMenuButtonRect: () => ({ top: 26, height: 32, left: 280, width: 87 }) }
      return new Proxy({}, { get: () => () => {} })
    }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch) } }
  page._visible = true
  return page
}

test('学习页「我的课程」switches to 我的定制课程 and between 未学 / 已学, and search narrows both', async () => {
  const courses = [
    card('stage-a1', { title: '同分母加法', series: FRACTIONS, learning: { completed: 4, total: 4, allRecorded: true } }),
    card('stage-a2', { title: '异分母加法', series: FRACTIONS }),
    card('stage-c1', { title: '小数点移动' })
  ]
  const page = loadLearningPage(courses)
  page.scheduleProgressPolling = () => {}
  page.applyAgentCourseFocus = () => {}
  await page.refreshLearning(true)
  assert.equal(page.data.myCourseTab, 'all')
  assert.equal(page.data.visibleMyCourses.length, 3)
  page.switchMyCourseTab({ currentTarget: { dataset: { id: 'custom' } } })
  assert.equal(page.data.myCourseTab, 'custom')
  assert.deepEqual(page.data.myCourseTabs.map((tab) => tab.active), [false, true])
  assert.deepEqual(page.data.customView.groups.map((group) => group.title), ['分数加减法', '单节课程'])
  page.switchCustomFilter({ currentTarget: { dataset: { id: 'learned' } } })
  assert.deepEqual(page.data.customView.groups.map((group) => group.courses.map((item) => item.stageId)), [['stage-a1']])
  page.searchMyCourses({ detail: { value: '分数加减' } })
  assert.equal(page.data.customView.count, 1, '按系列名也能搜到')
  page.searchMyCourses({ detail: { value: '小数' } })
  assert.equal(page.data.customView.count, 0)
  assert.equal(page.data.customFilter, 'learned', '搜索不重置已选的状态')

  const wxml = read('pages/learning/index.wxml')
  assert.match(wxml, /bindtap="switchMyCourseTab"/)
  assert.match(wxml, /bindtap="switchCustomFilter"/)
  assert.match(wxml, /class="more-course-series"/)
})

test('课程库 page filters my courses by series', async () => {
  let definition
  const mine = {
    courses: [
      card('stage-a1', { series: FRACTIONS }),
      card('stage-b1', { series: DECIMALS, learning: { completed: 4, total: 4, allRecorded: true } }),
      card('stage-c1')
    ],
    hasGenerating: false
  }
  vm.runInNewContext(read('learning/library/index.js'), {
    Page(value) { definition = value },
    getCurrentPages: () => [],
    setTimeout, clearTimeout,
    wx: { getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 20 }), getMenuButtonBoundingClientRect: () => ({ top: 26, height: 32 }) },
    require(name) {
      if (name.endsWith('/utils/my-course-groups')) return require('../utils/my-course-groups')
      if (name.endsWith('/services/live-tab-service')) return { getMyCourseLibrary: async () => mine }
      if (name.endsWith('/utils/screen')) return { rpxUnit: () => 0.5 }
      return new Proxy({}, { get: () => () => {} })
    }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch) } }
  page.onLoad({ scope: 'mine' })
  await page.loadCourses()
  assert.deepEqual(page.data.seriesTabs.map((tab) => tab.label), ['全部', '分数加减法', '小数乘法', '单节课程'])
  assert.equal(page.data.visibleCourses.length, 3)
  page.selectSeries({ currentTarget: { dataset: { id: 'folder-b' } } })
  assert.deepEqual(page.data.visibleCourses.map((item) => item.stageId), ['stage-b1'])
  assert.equal(page.data.visibleCourses[0].priceLabel, '小数乘法')
  assert.equal(page.data.visibleCourses[0].subtitle, '已学完')
  page.selectSeries({ currentTarget: { dataset: { id: 'single' } } })
  assert.deepEqual(page.data.visibleCourses.map((item) => item.stageId), ['stage-c1'])
  assert.match(read('learning/library/index.wxml'), /bindtap="selectSeries"/)
})
