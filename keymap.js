// Pure ES5 module, shared by AutoX.js and the desktop checks.
var KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ-1';
function normalize(value) {
    var text = String(value).replace(/\s/g, '');
    if (!text || /[^a-zA-Z1-]/.test(text)) {
        throw new Error('请输入 A-Z、短横线 - 或数字 1；行内空白会自动忽略。');
    }
    return text.toUpperCase();
}
function parseBatch(value) {
    var lines = String(value).split(/\r\n|[\n\r\u2028\u2029]/);
    var groups = [];
    for (var i = 0; i < lines.length; i++) {
        if (!lines[i].replace(/\s/g, '')) continue;
        try { groups.push(normalize(lines[i])); }
        catch (error) { throw new Error('第 ' + (i + 1) + ' 行：' + error.message); }
    }
    if (!groups.length) throw new Error('请至少输入一行字母');
    return groups;
}
// Inject click/wait so the actual batch timing and cancellation can be checked without a phone.
function runBatch(groups, interval, click, wait, onGroupDone, groupDelay) {
    if (groupDelay === undefined) groupDelay = 10000;
    if (typeof groupDelay !== 'number' || !isFinite(groupDelay) || groupDelay < 0) throw new Error('组间等待时间无效');
    var completed = 0;
    for (var g = 0; g < groups.length; g++) {
        for (var i = 0; i < groups[g].length; i++) {
            wait(0);
            click(groups[g].charAt(i), g, i);
            completed++;
            if (i + 1 < groups[g].length) wait(interval);
        }
        if (g + 1 < groups.length) {
            onGroupDone(g + 1, groups.length);
            wait(groupDelay);
        }
    }
    return completed;
}
// A frozen clock preserves remaining delays as well as the caller's loop position.
function createPlaybackControl(now, synchronized) {
    synchronized = synchronized || function (fn) { return fn(); };
    var paused = false, cancelled = false, pausedAt = 0, pausedTotal = 0;
    function snapshot() {
        return synchronized(function () {
            return { paused: paused, cancelled: cancelled,
                time: (paused ? pausedAt : now()) - pausedTotal };
        });
    }
    return {
        snapshot: snapshot,
        setPaused: function (value) {
            synchronized(function () {
                if (value === paused) return;
                if (value) pausedAt = now();
                else pausedTotal += now() - pausedAt;
                paused = value;
            });
        },
        cancel: function () { synchronized(function () { cancelled = true; }); },
        wait: function (ms, sleep) {
            var end = snapshot().time + ms;
            while (true) {
                var state = snapshot();
                if (state.cancelled) throw new Error('已停止');
                if (!state.paused && state.time >= end) return;
                sleep(state.paused ? 50 : Math.min(50, Math.max(1, end - state.time)));
            }
        }
    };
}
function defaults(width, height) {
    return { width: width, height: height,
        a: { x: width * 0.125, y: height * 0.620 },
        g: { x: width * 0.865, y: height * 0.620 },
        v: { x: width * 0.125, y: height * 0.814 } };
}
function point(key, map) {
    var index = KEYS.indexOf(key);
    if (index < 0 || key.length !== 1) throw new Error('未知按键：' + key);
    var col = index % 7, row = Math.floor(index / 7);
    return {
        x: Math.round(map.a.x + col * (map.g.x - map.a.x) / 6 + row * (map.v.x - map.a.x) / 3),
        y: Math.round(map.a.y + col * (map.g.y - map.a.y) / 6 + row * (map.v.y - map.a.y) / 3)
    };
}
function validate(map, width, height) {
    if (!map || map.width !== width || map.height !== height) throw new Error('屏幕尺寸已改变，请重新校准。');
    if (!map.a || !map.g || !map.v || map.g.x - map.a.x < width * 0.25 || map.v.y - map.a.y < height * 0.05) {
        throw new Error('校准位置不合理，请依次点击 A、G、V 的中心。');
    }
    for (var i = 0; i < KEYS.length; i++) {
        var p = point(KEYS.charAt(i), map);
        if (!isFinite(p.x) || !isFinite(p.y) || p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) {
            throw new Error('按键坐标超出屏幕，请重新校准。');
        }
    }
    return map;
}
module.exports = { keys: KEYS, normalize: normalize, parseBatch: parseBatch, runBatch: runBatch, createPlaybackControl: createPlaybackControl, defaults: defaults, point: point, validate: validate };
