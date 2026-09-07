import { execFileSync } from 'node:child_process'

const projectRoot = '/Users/zhouliujunteng/quansuxuexi'
const flowId = 'b8fae4ae-ca1f-4c48-869e-d3a4c5a49c1e'
const nodeId = 'hyyz3isma'
const environment = { ...process.env, MCP_TYPE_SYSTEM: 'post' }

function run(args) {
  return execFileSync('npx', ['-y', 'zion-mcp@2.7.4', '--no-daemon', '--cwd', projectRoot, ...args], {
    cwd: projectRoot,
    env: environment,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  })
}

const detail = JSON.parse(run(['schema', 'tool-call', '--toolCalls', JSON.stringify([
  { name: 'GET_ACTION_FLOW_DETAIL', args: { actionFlowId: flowId, detail: 'FULL' } }
])]))
const response = detail.responses[0]
const start = response.indexOf('    code: >-\n')
const end = response.indexOf('\n    andThenNodeId:', start)
if (start < 0 || end < 0) throw new Error('Unable to read the current assessment submission flow.')

const code = response
  .slice(start + '    code: >-\n'.length, end)
  .replace(/^      /gm, '')
  .replace(/\n\s*/g, ' ')

const original = 'report=r.insert_diagnostic_report_one;}context.setResult({status:"submitted",attempt:submitted,analysisStatus:report?"completed":"mapping_required",diagnosticReport:report});'
const replacement = 'report=r.insert_diagnostic_report_one;if(report){submitted=context.runGql("CompleteAssessmentAttempt","mutation CompleteAssessmentAttempt($id:bigint!,$set:assessment_attempt_set_input!){update_assessment_attempt_by_pk(pk_columns:{id:$id},_set:$set){id status submitted_at}}",{id:a.id,set:{status:"completed",submitted_at:now,failure_code:null}},{role:"admin"}).update_assessment_attempt_by_pk;}}context.setResult({status:"submitted",attempt:submitted,analysisStatus:report?"completed":"mapping_required",diagnosticReport:report});'
if (!code.includes(original)) throw new Error('The expected assessment completion section was not found.')

run(['schema', 'tool-call', '--toolCalls', JSON.stringify([
  { name: 'UPDATE_ACTION_FLOW_NODE', args: { actionFlowId: flowId, nodeId, config: { type: 'CUSTOM_CODE', code: code.replace(original, replacement) } } }
])])
run(['schema', 'validate'])
run(['project', 'sync-backend'])
console.log('Assessment completion flow updated and deployed.')
