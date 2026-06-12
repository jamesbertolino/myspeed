const NATIVE_HOST = 'com.myspeed.wifi'

// Called from content script (same-origin bridge)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action !== 'wifiScan') return false
  chrome.runtime.sendNativeMessage(NATIVE_HOST, { action: 'scan' }, (response) => {
    if (chrome.runtime.lastError) {
      sendResponse({ error: chrome.runtime.lastError.message, networks: [] })
    } else {
      sendResponse(response)
    }
  })
  return true // keep channel open for async response
})

// Called directly from the page via externally_connectable
chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  if (message.action !== 'wifiScan') return false
  chrome.runtime.sendNativeMessage(NATIVE_HOST, { action: 'scan' }, (response) => {
    if (chrome.runtime.lastError) {
      sendResponse({ error: chrome.runtime.lastError.message, networks: [] })
    } else {
      sendResponse(response)
    }
  })
  return true
})
