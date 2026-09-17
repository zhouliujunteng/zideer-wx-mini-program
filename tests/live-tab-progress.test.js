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
