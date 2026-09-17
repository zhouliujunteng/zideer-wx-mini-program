const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const id = 'a'.repeat(32)
const courses = [{ id, title: 'Linear equations', subject: 'Math', grade: 'Grade 8' }]

function pageWith(load) {
  let definition
  const navigations = []
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../learning/library/index.js'), 'utf8'), {
    Page(page) { definition = page }, require() { return { loadMemberCourseLibrary: load } },
    wx: { navigateTo(value) { navigations.push(value.url) } }
  })
  return { page: { ...definition, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch) } }, navigations }
}

test('member catalog filters by subject and opens only a listed library course', async () => {
  const { page, navigations } = pageWith(async () => courses)
  await page.loadCourses()
  page.searchCourses({ detail: { value: 'math' } })
  assert.equal(page.data.visibleCourses.length, 1)
  page.openCourse({ currentTarget: { dataset: { id } } })
  page.openCourse({ currentTarget: { dataset: { id: 'not-listed' } } })
  assert.deepEqual(navigations, [`/learning/course/index?libraryCourseId=${id}`])
  page.searchCourses({ detail: { value: 'Other subject' } })
  assert.equal(page.data.visibleCourses.length, 0)
})

test('a late catalog reply never repopulates a hidden page, and failures clear old content', async () => {
  let reply
  const { page } = pageWith(() => new Promise((resolve) => { reply = resolve }))
  const pending = page.loadCourses()
  page.onHide()
  reply(courses)
  await pending
  assert.equal(page.data.courses.length, 0)
  const failure = pageWith(async () => { throw new Error('Unavailable') }).page
  failure.data.courses = courses
  await failure.loadCourses()
  assert.equal(failure.data.loading, false)
  assert.equal(failure.data.error, 'Unavailable')
  assert.equal(failure.data.courses.length, 0)
})

function serviceWith() {
  let token = 'student-token'
  let request
  const handoffs = []
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/identity.js'), 'utf8'), {
    module, require() { return { ...require('../config/index'), COURSE_PORTAL_ORIGIN: 'https://course.example' } },
    wx: {
      getStorageSync() { return token },
      request(options) {
        if (require('./helpers/verified-phone-session')(options)) return
        if (/\/api\/learn\/device$/.test(options.url)) {
          handoffs.push(options)
          return options.success({ statusCode: 200, data: { ticket: 'LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL', expiresAt: Date.now() + 60000 } })
        }
        request = options
      }
    }
  })
  return { api: module.exports, request: () => request, handoffs, changeAccount() { token = 'other-token' } }
}

test('library entry uses a one-time ticket, shared links carry no credential, and API results never retain admin fields', async () => {
  const { api, request, handoffs } = serviceWith()
  const entryUrl = await api.createLibraryCourseLaunchUrl(id)
  assert.equal(entryUrl, `https://course.example/api/learn/entry?library=${id}&layout=focus&ticket=LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL`)
  assert.equal(JSON.stringify(handoffs[0].data), JSON.stringify({ operation: 'handoff', libraryCourseId: id }))
  assert.equal(handoffs[0].header.authorization, 'Bearer student-token')
  assert.equal(api.courseShareUrl(entryUrl), `https://course.example/learn?library=${id}&layout=focus`)
  await assert.rejects(api.createLibraryCourseLaunchUrl('../private'))
  const result = api.loadMemberCourseLibrary()
  await new Promise(setImmediate)
  assert.equal(request().method, 'GET')
  assert.equal(request().header.authorization, 'Bearer student-token')
  request().success({ statusCode: 200, data: { courses: [{ ...courses[0], requirement: 'admin-only' }] } })
  assert.equal(JSON.stringify(await result), JSON.stringify(courses))
})

test('a catalog request cannot deliver one account data after login changes', async () => {
  const { api, request, changeAccount } = serviceWith()
  const pending = api.loadMemberCourseLibrary()
  await new Promise(setImmediate)
  changeAccount()
  request().success({ statusCode: 200, data: { courses } })
  await assert.rejects(pending, /账号已变化/)
})

test('membership denial does not clear the current login or fake an empty successful catalog', async () => {
  const { api, request } = serviceWith()
  const pending = api.loadMemberCourseLibrary()
  await new Promise(setImmediate)
  request().success({ statusCode: 403, data: { code: 'MEMBERSHIP_REQUIRED' } })
  await assert.rejects(pending, /访问权限/)
  assert.match(await api.createLibraryCourseLaunchUrl(id), /[?&]library=/)
})

test('a legacy server access-code response never masquerades as an expired student login', async () => {
  const { api, request } = serviceWith()
  const pending = api.loadMemberCourseLibrary()
  await new Promise(setImmediate)
  request().success({ statusCode: 401, data: { error: 'Access code required' } })
  await assert.rejects(pending, /课程库暂时无法读取/)
  assert.match(await api.createLibraryCourseLaunchUrl(id), /[?&]library=/)
})
