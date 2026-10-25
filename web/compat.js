// Small fallbacks for the older Android WebView shipped on some Huawei phones.
if (!window.structuredClone) window.structuredClone = function (value) { return JSON.parse(JSON.stringify(value)); };
if (!String.prototype.replaceAll) String.prototype.replaceAll = function (search, replacement) { return this.split(search).join(replacement); };
if (!AbortSignal.timeout) AbortSignal.timeout = function (delay) { var controller = new AbortController(); setTimeout(function () { controller.abort(); }, delay); return controller.signal; };
