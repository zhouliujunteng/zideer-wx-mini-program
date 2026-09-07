import { readFile } from 'node:fs/promises'

const sessionPath = process.argv[2]
if (!sessionPath) throw new Error('Usage: node verify-zion-promotion-invitation-recovery.mjs <session-file>')

const session = JSON.parse(await readFile(sessionPath, 'utf8'))
const endpoint = 'https://zion-app.functorz.com/zero/ZJ2x09KOnm9/api/graphql-v2'
const actionFlowId = 'ee9c57e9-908b-4e41-bfb5-eebc4236b51f'
const idempotencyKey = `qa-tpa-invitation-${session.username}`

async function invoke() {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      query: `mutation Invoke($args: Json!) {
        fz_invoke_action_flow_default_by_latest_version(
          actionFlowId: "${actionFlowId}"
          args: $args
        )
      }`,
      variables: {
        args: {
          target_path: '/agent/share-tools/index',
          scene_type: 'share',
          idempotency_key: idempotencyKey
        }
      }
    })
  })
  const payload = await response.json()
  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.[0]?.message || `GraphQL request failed: ${response.status}`)
  }
  return payload.data.fz_invoke_action_flow_default_by_latest_version
}

const first = await invoke()
const retry = await invoke()
console.log(JSON.stringify({ first, retry }, null, 2))
