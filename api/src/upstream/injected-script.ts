/**
 * Generates a self-contained IIFE string (ES5-compatible) to be injected
 * into an external page. The script handles tab_read/tab_action commands
 * from the bridge iframe via postMessage, or via JSONP polling fallback.
 *
 * NOTE: This is a server-side copy of ui/src/lib/upstream/injected-script.ts.
 * Both must stay in sync. The API serves this for external script loading mode
 * (CSP-strict sites that block inline scripts but allow <script src>).
 *
 * Context detection (in order):
 * 1. chrome.runtime available -> extension mode
 * 2. document.getElementById('__topai_bridge')?.contentWindow -> iframe bridge mode
 * 3. window.__TOPAI_JSONP_MODE -> JSONP/img polling mode
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

    // Bridge origin: detect external loading via document.currentScript.src
    // If loaded via <script src>, read data-bridge-origin attribute.
    // If inline (no src), use the embedded bridgeOrigin.
    'var _cs = document.currentScript;' +
    'var BRIDGE_ORIGIN = (_cs && _cs.src && _cs.getAttribute("data-bridge-origin")) || ' + JSON.stringify(bridgeOrigin) + ';' +

    // --- Context detection ---
    'var MODE = "unknown";' +
    'var bridgeIframe = document.getElementById("__topai_bridge");' +
    'if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {' +
    '  MODE = "extension";' +
    '} else if (bridgeIframe && bridgeIframe.contentWindow) {' +
    '  MODE = "iframe";' +
    '} else if (window.__TOPAI_JSONP_MODE) {' +
    '  MODE = "jsonp";' +
    '} else {' +
    '  MODE = "iframe";' +
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

    // --- Send result: routes through the active channel ---
    'function sendResult(callId, result) {' +
    '  if (MODE === "jsonp") {' +
    '    sendResultViaImg(callId, result);' +
    '    return;' +
    '  }' +
    '  var bridge = document.getElementById("__topai_bridge");' +
    '  if (!bridge || !bridge.contentWindow) return;' +
    '  bridge.contentWindow.postMessage({' +
    '    type: "tool_result",' +
    '    callId: callId,' +
    '    result: result' +
    '  }, BRIDGE_ORIGIN);' +
    '}' +

    'function sendScreenshotResult(callId, dataUrl) {' +
    '  if (MODE === "jsonp") {' +
    '    sendResultViaImg(callId, { dataUrl: dataUrl });' +
    '    return;' +
    '  }' +
    '  var bridge = document.getElementById("__topai_bridge");' +
    '  if (!bridge || !bridge.contentWindow) return;' +
    '  bridge.contentWindow.postMessage({' +
    '    type: "screenshot_result",' +
    '    callId: callId,' +
    '    dataUrl: dataUrl' +
    '  }, BRIDGE_ORIGIN);' +
    '}' +

    // --- JSONP/img fallback channel ---
    'var jsonpToken = null;' +
    'var jsonpTabId = null;' +

    'function sendResultViaImg(callId, result) {' +
    '  if (!jsonpToken || !window.__TOPAI_API_ORIGIN) return;' +
    '  var data = encodeURIComponent(JSON.stringify({ callId: callId, result: result }));' +
    '  var img = new Image();' +
    '  img.src = window.__TOPAI_API_ORIGIN + "/api/v1/bookmarklet/result?token=" + jsonpToken + "&data=" + data;' +
    '}' +

    // JSONP command handler (called by poll response)
    'window.__TOPAI_CMD = function(cmd) {' +
    '  if (!cmd) return;' +
    '  var callId = cmd.callId;' +
    '  var toolName = cmd.toolName;' +
    '  var args = cmd.args || {};' +
    '  if (toolName === "tab_read") {' +
    '    handleTabRead(callId, args);' +
    '  } else if (toolName === "tab_action") {' +
    '    handleTabAction(callId, args);' +
    '  }' +
    '};' +

    'function startJsonpPolling() {' +
    '  if (MODE !== "jsonp" || !window.__TOPAI_API_ORIGIN) return;' +
    '  setInterval(function() {' +
    '    if (!jsonpToken) return;' +
    '    var s = document.createElement("script");' +
    '    s.src = window.__TOPAI_API_ORIGIN + "/api/v1/bookmarklet/poll?tab_id=" + jsonpTabId + "&token=" + jsonpToken;' +
    '    s.onload = function() { s.remove(); };' +
    '    s.onerror = function() { s.remove(); };' +
    '    document.head.appendChild(s);' +
    '  }, 2000);' +
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

    // JSONP mode: register via script tag, then start polling
    'if (MODE === "jsonp" && window.__TOPAI_API_ORIGIN) {' +
    '  window.__TOPAI_REG_CB = function(resp) {' +
    '    if (resp && resp.token) { jsonpToken = resp.token; jsonpTabId = resp.tab_id; setBadgeState("connected"); startJsonpPolling(); }' +
    '  };' +
    '  var regScript = document.createElement("script");' +
    '  regScript.src = window.__TOPAI_API_ORIGIN + "/api/v1/bookmarklet/register?url=" + encodeURIComponent(location.href) + "&title=" + encodeURIComponent(document.title) + "&callback=__TOPAI_REG_CB";' +
    '  regScript.onload = function() { regScript.remove(); };' +
    '  regScript.onerror = function() { regScript.remove(); };' +
    '  document.head.appendChild(regScript);' +
    '}' +

    '})();'
  );
}
