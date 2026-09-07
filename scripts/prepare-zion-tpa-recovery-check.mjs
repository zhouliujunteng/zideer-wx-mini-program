import { chmod, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'

const projectId = 'ZJ2x09KOnm9'
const endpoint = `https://zion-app.functorz.com/zero/${projectId}/api/graphql-v2`
const suffix = randomBytes(6).toString('hex')
const username = `qa_tpa_${suffix}`
const password = randomBytes(18).toString('base64url')
const sessionPath = `/tmp/zion-tpa-recovery-${suffix}.json`

async function graphql(query, variables, token = '') {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ query, variables })
  })
  const payload = await response.json()
  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.[0]?.message || `GraphQL request failed: ${response.status}`)
  }
  return payload.data
}

function invokeActionFlow(actionFlowId, args, token) {
  return graphql(`mutation Invoke($args: Json!) {
    fz_invoke_action_flow_default_by_latest_version(
      actionFlowId: "${actionFlowId}"
      args: $args
    )
  }`, { args }, token)
}

const auth = await graphql(`mutation Register($username: String!, $password: String!) {
  authenticateWithUsername(username: $username, password: $password, register: true) {
    account { id }
    jwt { token }
  }
}`, { username, password })

const token = auth.authenticateWithUsername?.jwt?.token
if (!token) throw new Error('Test account registration did not return a runtime token.')

const principalResult = await invokeActionFlow(
  'd16370dd-e77f-46aa-960d-f57379c1d000',
  {},
  token
)
const profileResult = await invokeActionFlow(
  '8b6ead87-086f-4e11-ba74-1bc6852267b2',
  {
    nickname: 'TPA 回归测试',
    grade: 8,
    school_stage: '初中',
    semester: '上学期',
    school_name: '测试学校',
    textbook_version: '人教版',
    region_detail: '测试地区'
  },
  token
)

await writeFile(sessionPath, JSON.stringify({ token, username, password }, null, 2), { mode: 0o600 })
await chmod(sessionPath, 0o600)

console.log(JSON.stringify({
  accountId: String(auth.authenticateWithUsername.account.id),
  principalResult,
  profileResult,
  sessionPath
}, null, 2))
