const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const memberModel = {
  student: null,
  notifications: {},
  overview: [],
  learningCards: [],
  studyTasks: [],
  studyTaskCalendar: [],
  studyTaskEmptyText: '',
  hasLibraryAccess: false,
  moreCourses: []
}

function loadLiveTabService({ library }) {
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/live-tab-service.js'), 'utf8'), {
    module,
    require: (name) => name === './mock-service'
      ? { getHomeModel: () => JSON.parse(JSON.stringify(memberModel)) }
      : {
          loadHomeDashboard: async () => ({ students: [], today: null, assessment: null, balances: null, plan: null }),
          loadMemberCourseLibrary: library
        }
  })
  return module.exports
}

test('member home lists published library courses for members', async () => {
  const service = loadLiveTabService({
    library: async () => [
      { id: 'a'.repeat(32), title: '氧化还原反应', subject: '化学', grade: '高中' },
      { id: 'b'.repeat(32), title: '三角函数专题', subject: '', grade: '' }
    ]
  })
  const { model } = await service.getLiveHomeModel()
  assert.equal(model.hasLibraryAccess, true)
  assert.deepEqual(JSON.parse(JSON.stringify(model.moreCourses)), [
    { id: 'a'.repeat(32), title: '氧化还原反应', subtitle: '化学 · 高中 年级', isMember: true, tone: 0 },
    { id: 'b'.repeat(32), title: '三角函数专题', subtitle: '会员公共课程', isMember: true, tone: 1 }
  ])
})

test('member home hides the library section without membership', async () => {
  const service = loadLiveTabService({
    library: async () => { const error = new Error('当前账号暂无课程库访问权限。'); error.code = 'MEMBERSHIP_REQUIRED'; throw error }
  })
  const { model } = await service.getLiveHomeModel()
  assert.equal(model.hasLibraryAccess, false)
  assert.deepEqual(JSON.parse(JSON.stringify(model.moreCourses)), [])
})

test('member home hides the library section when it resolves empty', async () => {
  const service = loadLiveTabService({ library: async () => [] })
  const { model } = await service.getLiveHomeModel()
  assert.equal(model.hasLibraryAccess, false)
  assert.deepEqual(JSON.parse(JSON.stringify(model.moreCourses)), [])
})

const pagePath = require.resolve('../pages/home/index.js')

function loadPage() {
  delete require.cache[pagePath]

  let definition = null
  const navigations = []
  global.Page = (page) => { definition = page }
  global.wx = {
    navigateTo(options) { navigations.push(options) }
  }
  require(pagePath)

  const instance = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(values) { Object.assign(this.data, values) }
  }
  return { definition, instance, navigations }
}

test('home course cards open the member library course webview', () => {
  const { definition, instance, navigations } = loadPage()
  const id = 'c5f0d3ab7890124567abcdef01234567'

  definition.openLibraryCourse.call(instance, { currentTarget: { dataset: { id } } })
  definition.openLibraryCourse.call(instance, { currentTarget: { dataset: { id: '../private' } } })
  definition.openLibraryCourse.call(instance, { currentTarget: { dataset: {} } })
  definition.openLibraryList.call(instance)

  assert.deepEqual(navigations, [
    { url: `/learning/course/index?libraryCourseId=${id}` },
    { url: '/learning/library/index' }
  ])
})
