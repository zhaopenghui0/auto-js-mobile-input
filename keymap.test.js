var assert = require('node:assert/strict');
var m = require('./keymap.js');
assert.equal(m.normalize(' aB\nc d '), 'ABCD');
assert.equal(m.normalize('z-1'), 'Z-1');
assert.equal(m.normalize('abcdefghi'), 'ABCDEFGHI');
var longInput = 'abcdefghijklmnopqrstuvwxyz-1'.repeat(100);
assert.equal(m.normalize(longInput), longInput.toUpperCase());
assert.deepEqual(m.parseBatch('abcd\nbdcd'), ['ABCD', 'BDCD']);
assert.deepEqual(m.parseBatch('\r\n a b\r\n \t\r\ncd\ref\u2028gh\u2029ij\n'), ['AB', 'CD', 'EF', 'GH', 'IJ']);
assert.deepEqual(m.parseBatch(longInput), [longInput.toUpperCase()]);
assert.throws(function () { m.parseBatch(' \n\t'); });
assert.throws(function () { m.parseBatch('abcd\n\nb2'); }, /第 3 行/);
var now = 0, clicks = [], waits = [];
var total = m.runBatch(m.parseBatch('abcd\nbdcd'), 250, function (key) {
    clicks.push({ key: key, start: now });
    now += 60; // Simulated press duration.
}, function (ms) { waits.push(ms); now += ms; }, function () {});
assert.equal(total, 8);
assert.equal(clicks.map(function (item) { return item.key; }).join(''), 'ABCDBDCD');
assert.equal(clicks[4].start - (clicks[3].start + 60), 10000);
assert.equal(waits.filter(function (ms) { return ms === 10000; }).length, 1);
assert.equal(now, clicks[7].start + 60); // No trailing delay.
var sent = '';
assert.throws(function () {
    m.runBatch(['ABCD', 'BDCD'], 250, function (key) { sent += key; }, function (ms) {
        if (ms === 10000) throw new Error('cancelled');
    }, function () {});
}, /cancelled/);
assert.equal(sent, 'ABCD');
var singleWaits = [];
m.runBatch(['A'], 250, function () {}, function (ms) { singleWaits.push(ms); }, function () {});
assert.deepEqual(singleWaits, [0]);
[0, 2500, 15000].forEach(function (delay) {
    var elapsed = 0, starts = [];
    m.runBatch(['A', 'B'], 250, function () {
        starts.push(elapsed);
        elapsed += 60;
    }, function (ms) { elapsed += ms; }, function () {}, delay);
    assert.equal(starts[1] - (starts[0] + 60), delay);
    assert.equal(elapsed, starts[1] + 60);
});
[-1, NaN, Infinity].forEach(function (delay) {
    assert.throws(function () { m.runBatch(['A'], 250, function () {}, function () {}, function () {}, delay); });
});
console.log('PASS: custom batch delay, zero delay and invalid delay rejection');
// Freeze a delay after 100 ms, resume 500 ms later: exactly 900 ms remain.
var wall = 0;
var control = m.createPlaybackControl(function () { return wall; });
control.wait(1000, function (ms) {
    wall += ms;
    if (wall === 100) control.setPaused(true);
    if (wall === 600) control.setPaused(false);
});
assert.equal(wall, 1500);
// Pause after B, then resume the same batch loop without replaying A or B.
wall = 0;
control = m.createPlaybackControl(function () { return wall; });
var resumedKeys = '', resumed = false;
m.runBatch(['ABCD', 'BDCD'], 250, function (key) {
    resumedKeys += key;
    if (resumedKeys === 'AB') control.setPaused(true);
}, function (ms) {
    control.wait(ms, function (slice) {
        wall += slice;
        if (control.snapshot().paused) {
            assert.equal(resumedKeys, 'AB');
            if (wall >= 750) { control.setPaused(false); resumed = true; }
        }
    });
}, function () {}, 10000);
assert.equal(resumed, true);
assert.equal(resumedKeys, 'ABCDBDCD');
assert.equal(wall, 12000); // 1500 ms character gaps + 10000 ms group gap + 500 ms paused.
control.setPaused(true);
assert.throws(function () {
    control.wait(0, function () { control.cancel(); });
}, /已停止/);
console.log('PASS: pause freezes remaining wait, resume preserves cursor, stop works while paused');
console.log('PASS: batch parsing, exact 10-second gap after press, no trailing gap, cancellation');
['', '你好', 'ab2', 'a.b', 'ß'].forEach(function (input) {
    assert.throws(function () { m.normalize(input); });
});
var map = { width: 1080, height: 2400, a: { x: 100, y: 1400 }, g: { x: 880, y: 1400 }, v: { x: 100, y: 1850 } };
m.validate(map, 1080, 2400);
assert.deepEqual('ABCD'.split('').map(function (key) { return m.point(key, map); }), [
    { x: 100, y: 1400 }, { x: 230, y: 1400 }, { x: 360, y: 1400 }, { x: 490, y: 1400 }
]);
assert.deepEqual(m.point('H', map), { x: 100, y: 1550 });
assert.deepEqual(m.point('1', map), { x: 880, y: 1850 });
assert.deepEqual(m.point('-', map), { x: 750, y: 1850 });
assert.throws(function () { m.validate(map, 2400, 1080); });
assert.throws(function () { m.point('?', map); });
[ [1080, 2400], [720, 1600], [1440, 3200] ].forEach(function (size) {
    m.validate(m.defaults(size[0], size[1]), size[0], size[1]);
});
console.log('PASS: normalization, invalid input, click order, row boundaries, calibration and screen sizes');
var source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'mobile_input.js'), 'utf8');
var layouts = 0;
source = source.replace(/floaty\.rawWindow\(\s*<[\s\S]*?\n\s*\);/g, function () {
    layouts++;
    return 'floaty.rawWindow(null);';
});
assert.equal(layouts, 2);
new (require('node:vm').Script)(source);
console.log('PASS: JavaScript syntax (AutoX XML layouts excluded; device runtime not tested)');
