// Keep only geometry, route names and error categories. No error messages, URLs, tokens or user data.
const KEY = 'zhilu_support_diagnostics_v1'
const TTL = 24 * 3600 * 1000
const EVENTS = ['launch','show','page','resize','snapshot','error','unhandled','webview','course-entry','course-exit']
let samples = null
let installed = false
function safeRead(fn) { try { return fn() || {} } catch (_) { return {} } }
function routeName() {
  const pages = safeRead(() => getCurrentPages())
  const name = pages.length ? pages[pages.length - 1].route : ''
  return /^(pages|learning|account|commerce|assessment|diagnosis|teacher|agent|growth)\/[a-z0-9-]+\/[a-z0-9-]+$/.test(name) ? name : ''
}
function cleanSample(item) {
  if (!item || !EVENTS.includes(item.event) || !Number.isFinite(item.at) || item.at < Date.now()-TTL || item.at > Date.now()+60000) return null
  const value = {event:item.event,at:item.at}
  for (const key of ['width','height','screenWidth','screenHeight','pixelRatio']) if (typeof item[key]==='number' && Number.isFinite(item[key]) && item[key]>=0 && item[key]<100000) value[key]=item[key]
  if (/^(pages|learning|account|commerce|assessment|diagnosis|teacher|agent|growth)\/[a-z0-9-]+\/[a-z0-9-]+$/.test(item.route)) value.route=item.route
  if (['script','promise','network','webview','resource','unknown'].includes(item.error)) value.error=item.error
  return value
}
function record(event, error) {
  if (!samples) { const old=safeRead(()=>wx.getStorageSync(KEY)); samples=Array.isArray(old)?old:[] }
  const info = safeRead(()=>wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync())
  const item = cleanSample({event,at:Date.now(),route:routeName(),width:info.windowWidth,height:info.windowHeight,screenWidth:info.screenWidth,screenHeight:info.screenHeight,pixelRatio:info.pixelRatio,error})
  samples = samples.map(cleanSample).filter(Boolean).slice(item?-39:-40)
  if (item) samples.push(item)
  try { wx.setStorageSync(KEY,samples) } catch (_) { /* storage full: retain the bounded in-memory history */ }
}
function report() {
  record('snapshot')
  const legacy=safeRead(()=>wx.getSystemInfoSync())
  const device={...legacy,...safeRead(()=>wx.getDeviceInfo())}
  const app={...legacy,...safeRead(()=>wx.getAppBaseInfo())}
  const account=safeRead(()=>wx.getAccountInfoSync()).miniProgram || {}
  const raw={platform:device.platform,model:device.model,brand:device.brand,system:device.system,wechat:app.version,sdk:app.SDKVersion,version:account.version,env:account.envVersion,build:'support-1'}
  const environment={}
  for (const key of Object.keys(raw)) if (typeof raw[key]==='string' && /^[\w\u3400-\u9fff .()/-]{1,80}$/.test(raw[key])) environment[key]=raw[key]
  return {schema:'support-1',environment,samples:samples.slice()}
}
function install() { if (installed) return; installed=true; try { if(wx.onWindowResize) wx.onWindowResize(()=>record('resize')) } catch (_) {} }
module.exports={record,report,install}
