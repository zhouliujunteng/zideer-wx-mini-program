const test = require('node:test')
const assert = require('node:assert/strict')
const identity = require('../services/identity')
let payload
let calls
function setup(value) {
  identity.resetPhoneSessionVerification()
  payload = value; calls = []
  global.wx = {
    getStorageSync: () => 'fixture-runtime-token',
    request(options) { if (require('./helpers/verified-phone-session')(options)) return; calls.push(options.data); options.success({statusCode:200,data:{data:{result:payload}}}) }
  }
}
test('knowledge map refuses a legacy dataset even when marked ready', async () => {
  setup({status:'ready',subjects:[],topics:[{id:1,display_name:'旧数据'}]})
  await assert.rejects(identity.loadKnowledgeMap(), /数据源/)
})
test('knowledge map exposes current grade and semester without retaining a previous selection', async () => {
  const value = {status:'ready',datasetKey:'china-k12-tokenmap-135386badef4',grade:7,semester:'下学期',subjects:[{id:1,subject_key:'math',display_name:'数学'}],topics:[{id:1,subject_id:1,grade_start:7,display_name:'七年级下册',semester:'下册'}]}
  setup(value)
  const first = await identity.loadKnowledgeMap('math')
  assert.equal(first.semester, '下学期')
  assert.equal(first.grade, '初1')
  payload = {...value, grade:1,semester:'上学期',topics:[]}
  const second = await identity.loadKnowledgeMap('math')
  assert.equal(second.grade, '小学1年级')
  assert.equal(second.semester, '上学期')
  assert.equal(second.nodes.length, 0)
})
test('learning universe exposes assessment and course evidence totals', async () => {
  setup({
    status:'ready',datasetKey:'china-k12-tokenmap-135386badef4',grade:7,semester:'下学期',
    subjects:[{id:1,subject_key:'math',display_name:'数学'}],
    topics:[{id:1,subject_id:1,grade_start:7,display_name:'一次函数',semester:'下册'}],
    masteries:[{knowledge_topic_id:1,status:'mastered',evidence_count:3,assessment_evidence_count:2,course_evidence_count:1,mastery_source:'ai_acceptance'}],
    universe:{evidenceCount:3,assessmentEvidenceCount:2,courseEvidenceCount:1,masteredCount:1}
  })

  const map = await identity.loadKnowledgeMap('math')
  assert.deepEqual(map.universe, {
    evidenceCount: 3,
    assessmentEvidenceCount: 2,
    courseEvidenceCount: 1,
    teacherEvidenceCount: 0,
    masteredCount: 1
  })
  assert.equal(map.nodes[0].courseEvidenceCount, 1)
  assert.match(map.nodes[0].evidence, /课程 1/)
})
test('knowledge detail follows primary prerequisites without the list grade restriction', async () => {
  setup({status:'ready',datasetKey:'china-k12-tokenmap-135386badef4',topic:{id:10,name:'三角形的概念与分类',grade:8,grade_label:'八年级',description:'说明',mastery_standard:'能区分三角形',subject:{code:'math',name:'数学'},unit:{name:'三角形'}},prerequisites:[{id:1,reason:'先理解分类',prerequisite:{id:20,name:'三角形的分类',grade:4,grade_label:'四年级'}}],successors:[],related:[],evidence:[]})
  const topic = await identity.loadKnowledgeTopic(10)
  assert.equal(topic.prerequisiteLinks[0].id, '20')
  assert.equal(topic.prerequisiteLinks[0].gradeLabel, '四年级')
  assert.equal(topic.masteryStandard, '能区分三角形')
  assert.deepEqual(topic.evidenceRecords, [])
  assert.equal(topic.status, 'unknown')
  assert.deepEqual(calls[0].variables.args, {topic_id:10})
})
test('topic detail rejects absent topics instead of falling back to a grade list', async () => {
  setup({status:'topic_unavailable'})
  await assert.rejects(identity.loadKnowledgeTopic(10), /未找到/)
  assert.equal(calls.length,1)
})
test('diagnosis entry follows selected subject without borrowing another subject report',async()=>{
  setup({status:'ready',datasetKey:'china-k12-tokenmap-135386badef4',grade:8,semester:'上学期',subjects:[{id:1,subject_key:'math',display_name:'数学'},{id:2,subject_key:'eng',display_name:'英语'}],topics:[],diagnostics:[{id:9,scope:{subject:'math'},entry:{mode:'report',attemptId:17}}]});
  assert.equal((await identity.loadKnowledgeMap('math')).diagnostic.attemptId,17);
  assert.equal((await identity.loadKnowledgeMap('eng')).diagnostic.mode,'unavailable');
});
