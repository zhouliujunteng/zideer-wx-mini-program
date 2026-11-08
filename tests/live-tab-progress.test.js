const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

test('learning cards preserve backend progress and distinguish ready content from studied content', async () => {
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/live-tab-service.js'), 'utf8'), {
    module, require: name => name === './mock-service' ? { getLearningModel: () => ({ notifications: {} }) } : {
      loadLearningDashboard: async () => ({ students: [{}], tasks: [
        { id: 1, status: 'active', progress: 67, progressText: '67%', progressLabel: '生成中' },
        { id: 2, status: 'active', progress: 100, progressText: '已生成', progressLabel: '待学习' },
      ] }),
    },
  })
  const { model } = await module.exports.getLiveLearningModel()
  assert.equal(model.studyTasks[0].progress, 67)
  assert.equal(model.studyTasks[1].progressText, '已生成')
  assert.equal(model.studyTasks[1].progressLabel, '待学习')
})

// 「我的课程库」（learning/library?scope=mine）与学习页「我的课程」同一份卡片；它是整页主内容，定制课程读不到时要报错而不是悄悄少课。
test('my course library shares the 我的课程 cards, and does not hide a failed agent-course read', async () => {
  const load = (agentCourses) => {
    const module = { exports: {} }
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/live-tab-service.js'), 'utf8'), {
      module,
      require: name => name === './mock-service' ? {} : name === './checkin-model' ? {} : name === '../utils/agent-course-view' ? require('../utils/agent-course-view') : {
        loadLearningDashboard: async () => ({ students: [{}], myCourses: [{ courseInstanceId: 42, canLaunch: true, title: '一次函数', meta: '数学' }] }),
        loadAgentCourses: agentCourses,
        loadCourseCovers: async () => ({})
      }
    })
    return module.exports.getMyCourseLibrary
  }
  const { normalizeAgentCourse } = require('../utils/agent-course-view')
  const course = (stageId, status) => ({ ...normalizeAgentCourse({ stageId, title: stageId, status, canLearn: status !== 'generating', pages: [] }), coverUrl: '' })
  const mine = await load(async () => [course('stage-ready', 'completed'), course('stage-making', 'generating')])()
  assert.deepEqual(mine.courses.map((item) => [item.kind, item.id]), [['agent', 'agent:stage-making'], ['agent', 'agent:stage-ready'], ['plan', '42']])
  assert.equal(mine.hasGenerating, true)
  await assert.rejects(load(async () => { throw new Error('offline') })(), /offline/)
})
