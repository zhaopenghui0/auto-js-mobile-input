// Android AutoX.js (Rhino). Keep keymap.js and auto_coordinates.js beside this file.
// Run as a normal script, not in "ui" mode.
auto.waitFor();
if (!floaty.checkPermission()) {
    toast('请允许悬浮窗权限，然后重新运行脚本');
    floaty.requestPermission();
    exit();
}
var mapping = require('./keymap.js');
var store = storages.create('mobile_input_spell_v1');
var busy = false;
var cancelled = new java.util.concurrent.atomic.AtomicBoolean(false);
var overlay = null;
var playback = null;
var batchActive = false;
var progress = '';
var captureReady = false;
var debugEnabled = store.get('debugEnabled', false) === true;
var debugVisible = true;
var debugLines = [];
var debugLock = threads.lock();
var debugDirty = new java.util.concurrent.atomic.AtomicBoolean(false);
var panel = floaty.rawWindow(
    <vertical id="root" bg="#EE263238" w="auto">
        <button id="inputMenu" text="展开菜单" w="100" visibility="gone" />
        <vertical id="menuBody" padding="8" w="240">
        <text id="title" text="字母顺序点击 · 拖动此处" textColor="#FFFFFF" textSize="15sp" padding="4" />
        <text id="status" text="打开游戏字母页后，点击输入" textColor="#CFD8DC" textSize="12sp" />
        <horizontal id="inputRow">
            <button id="input" text="输入 / 粘贴" w="140" />
            <button id="calibrate" text="手动校准" w="84" />
        </horizontal>
        <button id="recognize" text="自动识别坐标" />
        <horizontal id="settingsRow">
            <button id="settings" text="设置" w="112" />
            <button id="quit" text="退出" w="112" />
        </horizontal>
        <horizontal>
            <button id="pauseResume" text="暂停" enabled="false" w="112" />
            <button id="stop" text="停止" enabled="false" w="112" />
        </horizontal>
        <horizontal>
            <button id="debugToggle" text="调试：关" w="112" />
            <button id="logToggle" text="收起日志" enabled="false" w="112" />
        </horizontal>
        <scroll id="logBox" h="140" visibility="gone" bg="#DD101820">
            <text id="logText" text="调试日志" textColor="#D4E9FF" textSize="11sp" padding="5" />
        </scroll>
        <button id="copyLog" text="复制日志" />
        <text text="确定后倒计时 3 秒；停止按钮或音量上键终止" textColor="#CFD8DC" textSize="11sp" />
        </vertical>
    </vertical>
);
panel.setPosition(20, 100);
setInterval(function () { renderDebugLog(); }, 250);

function debugLog(level, message) {
    if (!debugEnabled && level !== 'ERROR') return;
    var date = new Date();
    function pad(value) { return value < 10 ? '0' + value : String(value); }
    var line = pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds()) +
        ' [' + level + '] ' + String(message).slice(0, 3000);
    debugLock.lock();
    try {
        debugLines.push(line);
        if (debugLines.length > 120) debugLines.shift();
    } finally { debugLock.unlock(); }
    debugDirty.set(true);
}
function renderDebugLog() {
    if (!debugEnabled || !debugVisible || !debugDirty.getAndSet(false)) return;
    var text;
    debugLock.lock();
    try { text = debugLines.slice().reverse().join('\n'); } finally { debugLock.unlock(); }
    ui.run(function () { panel.logText.setText(text || '暂无日志'); });
}
function updateDebugUI() {
    ui.run(function () {
        panel.debugToggle.setText(debugEnabled ? '调试：开' : '调试：关');
        panel.logToggle.setEnabled(debugEnabled);
        panel.logToggle.setText(debugVisible ? '收起日志' : '查看日志');
        panel.logBox.setVisibility(debugEnabled && debugVisible ? 0 : 8);
    });
    debugDirty.set(true);
    renderDebugLog();
}
function toggleDebug() {
    debugEnabled = !debugEnabled;
    store.put('debugEnabled', debugEnabled);
    if (debugEnabled) {
        debugVisible = true;
        debugLog('INFO', '调试模式已开启；保留最近 120 条日志，最新在上，可上下滑动。收起日志仍继续记录。');
        debugLog('INFO', '当前坐标：' + JSON.stringify(store.get('map', null)));
    }
    updateDebugUI();
}
panel.debugToggle.on('click', toggleDebug);
panel.logToggle.on('click', function () {
    debugVisible = !debugVisible;
    updateDebugUI();
});
panel.copyLog.on('click', function () {
    var lines;
    debugLock.lock();
    try { lines = debugLines.slice(); } finally { debugLock.unlock(); }
    if (!lines.length) {
        toast('暂无日志，请开启调试模式后重现问题');
        return;
    }
    try {
        setClip('mobile_input 调试日志（' + lines.length + ' 条，按时间从早到晚）\n\n' + lines.join('\n'));
        toast('已复制 ' + lines.length + ' 条日志，可直接粘贴发送');
    } catch (error) {
        debugLog('ERROR', '复制日志失败：' + String(error.stack || error));
        toast('复制失败，请查看报错日志');
        renderDebugLog();
    }
});
updateDebugUI();
debugLog('INFO', '脚本启动，调试模式已恢复');

function screenSize() {
    var metrics = new android.util.DisplayMetrics();
    context.getSystemService(android.content.Context.WINDOW_SERVICE).getDefaultDisplay().getRealMetrics(metrics);
    return { width: Number(metrics.widthPixels), height: Number(metrics.heightPixels) };
}
function status(text) { ui.run(function () { panel.status.setText(text); }); }
function visible(show) {
    ui.run(function () {
        panel.setTouchable(show);
        panel.setSize(show ? -2 : 0, show ? -2 : 0);
    });
}
function pause(ms) {
    if (batchActive && playback) {
        playback.wait(ms, sleep);
        return;
    }
    var end = Date.now() + ms;
    while (Date.now() < end) {
        if (cancelled.get()) throw new Error('已停止');
        sleep(Math.min(50, Math.max(1, end - Date.now())));
    }
    if (cancelled.get()) throw new Error('已停止');
}
function launch(job) {
    if (busy) return;
    busy = true;
    cancelled.set(false);
    threads.start(function () {
        try { job(); }
        catch (error) {
            var message = String(error.message || error);
            debugLog(cancelled.get() ? 'INFO' : 'ERROR', message + (cancelled.get() ? '' : '\n' + String(error.stack || '')));
            toast(message);
            status(message);
        }
        finally {
            batchActive = false;
            playback = null;
            ui.run(function () {
                panel.inputRow.setVisibility(0);
                panel.settingsRow.setVisibility(0);
                panel.recognize.setVisibility(0);
                panel.pauseResume.setEnabled(false);
                panel.stop.setEnabled(false);
                panel.pauseResume.setText('暂停');
            });
            if (overlay) { ui.run(function () { overlay.close(); }); overlay = null; }
            visible(true);
            renderDebugLog();
            busy = false;
        }
    });
}
function stopCurrentTask() {
    if (busy) {
        cancelled.set(true);
        debugLog('INFO', '收到停止请求：' + progress);
        if (playback) playback.cancel();
        ui.run(function () {
            panel.pauseResume.setEnabled(false);
            panel.stop.setEnabled(false);
        });
        toast('停止请求已收到');
    }
}
events.observeKey();
events.onKeyDown('volume_up', stopCurrentTask);
panel.stop.on('click', function () {
    if (batchActive) stopCurrentTask();
});
events.on('exit', function () {
    cancelled.set(true);
    if (playback) playback.cancel();
    if (overlay) overlay.close();
    panel.close();
});

// Drag the title to keep the panel away from the game controls.
var drag = {};
panel.title.setOnTouchListener(function (view, event) {
    if (event.getAction() === 0) {
        drag = { x: event.getRawX(), y: event.getRawY(), px: panel.getX(), py: panel.getY() };
    } else if (event.getAction() === 2) {
        panel.setPosition(Math.max(0, drag.px + event.getRawX() - drag.x), Math.max(0, drag.py + event.getRawY() - drag.y));
    }
    return true;
});
panel.quit.on('click', function () { exit(); });
function updatePlaybackStatus() {
    ui.run(function () {
        if (!batchActive || !playback || cancelled.get()) return;
        var paused = playback.snapshot().paused;
        panel.pauseResume.setText(paused ? '继续' : '暂停');
        panel.status.setText((paused ? '已暂停 · ' : '') + progress);
    });
}
panel.pauseResume.on('click', function () {
    if (!batchActive || !playback || cancelled.get()) return;
    playback.setPaused(!playback.snapshot().paused);
    debugLog('INFO', (playback.snapshot().paused ? '暂停：' : '继续：') + progress);
    updatePlaybackStatus();
});
function beginPlayback() {
    var lock = threads.lock();
    playback = mapping.createPlaybackControl(function () {
        return Number(android.os.SystemClock.elapsedRealtime());
    }, function (fn) {
        lock.lock();
        try { return fn(); } finally { lock.unlock(); }
    });
    if (cancelled.get()) playback.cancel();
    batchActive = true;
    ui.run(function () {
        panel.inputRow.setVisibility(8);
        panel.settingsRow.setVisibility(8);
        panel.recognize.setVisibility(8);
        panel.pauseResume.setEnabled(true);
        panel.stop.setEnabled(true);
        panel.pauseResume.setText('暂停');
    });
}
function panelCovers(point) {
    var covered = false;
    ui.run(function () {
        var pos = java.lang.reflect.Array.newInstance(java.lang.Integer.TYPE, 2);
        panel.root.getLocationOnScreen(pos);
        covered = point.x >= pos[0] && point.x < pos[0] + panel.root.getWidth() &&
            point.y >= pos[1] && point.y < pos[1] + panel.root.getHeight();
    });
    return covered;
}
function groupDelaySeconds() {
    var seconds = Number(store.get('groupDelaySeconds', 10));
    return isFinite(seconds) && seconds >= 0 && seconds <= 3600 ? seconds : 10;
}
var inputMenuCollapsed = false;
function setInputMenu(collapsed, active) {
    inputMenuCollapsed = collapsed;
    ui.run(function () {
        panel.menuBody.setVisibility(collapsed ? 8 : 0);
        panel.inputMenu.setVisibility(active ? 0 : 8);
        panel.inputMenu.setText(collapsed ? '展开菜单' : '收起菜单');
        panel.setSize(-2, -2);
    });
}
panel.inputMenu.on('click', function () {
    setInputMenu(!inputMenuCollapsed, true);
});
function batchInput() {
    var done = new java.util.concurrent.atomic.AtomicBoolean(false);
    var result = null;
    var dialog = null;
    try {
        setInputMenu(true, true);
        ui.run(function () {
            dialog = dialogs.build({
                title: '批量输入 / 粘贴',
                content: '每行一组，不限长度；每组完成后等待 ' + groupDelaySeconds() + ' 秒。空行自动跳过。',
                inputPrefill: '',
                positive: '确定', negative: '取消', canceledOnTouchOutside: false
            });
            var edit = dialog.getInputEditText();
            edit.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE);
            edit.setSingleLine(false);
            edit.setMinLines(4);
            edit.setMaxLines(8);
            edit.setGravity(android.view.Gravity.TOP | android.view.Gravity.LEFT);
            dialog.on('positive', function () {
                result = String(edit.getText());
                done.set(true);
            });
            dialog.on('dismiss', function () { done.set(true); });
            dialog.show();
        });
        while (!done.get()) pause(50);
        return result;
    } finally {
        try {
            if (dialog) ui.run(function () { dialog.dismiss(); });
        } finally {
            setInputMenu(false, false);
        }
    }
}
panel.input.on('click', function () { launch(function () {
    var raw = batchInput();
    if (raw === null) return;
    var groups = mapping.parseBatch(raw);
    var size = screenSize();
    var map = mapping.validate(store.get('map', mapping.defaults(size.width, size.height)), size.width, size.height);
    var interval = Number(store.get('interval', 250));
    if (!isFinite(interval) || interval < 100 || interval > 2000) interval = 250;
    var groupDelay = groupDelaySeconds();
    debugLog('INFO', '开始批量：' + groups.length + ' 组，点击间隔 ' + interval + 'ms，组间等待 ' + groupDelay + 's');
    debugLog('INFO', '使用坐标：' + JSON.stringify(map));
    beginPlayback();
    for (var count = 3; count > 0; count--) {
        progress = count + ' 秒后开始，共 ' + groups.length + ' 组';
        updatePlaybackStatus();
        toast(count + ' 秒后开始，共 ' + groups.length + ' 组；音量上键停止');
        pause(1000);
    }
    var completed = 0;
    mapping.runBatch(groups, interval, function (key, groupIndex, charIndex) {
        var current = screenSize();
        if (current.width !== size.width || current.height !== size.height) throw new Error('屏幕方向已改变，已停止，请重新校准');
        var p = mapping.point(key, map);
        while (panelCovers(p)) {
            playback.setPaused(true);
            progress = '面板挡住 ' + key + '，拖开面板后点继续';
            debugLog('INFO', progress + '；也可收起日志以缩小面板');
            updatePlaybackStatus();
            pause(0);
        }
        pause(0);
        current = screenSize();
        if (current.width !== size.width || current.height !== size.height) throw new Error('屏幕方向已改变，已停止，请重新校准');
        debugLog('CLICK', '第 ' + (groupIndex + 1) + ' 组第 ' + (charIndex + 1) + ' 字符 ' + key + ' → (' + p.x + ', ' + p.y + ')，按压 60ms');
        if (!press(p.x, p.y, 60)) throw new Error('第 ' + (groupIndex + 1) + ' 组第 ' + (charIndex + 1) + ' 个字符点击失败；共已发送 ' + completed + ' 个字符');
        completed++;
        progress = '第 ' + (groupIndex + 1) + '/' + groups.length + ' 组，已点击 ' + (charIndex + 1) + '/' + groups[groupIndex].length;
        updatePlaybackStatus();
    }, pause, function (finished, total) {
        progress = '已完成 ' + finished + '/' + total + ' 组，组间等待中';
        debugLog('INFO', progress + '，等待 ' + groupDelay + 's');
        updatePlaybackStatus();
        toast('已完成 ' + finished + '/' + total + ' 组，' + groupDelay + ' 秒后继续；音量上键停止');
    }, Math.round(groupDelay * 1000));
    if (cancelled.get()) throw new Error('已停止');
    status('已完成 ' + groups.length + ' 组（' + completed + ' 次点击）');
    debugLog('INFO', '批量完成：' + groups.length + ' 组，已发送 ' + completed + ' 次点击');
    toast('批量点击完成：' + groups.length + ' 组');
}); });

panel.recognize.on('click', function () { launch(function () {
    // Load lazily so a missing recognition file does not break manual calibration.
    var detector;
    try { detector = require('./auto_coordinates.js'); }
    catch (error) { throw new Error('请把 auto_coordinates.js 与主脚本放在同一文件夹；仍可使用手动校准'); }
    status('正在识别，请保持字母键盘页面');
    debugLog('INFO', '自动识别开始；隐藏控制面板与调试日志，结束后恢复');
    // The log is a child of this panel: hiding it also hides the entire log window.
    visible(false);
    pause(400);
    if (!captureReady) {
        debugLog('INFO', '正在申请完整屏幕截图权限');
        if (!images.requestScreenCapture()) throw new Error('未获得截图权限，原坐标未修改；可使用手动校准');
        captureReady = true;
    }
    pause(1000);
    var size = screenSize();
    var screenshot;
    try { screenshot = images.captureScreen(); }
    catch (error) {
        debugLog('ERROR', '截图异常：' + String(error.stack || error));
        captureReady = false;
        throw new Error('截图失败，请重试并授权完整屏幕；原坐标未修改');
    }
    debugLog('INFO', '截图 ' + screenshot.getWidth() + '×' + screenshot.getHeight() + '；屏幕 ' + size.width + '×' + size.height);
    if (screenshot.getWidth() !== size.width || screenshot.getHeight() !== size.height) {
        throw new Error('截图不是完整屏幕或方向不一致，请重新运行脚本并选择共享整个屏幕；原坐标未修改');
    }
    var scaled = null;
    try {
        var width = Math.min(540, size.width);
        var height = Math.round(size.height * width / size.width);
        debugLog('INFO', '识别用图尺寸 ' + width + '×' + height);
        scaled = images.resize(screenshot, [width, height]);
        var pixels = java.lang.reflect.Array.newInstance(java.lang.Integer.TYPE, width * height);
        if (typeof scaled.getBitmap === 'function') {
            scaled.getBitmap().getPixels(pixels, 0, width, 0, 0, width, height);
        } else {
            for (var y = 0; y < height; y++) {
                if (y % 32 === 0) pause(0);
                for (var x = 0; x < width; x++) pixels[y * width + x] = images.pixel(scaled, x, y);
            }
        }
        var recognitionDeadline = Date.now() + 20000;
        var result = detector.detect(pixels, width, height, function () {
            pause(0);
            if (Date.now() > recognitionDeadline) throw new Error('识别超时，请重试或手动校准；原坐标未修改');
        }, function (message) { debugLog('MATCH', message); });
        function screenPoint(point) {
            return { x: Math.round((point.x + 0.5) * size.width / width), y: Math.round((point.y + 0.5) * size.height / height) };
        }
        var map = { width: size.width, height: size.height,
            a: screenPoint(result.a), g: screenPoint(result.g), v: screenPoint(result.v) };
        var current = screenSize();
        mapping.validate(map, current.width, current.height);
        pause(0);
        store.put('map', map);
        debugLog('MATCH', '识别成功：匹配 ' + result.matched + '/28，整体相似度 ' + (result.score * 100).toFixed(1) + '%（非概率）');
        debugLog('MATCH', '已保存屏幕坐标：' + JSON.stringify(map));
        status('自动识别成功，已保存坐标（匹配 ' + result.matched + '/28）');
        toast('自动识别成功，已保存坐标，可以输入了');
    } finally {
        if (scaled) scaled.recycle();
        // captureScreen() images are owned/reused by AutoX; do not recycle them here.
    }
}); });

panel.calibrate.on('click', function () { launch(function () {
    if (!dialogs.confirm('三点校准', '先打开与截图相同的字母页。接下来依次触摸 A、G、V 的中心。校准触摸不会传给游戏。音量上键可取消。')) return;
    visible(false);
    pause(400);
    var size = screenSize();
    var points = [];
    var index = new java.util.concurrent.atomic.AtomicInteger(0);
    ui.run(function () {
        overlay = floaty.rawWindow(
            <frame id="surface" bg="#22000000">
                <text id="hint" text="1/3：点击 A 的中心（音量上键取消）" textColor="#FFFFFF" bg="#DD263238" textSize="18sp" padding="16" layout_gravity="top|center" marginTop="60" />
            </frame>
        );
        overlay.setSize(-1, -1);
        overlay.surface.setOnTouchListener(function (view, event) {
            if (event.getAction() === 1 && index.get() < 3) {
                points.push({ x: Number(event.getRawX()), y: Number(event.getRawY()) });
                var next = index.incrementAndGet();
                if (next < 3) overlay.hint.setText((next + 1) + '/3：点击 ' + ['A', 'G', 'V'][next] + ' 的中心（音量上键取消）');
            }
            return true;
        });
    });
    var deadline = Date.now() + 60000;
    while (index.get() < 3) {
        pause(50);
        if (Date.now() > deadline) throw new Error('校准超时，请重试');
    }
    var current = screenSize();
    var map = { width: size.width, height: size.height, a: points[0], g: points[1], v: points[2] };
    mapping.validate(map, current.width, current.height);
    store.put('map', map);
    debugLog('INFO', '手动校准已保存：' + JSON.stringify(map));
    status('已保存校准；可以输入字母');
    toast('校准完成');
}); });

panel.settings.on('click', function () { launch(function () {
    var choice = dialogs.select('设置', '调整点击间隔', '组间等待时间（当前 ' + groupDelaySeconds() + ' 秒）', '恢复截图默认坐标', '调试模式（当前' + (debugEnabled ? '开启' : '关闭') + '）');
    if (choice === 0) {
        var value = dialogs.rawInput('点击间隔（100–2000 毫秒）', String(store.get('interval', 250)));
        if (value === null) return;
        var ms = Number(value);
        if (!isFinite(ms) || ms < 100 || ms > 2000) throw new Error('请输入 100–2000 之间的数字');
        store.put('interval', Math.round(ms));
        status('点击间隔：' + Math.round(ms) + ' 毫秒');
    } else if (choice === 1) {
        var delayValue = dialogs.rawInput('组间等待时间（0–3600 秒，可填小数；默认 10）', String(groupDelaySeconds()));
        if (delayValue === null) return;
        var seconds = Number(delayValue);
        if (!String(delayValue).trim() || !isFinite(seconds) || seconds < 0 || seconds > 3600) throw new Error('请输入 0–3600 之间的秒数');
        seconds = Math.round(seconds * 1000) / 1000;
        store.put('groupDelaySeconds', seconds);
        status('组间等待时间：' + seconds + ' 秒');
    } else if (choice === 2) {
        store.remove('map');
        status('已恢复截图默认坐标');
        debugLog('INFO', '已恢复截图默认坐标');
    } else if (choice === 3) {
        toggleDebug();
    }
}); });
