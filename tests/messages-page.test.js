const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const view = require('../utils/message-view')

const records = [
  { id: 1, business_type: 'assessment', status: 'unread', payload: { title: '测评完成', summary: '数学报告', route: '/assessment/history/index' } },
  { id: 2, business_type: 'course', status: 'read', payload: { title: '课程就绪', content: '分数课程' } },
  { id: 3, business_type: 'teacher_review', status: 'unread', payload: { title: '老师核验结果', content: '建议补学' } }
]
function pageFor({ failRead = false, failLoad = false } = {}) {
  let definition; const opened = []; const writes = []
  vm.runInNewContext(fs.readFileSync(require.resolve('../pages/system-messages/index.js'), 'utf8'), {
    Page(value) { definition = value },
    require(name) {
      if (name.includes('identity')) return {
        async loadCurrentNotifications() { if (failLoad) throw Error('offline'); return records },
        async markCurrentNotificationRead(id) { writes.push(id); if (failRead) throw Error('denied') }
      }
      return { ...view, navigateNotification: item => opened.push(item.id) }
    },
    wx: { showToast() {}, stopPullDownRefresh() {} }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch) } }
  return { page, opened, writes }
}
test('message categories and search reflect live notifications without invented teachers or counts', () => {
  const notifications = records.map(view.normalizeNotification)
  const model = view.buildMessagesModel(notifications)
  assert.equal(model.teacherConversations.length, 0)
  assert.deepEqual(model.shortcuts.map(item => item.unreadCount), [0, 1, 1])
  assert.equal(view.buildMessagesModel(notifications, { query: '数学' }).systemMessages[0].id, 1)
  assert.equal(view.buildMessagesModel(notifications, { category: 'teacher-feedback' }).systemMessages[0].id, 3)
  assert.equal(view.buildMessagesModel([], {}).systemCountLabel, '0条信息')
})
test('opening a notification persists read state before navigating and removes its unread dot', async () => {
  const { page, opened, writes } = pageFor()
  await page.loadPage()
  await page.handleSystemTap({ currentTarget: { dataset: { id: 1 } } })
  assert.deepEqual(writes, [1])
  assert.deepEqual(opened, [1])
  assert.equal(page.data.model.systemMessages[0].unreadDot, false)
})
test('failed read update does not navigate or pretend the notification is read', async () => {
  const { page, opened } = pageFor({ failRead: true })
  await page.loadPage()
  await page.handleSystemTap({ currentTarget: { dataset: { id: 1 } } })
  assert.equal(opened.length, 0)
  assert.equal(page.data.model.systemMessages[0].unread, true)
})
test('load failure shows retry state rather than empty or stale messages', async () => {
  const { page } = pageFor({ failLoad: true })
  await page.loadPage()
  assert.equal(page.data.failed, true)
  assert.equal(page.data.loading, false)
})
