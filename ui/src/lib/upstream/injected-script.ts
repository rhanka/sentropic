/**
 * Generates a self-contained IIFE string (ES5-compatible) to be injected
 * into an external page. The script handles tab_read/tab_action commands
 * from the bridge iframe via postMessage.
 *
 * Context detection (in order):
 * 1. chrome.runtime available -> extension mode (not used here, extension injects differently)
 * 2. document.getElementById('__topai_bridge')?.contentWindow -> iframe bridge mode
 *
 * @param bridgeOrigin - The origin of the bridge iframe (e.g. "https://app.topai.com")
 * @returns A string containing the full IIFE source code
 */
export function generateInjectedScript(bridgeOrigin: string): string {
  // All output must be ES5-compatible: var, function, no arrow functions,
  // no const/let, no template literals.
  return (
    '(function() {' +
    '"use strict";' +

    // Re-entrant guard
    'if (window.__TOPAI_ACTIVE) return;' +
    'window.__TOPAI_ACTIVE = true;' +

    // Bridge origin
    'var BRIDGE_ORIGIN = ' + JSON.stringify(bridgeOrigin) + ';' +

    // --- Context detection ---
    'var MODE = "unknown";' +
    'var bridgeIframe = document.getElementById("__topai_bridge");' +
    'if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {' +
    '  MODE = "extension";' +
    '} else if (bridgeIframe && bridgeIframe.contentWindow) {' +
    '  MODE = "iframe";' +
    '} else {' +
    '  MODE = "iframe";' + // default to iframe, will check bridge element in sendResult
    '}' +

    // --- Badge ---
    'var badge = document.getElementById("__topai_badge") || document.createElement("div");' +
    'badge.id = "__topai_badge";' +
    'badge.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:2147483647;' +
    'padding:6px 14px;border-radius:20px;font-family:system-ui,sans-serif;font-size:13px;' +
    'font-weight:600;color:#fff;background:#6366f1;box-shadow:0 2px 8px rgba(0,0,0,.25);' +
    'cursor:default;user-select:none;transition:background .3s,opacity .3s;opacity:0.9;";' +
    'badge.textContent = "Connecting...";' +
    'if (!badge.parentNode) document.body.appendChild(badge);' +

    'function setBadgeState(state) {' +
    '  if (state === "connected") {' +
    '    badge.textContent = "Top AI \\u2713";' +
    '    badge.style.background = "#22c55e";' +
    '  } else if (state === "disconnected") {' +
    '    badge.textContent = "Disconnected";' +
    '    badge.style.background = "#ef4444";' +
    '    badge.style.opacity = "0.7";' +
    '  }' +
    '}' +

    // --- Utility: truncate to 60K chars ---
    'function truncate(str, maxLen) {' +
    '  if (!maxLen) maxLen = 60000;' +
    '  if (str.length <= maxLen) return str;' +
    '  return str.substring(0, maxLen) + "... [truncated]";' +
    '}' +

    // --- Handler: tab_read ---
    'function handleTabRead(callId, args) {' +
    '  var mode = (args && args.mode) || "dom";' +

    '  if (mode === "screenshot") {' +
    '    handleScreenshot(callId);' +
    '    return;' +
    '  }' +

    // mode=dom (default)
    '  var selector = (args && args.selector) || "body";' +
    '  try {' +
    '    var el = document.querySelector(selector);' +
    '    if (!el) {' +
    '      sendResult(callId, { error: "Element not found: " + selector });' +
    '      return;' +
    '    }' +
    '    var html = truncate(el.outerHTML);' +
    '    var text = truncate(el.textContent || "");' +
    '    sendResult(callId, { outerHTML: html, textContent: text });' +
    '  } catch (e) {' +
    '    sendResult(callId, { error: "tab_read error: " + String(e) });' +
    '  }' +
    '}' +

    // --- Handler: screenshot via getDisplayMedia ---
    'function handleScreenshot(callId) {' +
    '  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {' +
    '    sendResult(callId, { error: "getDisplayMedia not supported" });' +
    '    return;' +
    '  }' +
    '  navigator.mediaDevices.getDisplayMedia({ video: true })' +
    '    .then(function(stream) {' +
    '      var track = stream.getVideoTracks()[0];' +
    '      var video = document.createElement("video");' +
    '      video.srcObject = stream;' +
    '      video.onloadedmetadata = function() {' +
    '        video.play();' +
    '        setTimeout(function() {' +
    '          var canvas = document.createElement("canvas");' +
    '          var w = video.videoWidth;' +
    '          var h = video.videoHeight;' +
    '          if (w > 1280) { h = Math.round(h * (1280 / w)); w = 1280; }' +
    '          canvas.width = w;' +
    '          canvas.height = h;' +
    '          var ctx = canvas.getContext("2d");' +
    '          ctx.drawImage(video, 0, 0, w, h);' +
    '          track.stop();' +
    '          var dataUrl = canvas.toDataURL("image/jpeg", 0.95);' +
    '          sendScreenshotResult(callId, dataUrl);' +
    '        }, 200);' +
    '      };' +
    '    })' +
    '    .catch(function(err) {' +
    '      sendResult(callId, { error: "Screenshot failed: " + String(err) });' +
    '    });' +
    '}' +

    // --- Handler: tab_action ---
    'function handleTabAction(callId, args) {' +
    '  var action = (args && args.action) || "";' +
    '  var selector = (args && args.selector) || "";' +
    '  try {' +
    '    if (action === "click") {' +
    '      var el = document.querySelector(selector);' +
    '      if (!el) { sendResult(callId, { error: "Element not found: " + selector }); return; }' +
    '      el.click();' +
    '      sendResult(callId, { ok: true, action: "click", selector: selector });' +
    '    } else if (action === "input") {' +
    '      var el2 = document.querySelector(selector);' +
    '      if (!el2) { sendResult(callId, { error: "Element not found: " + selector }); return; }' +
    '      var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");' +
    '      if (nativeInputValueSetter && nativeInputValueSetter.set) {' +
    '        nativeInputValueSetter.set.call(el2, args.value || "");' +
    '      } else {' +
    '        el2.value = args.value || "";' +
    '      }' +
    '      el2.dispatchEvent(new Event("input", { bubbles: true }));' +
    '      el2.dispatchEvent(new Event("change", { bubbles: true }));' +
    '      sendResult(callId, { ok: true, action: "input", selector: selector });' +
    '    } else if (action === "scroll") {' +
    '      var x = Number(args.x) || 0;' +
    '      var y = Number(args.y) || 0;' +
    '      if (selector) {' +
    '        var el3 = document.querySelector(selector);' +
    '        if (el3) { el3.scrollBy(x, y); }' +
    '      } else {' +
    '        window.scrollBy(x, y);' +
    '      }' +
    '      sendResult(callId, { ok: true, action: "scroll" });' +
    '    } else {' +
    '      sendResult(callId, { error: "Unknown action: " + action });' +
    '    }' +
    '  } catch (e) {' +
    '    sendResult(callId, { error: "tab_action error: " + String(e) });' +
    '  }' +
    '}' +

    // --- Send result via postMessage to bridge iframe ---
    'function sendResult(callId, result) {' +
    '  var bridge = document.getElementById("__topai_bridge");' +
    '  if (!bridge || !bridge.contentWindow) return;' +
    '  bridge.contentWindow.postMessage({' +
    '    type: "tool_result",' +
    '    callId: callId,' +
    '    result: result' +
    '  }, BRIDGE_ORIGIN);' +
    '}' +

    'function sendScreenshotResult(callId, dataUrl) {' +
    '  var bridge = document.getElementById("__topai_bridge");' +
    '  if (!bridge || !bridge.contentWindow) return;' +
    '  bridge.contentWindow.postMessage({' +
    '    type: "screenshot_result",' +
    '    callId: callId,' +
    '    dataUrl: dataUrl' +
    '  }, BRIDGE_ORIGIN);' +
    '}' +

    // --- PostMessage listener for commands from bridge ---
    'window.addEventListener("message", function(event) {' +
    '  if (event.origin !== BRIDGE_ORIGIN) return;' +
    '  var data = event.data;' +
    '  if (!data || typeof data !== "object") return;' +

    '  if (data.type === "connected") {' +
    '    setBadgeState("connected");' +
    '    return;' +
    '  }' +

    '  if (data.type === "command") {' +
    '    var callId = data.callId;' +
    '    var toolName = data.toolName;' +
    '    var args = data.args || {};' +
    '    if (toolName === "tab_read") {' +
    '      handleTabRead(callId, args);' +
    '    } else if (toolName === "tab_action") {' +
    '      handleTabAction(callId, args);' +
    '    }' +
    '  }' +
    '});' +

    // --- On unload, set badge to disconnected ---
    'window.addEventListener("beforeunload", function() {' +
    '  setBadgeState("disconnected");' +
    '});' +

    // --- Register with bridge on init ---
    'function tryRegister() {' +
    '  var bi = document.getElementById("__topai_bridge");' +
    '  if (!bi || !bi.contentWindow) return;' +
    '  bi.contentWindow.postMessage({' +
    '    type: "register",' +
    '    url: location.href,' +
    '    title: document.title' +
    '  }, BRIDGE_ORIGIN);' +
    '}' +

    // iframe bridge mode: register via postMessage
    'if (MODE === "iframe") {' +
    '  var bi = document.getElementById("__topai_bridge");' +
    '  if (bi) {' +
    '    bi.addEventListener("load", function() { tryRegister(); });' +
    '    tryRegister();' +
    '  }' +
    '}' +

    '})();'
  );
}
