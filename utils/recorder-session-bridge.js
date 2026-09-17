'use strict'

/**
 * Serializes access to WeChat's process-wide RecorderManager.
 *
 * Recorder callbacks do not carry an operation ID, so a mutable "current page"
 * pointer is not enough: a delayed stop from page A can otherwise be mistaken
 * for page B's new recording. This bridge never overlaps start operations. It
 * retains the owner and session ID that initiated each operation until onStop
 * confirms the physical recorder ended, and queues at most the latest start.
 * This relies on RecorderManager emitting one terminal onStop per accepted start
 * and no callback from that operation after onStop. Because native callbacks have
 * no operation ID, arbitrary duplicate terminal callbacks cannot be distinguished
 * from a legitimate stop of the next session without an unsafe timing/path guess.
 */
function createRecorderSessionBridge(manager, options = {}) {
  if (!manager) throw new TypeError('A RecorderManager instance is required')

  const discardTemporaryRecording = typeof options.discardTemporaryRecording === 'function'
    ? options.discardTemporaryRecording
    : () => {}
  let nextSessionId = 0
  // 本 bridge 的 start() 抛错但原生层可能仍会迟到 onStart 时置位；
  // 用于区分“自己迟到的录音”（必须停掉）与“其他页面直接发起的录音”（不能干预）。
  let awaitingLateStart = false

  const bridge = {
    manager,
    owner: null,
    phase: 'idle',
    session: null,
    queuedStart: null,

    attach(owner) {
      this.owner = owner
    },

    detach(owner) {
      if (this.owner === owner) this.owner = null
    },

    start(owner, recorderOptions) {
      if (!owner) throw new TypeError('A recorder owner is required')
      if (
        this.owner !== owner ||
        owner._isDestroyed ||
        !owner._isPageVisible
      ) return null
      const request = {
        id: ++nextSessionId,
        owner,
        recorderOptions,
        cancelled: false,
        callbackObserved: false,
        started: false,
        stopRequested: false
      }

      // Assign before manager.start(): although WeChat callbacks are normally
      // asynchronous, this also makes synchronous test doubles unambiguous.
      owner._recorderSessionId = request.id
      if (this.phase === 'idle' && !this.session) {
        beginSession(request, true)
      } else {
        this.queuedStart = request
        // RecorderManager is process-wide: every replacement request must stop
        // the retained session, including same-page restarts after pause/settings.
        // Otherwise cancelling the queued token could leave the old capture live
        // while its callbacks are hidden behind the new owner token.
        if (this.session) cancelSession(this.session)
      }
      return request.id
    },

    stop(owner, sessionId) {
      let handled = false
      const queued = this.queuedStart
      if (
        queued &&
        queued.owner === owner &&
        (sessionId == null || queued.id === sessionId)
      ) {
        this.queuedStart = null
        handled = true
      }

      const session = this.session
      if (session && session.owner === owner) {
        // If the supplied ID names this owner's queued replacement, stopping it
        // also means the user's intent is "off" for the retained older session.
        const matchesSession = sessionId == null || session.id === sessionId
        const stoppedQueuedReplacement = handled && queued && queued.id === sessionId
        if (matchesSession || stoppedQueuedReplacement) {
          cancelSession(session)
          handled = true
        }
      }
      return handled
    },

    cancelOwner(owner) {
      // Revoke callback/start eligibility before stopping. RecorderManager test
      // doubles — and some native bridges — may invoke terminal callbacks while
      // stop() is still on the stack; that reentrancy must not let this owner
      // install another session while it is being detached.
      this.detach(owner)
      if (this.queuedStart && this.queuedStart.owner === owner) this.queuedStart = null
      if (this.session && this.session.owner === owner) cancelSession(this.session)
    }
  }

  function ownerCanReceive(request) {
    const owner = request && request.owner
    return Boolean(
      owner &&
      bridge.owner === owner &&
      owner._recorderSessionId === request.id &&
      !owner._isDestroyed &&
      owner._isPageVisible
    )
  }

  function notify(request, method, payload) {
    const owner = request && request.owner
    if (ownerCanReceive(request) && typeof owner[method] === 'function') {
      try { owner[method](payload, request.id) } catch (error) {}
    }
  }

  function stopManager() {
    try {
      manager.stop()
      return { ok: true, error: null }
    } catch (error) {
      return { ok: false, error }
    }
  }

  function requestSessionStop(session) {
    if (!session || session.stopRequested || bridge.session !== session) return false
    session.stopRequested = true
    bridge.phase = 'stopping'
    const result = stopManager()
    if (result.ok) return true

    // A throwing stop call gives no proof that the process-wide recorder ended,
    // so retaining this session is safer than overlapping another start. Fail the
    // queued request explicitly, then allow a later explicit start/cancel to retry.
    if (bridge.session === session) {
      session.stopRequested = false
      bridge.phase = session.started ? 'recording' : 'starting'
      const queued = bridge.queuedStart
      bridge.queuedStart = null
      if (queued) {
        queued.cancelled = true
        notify(queued, '_handleRecorderError', result.error)
      }
    }
    return false
  }

  function cancelSession(session) {
    if (!session || bridge.session !== session) return
    if (!session.cancelled) session.cancelled = true
    if (bridge.phase === 'recording' && !session.stopRequested) {
      requestSessionStop(session)
    }
    // Stopping before onStart is not reliable on every runtime. For a session
    // still starting, the global onStart handler below performs the stop even
    // if its page has already detached. A prior synchronous stop() failure leaves
    // stopRequested false, so a later cancel/start can safely retry the request.
  }

  function beginSession(request, rethrowStartError) {
    if (!ownerCanReceive(request)) {
      if (bridge.queuedStart === request) bridge.queuedStart = null
      return
    }

    bridge.session = request
    bridge.phase = 'starting'
    awaitingLateStart = false
    // RecorderManager 的 onXxx 是覆盖式单监听；其他页面（如费曼验收录音）注册回调后，
    // 本 bridge 将收不到 onStart/onStop，会卡在 starting/stopping。每次开始前重新绑定。
    bindListeners()
    try {
      manager.start(request.recorderOptions)
    } catch (error) {
      // Native callbacks can be synchronous. If one installed a replacement while
      // this start call was on the stack, the older catch must not erase it.
      if (bridge.session === request) {
        if (request.callbackObserved) {
          // Any callback proves the native operation was accepted far enough to
          // outlive this stack frame. Retain it until onStop instead of overlapping
          // a queued replacement, even if onStart itself was never emitted.
          request.cancelled = true
          requestSessionStop(request)
        } else {
          bridge.session = null
          bridge.phase = 'idle'
          awaitingLateStart = true
          if (!rethrowStartError) notify(request, '_handleRecorderError', error)
          drainQueuedStart()
        }
      }
      if (rethrowStartError) throw error
    }
  }

  function drainQueuedStart() {
    if (bridge.phase !== 'idle' || bridge.session) return
    const request = bridge.queuedStart
    bridge.queuedStart = null
    if (request && ownerCanReceive(request)) beginSession(request, false)
  }

  function finishSession(method, payload) {
    const session = bridge.session
    bridge.session = null
    bridge.phase = 'idle'
    if (session && (
      method !== '_handleRecorderStop' ||
      (!session.cancelled && !session.errored)
    )) {
      notify(session, method, payload)
    }
    drainQueuedStart()
  }

  function handleStart() {
    const session = bridge.session
    if (!session) {
      // A start with no session is either this bridge's own late start after a
      // failed start() — which must never leave capture running — or a recording
      // another page started directly on the shared RecorderManager, which must
      // be left alone (stopping it would also strand this bridge in 'stopping').
      if (!awaitingLateStart) return
      awaitingLateStart = false
      bridge.phase = 'stopping'
      stopManager()
      return
    }
    session.callbackObserved = true
    session.started = true
    if (session.cancelled) {
      requestSessionStop(session)
      return
    }
    bridge.phase = 'recording'
    notify(session, '_handleRecorderStart')
  }

  function handleFrameRecorded(result) {
    const session = bridge.session
    if (session) session.callbackObserved = true
    if (session && bridge.phase === 'recording' && !session.cancelled) {
      notify(session, '_handleRecorderFrame', result)
    }
  }

  function handleStop(result) {
    try {
      discardTemporaryRecording(result && result.tempFilePath)
    } catch (error) {
      // Cleanup is best effort and must never block session serialization.
    } finally {
      finishSession('_handleRecorderStop', result)
    }
  }

  function handleError(error) {
    const session = bridge.session
    // Treat an error as diagnostic while a physical recorder operation still
    // exists. RecorderManager can subsequently emit onStop for that same start,
    // and callbacks carry no operation ID; only onStop is safe to use as the
    // serialization barrier before launching a queued replacement.
    if (session) {
      session.callbackObserved = true
      session.errored = true
      const wasCancelled = session.cancelled
      if (!wasCancelled) notify(session, '_handleRecorderError', error)
      // The owner callback may synchronously stop A and start B. Never let the
      // remainder of A's error handler mutate the replacement session.
      if (bridge.session !== session) return
      if (!session.cancelled) session.cancelled = true
      requestSessionStop(session)
    }
  }

  function relay(method) {
    return () => {
      const session = bridge.session
      if (session) session.callbackObserved = true
      if (session && !session.cancelled) notify(session, method)
    }
  }
  const handlePause = relay('_handleRecorderPause')
  const handleResume = relay('_handleRecorderResume')
  const handleInterruptionBegin = relay('_handleRecorderInterruptionBegin')
  const handleInterruptionEnd = relay('_handleRecorderInterruptionEnd')

  function bindListeners() {
    manager.onStart(handleStart)
    manager.onFrameRecorded(handleFrameRecorded)
    manager.onStop(handleStop)
    manager.onError(handleError)
    if (manager.onPause) manager.onPause(handlePause)
    if (manager.onResume) manager.onResume(handleResume)
    if (manager.onInterruptionBegin) manager.onInterruptionBegin(handleInterruptionBegin)
    if (manager.onInterruptionEnd) manager.onInterruptionEnd(handleInterruptionEnd)
  }

  bindListeners()
  return bridge
}

let sharedBridge = null
let sharedManager = null

/**
 * RecorderManager 是整个小程序共用的单例，所有页面必须共用同一个 bridge，
 * 否则各自注册的回调会互相覆盖，队列与会话串行化也会失效。
 */
function getSharedRecorderBridge(options) {
  if (typeof wx === 'undefined' || !wx.getRecorderManager) return null
  const manager = wx.getRecorderManager()
  if (!manager) return null
  if (sharedBridge && sharedManager === manager) return sharedBridge
  sharedManager = manager
  sharedBridge = createRecorderSessionBridge(manager, options)
  return sharedBridge
}

module.exports = { createRecorderSessionBridge, getSharedRecorderBridge }
