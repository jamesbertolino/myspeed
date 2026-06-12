// Bridge: page → content script → background → native host
// The page dispatches 'myspeed:wifi-scan-request' and listens for 'myspeed:wifi-scan-response'

window.addEventListener('myspeed:wifi-scan-request', () => {
  chrome.runtime.sendMessage({ action: 'wifiScan' }, (response) => {
    const detail = chrome.runtime.lastError
      ? { error: chrome.runtime.lastError.message, networks: [] }
      : response
    window.dispatchEvent(new CustomEvent('myspeed:wifi-scan-response', { detail }))
  })
})

// Let the page know the extension is present
window.dispatchEvent(new CustomEvent('myspeed:extension-ready'))
