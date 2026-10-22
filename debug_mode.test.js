// Exercise the real script handlers with phone APIs mocked (no Android UI assertion).
var assert = require('node:assert/strict');
var fs = require('node:fs');
var vm = require('node:vm');
var source = fs.readFileSync(__dirname + '/mobile_input.js', 'utf8').replace(/floaty\.rawWindow\(\s*<[\s\S]*?\n\s*\);/g, 'floaty.rawWindow(null);');
function setup(failure) {
    var saved = { debugEnabled: true, map: { previous: true } }, elapsed = 0, captures = 0;
    var panel = { size: [-2, -2], setPosition: function () {}, setTouchable: function () {},
        setSize: function (w, h) { this.size = [w, h]; }, close: function () {} };
    ['menuBody', 'inputMenu', 'debugToggle', 'logToggle', 'copyLog', 'logBox', 'logText', 'status', 'inputRow', 'settingsRow', 'recognize', 'pauseResume', 'stop', 'title', 'quit', 'input', 'calibrate', 'settings', 'root'].forEach(function (name) {
        panel[name] = { handlers: {}, on: function (event, fn) { this.handlers[event] = fn; },
            setText: function (text) { this.text = text; }, setEnabled: function () {},
            setVisibility: function (value) { this.visibility = value; }, setOnTouchListener: function () {},
            getLocationOnScreen: function (pos) { pos[0] = 0; pos[1] = 0; },
            getWidth: function () { return 240; }, getHeight: function () { return 200; } };
    });
    function Atomic(value) { this.value = value; }
    Atomic.prototype.get = function () { return this.value; };
    Atomic.prototype.set = function (value) { this.value = value; };
    Atomic.prototype.getAndSet = function (value) { var old = this.value; this.value = value; return old; };
    function FakeDate() { return new Date(elapsed); }
    FakeDate.now = function () { return elapsed; };
    var context = {
        Date: FakeDate, auto: { waitFor: function () {} }, toast: function () {}, exit: function () {},
        setInterval: function () {}, sleep: function (ms) { elapsed += ms; }, press: function () { return true; },
        ui: { run: function (fn) { fn(); } }, floaty: { checkPermission: function () { return true; }, rawWindow: function () { return panel; } },
        storages: { create: function () { return { get: function (key, fallback) { return key in saved ? saved[key] : fallback; }, put: function (key, value) { saved[key] = value; } }; } },
        threads: { lock: function () { return { lock: function () {}, unlock: function () {} }; }, start: function (fn) { fn(); } },
        events: { observeKey: function () {}, onKeyDown: function () {}, on: function () {} },
        java: { util: { concurrent: { atomic: { AtomicBoolean: Atomic } } }, lang: { Integer: { TYPE: 0 }, reflect: { Array: { newInstance: function (_, length) { return new Int32Array(length); } } } } },
        android: { util: { DisplayMetrics: function () {} }, content: { Context: { WINDOW_SERVICE: 0 } }, os: { SystemClock: { elapsedRealtime: function () { return elapsed; } } } },
        context: { getSystemService: function () { return { getDefaultDisplay: function () { return { getRealMetrics: function (metrics) { metrics.widthPixels = 1080; metrics.heightPixels = 2400; } }; } }; } },
        images: {
            requestScreenCapture: function () { assert.deepEqual(panel.size, [0, 0]); return failure !== 'permission'; },
            captureScreen: function () {
                assert.deepEqual(panel.size, [0, 0], 'log panel must be hidden at capture');
                captures++;
                if (failure === 'capture') throw new Error('mock screenshot failure');
                return { getWidth: function () { return 1080; }, getHeight: function () { return 2400; } };
            },
            resize: function () { return { getBitmap: function () { return { getPixels: function () {} }; }, recycle: function () {} }; }
        },
        require: function (path) {
            if (path === './keymap.js') return require('./keymap.js');
            return { detect: function (_, w, h, check, report) {
                report('mock candidate diagnostics'); check();
                if (failure === 'match') throw new Error('mock recognition failure');
                return { a: { x: 67, y: 743 }, g: { x: 466, y: 743 }, v: { x: 67, y: 976 }, matched: 28, score: 0.96 };
            } };
        }
    };
    vm.createContext(context); vm.runInContext(source, context);
    return { context: context, panel: panel, saved: saved, captures: function () { return captures; } };
}
var good = setup();
['positive', 'dismiss', 'error'].forEach(function (action) {
    var input = setup();
    input.context.android.text = { InputType: { TYPE_CLASS_TEXT: 1, TYPE_TEXT_FLAG_MULTI_LINE: 131072 } };
    input.context.android.view = { Gravity: { TOP: 48, LEFT: 3 } };
    input.context.dialogs = { build: function (options) {
        assert.equal(options.inputPrefill, '');
        var handlers = {};
        return {
            getInputEditText: function () { return {
                setInputType: function () {}, setSingleLine: function () {}, setMinLines: function () {},
                setMaxLines: function () {}, setGravity: function () {}, getText: function () { return 'abcd\nbdcd'; }
            }; },
            on: function (name, fn) { handlers[name] = fn; },
            show: function () {
                assert.equal(input.panel.menuBody.visibility, 8);
                assert.equal(input.panel.inputMenu.visibility, 0);
                input.panel.inputMenu.handlers.click();
                assert.equal(input.panel.menuBody.visibility, 0);
                input.panel.inputMenu.handlers.click();
                assert.equal(input.panel.menuBody.visibility, 8);
                if (action === 'error') throw new Error('dialog error');
                handlers[action]();
            },
            dismiss: function () { handlers.dismiss(); }
        };
    } };
    if (action === 'error') assert.throws(function () { input.context.batchInput(); }, /dialog error/);
    else assert.equal(input.context.batchInput(), action === 'positive' ? 'abcd\nbdcd' : null);
    assert.equal(input.panel.menuBody.visibility, 0);
    assert.equal(input.panel.inputMenu.visibility, 8);
});
console.log('PASS: input collapses to one button, toggle retains text, confirm/cancel/error restore menu');
good.panel.recognize.handlers.click();
assert.equal(good.captures(), 1);
assert.equal(good.saved.map.width, 1080);
assert.deepEqual(good.panel.size, [-2, -2]);
assert.match(good.panel.logText.text, /28\/28/);
assert.match(good.panel.logText.text, /96.0%/);
good.context.batchInput = function () { return 'AB'; };
good.panel.input.handlers.click();
assert.match(good.panel.logText.text, /字符 A → \(135, 1487\)/);
assert.match(good.panel.logText.text, /字符 B →/);
var clipboard = '';
good.context.setClip = function (text) { clipboard = text; };
var beforeCopy = good.context.debugLines.join('\n');
good.panel.copyLog.handlers.click();
assert.ok(clipboard.endsWith(beforeCopy));
assert.match(clipboard, /28\/28/);
assert.match(clipboard, /字符 A →/);
assert.equal(good.context.debugLines.join('\n'), beforeCopy);
['permission', 'capture', 'match'].forEach(function (failure) {
    var bad = setup(failure);
    bad.panel.recognize.handlers.click();
    assert.equal(bad.saved.map.previous, true);
    assert.deepEqual(bad.panel.size, [-2, -2], 'restore panel on failure');
    assert.match(bad.panel.logText.text, /ERROR/);
});
good.panel.logToggle.handlers.click();
assert.equal(good.panel.logBox.visibility, 8);
good.context.debugLog('INFO', 'hidden but recorded');
good.panel.logToggle.handlers.click();
assert.match(good.panel.logText.text, /hidden but recorded/);
good.panel.debugToggle.handlers.click();
assert.equal(good.saved.debugEnabled, false);
good.context.debugLog('CLICK', 'must not record');
assert.ok(!good.context.debugLines.join('\n').includes('must not record'));
good.context.debugLog('ERROR', 'error while disabled');
good.panel.copyLog.handlers.click();
assert.match(clipboard, /error while disabled/);
good.panel.debugToggle.handlers.click();
assert.match(good.panel.logText.text, /error while disabled/);
for (var i = 0; i < 150; i++) good.context.debugLog('INFO', 'bounded ' + i);
assert.equal(good.context.debugLines.length, 120);
good.panel.copyLog.handlers.click();
assert.match(clipboard, /120 条/);
assert.ok(!clipboard.includes('bounded 29\n'));
var empty = setup();
empty.context.debugLines.length = 0;
empty.context.setClip = function () { throw new Error('Empty log must not change clipboard'); };
empty.panel.copyLog.handlers.click();
assert.equal(empty.context.debugLines.length, 0);
good.context.setClip = function () { throw new Error('mock clipboard error'); };
good.panel.copyLog.handlers.click();
assert.match(good.context.debugLines.join('\n'), /复制日志失败.*mock clipboard error/);
console.log('PASS: copy chronological snapshot, disabled-mode errors, empty logs and clipboard failure');
console.log('PASS: hidden during capture, restored on success/errors, diagnostics, click coordinates, toggle persistence, bounded logs');
