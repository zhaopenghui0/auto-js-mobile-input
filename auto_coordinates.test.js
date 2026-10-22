var assert = require('node:assert/strict');
var detector = require('./auto_coordinates.js');
var mapping = require('./keymap.js');
var fixture = require('./tests/reference-mask.json');
var width = fixture.width, height = fixture.height;
var reference = new Int32Array(width * height);
fixture.runs.forEach(function (row) {
    for (var i = 1; i < row.length; i += 2) {
        for (var x = row[i]; x < row[i + 1]; x++) reference[row[0] * width + x] = 0xFFD08020;
    }
});
assert.equal(detector.isGold(0xFFD08020), true);
assert.equal(detector.isGold(0xFF4A5273), false);
assert.equal(detector.isGold(0xFFFF3030), false);
function verify(pixels, scale, offsetX, offsetY) {
    var result = detector.detect(pixels, width, height);
    assert.ok(result.matched >= 25);
    assert.ok(Math.abs(result.a.x - (67.5 * scale + offsetX)) < 4);
    assert.ok(Math.abs(result.a.y - (743.5 * scale + offsetY)) < 4);
    assert.ok(Math.abs(result.g.x - (466.5 * scale + offsetX)) < 4);
    assert.ok(Math.abs(result.v.y - (976.5 * scale + offsetY)) < 4);
    mapping.validate({ width: width, height: height, a: result.a, g: result.g, v: result.v }, width, height);
    console.log('PASS: screenshot glyphs, scale=' + scale + ', offset=' + offsetX + ',' + offsetY + ', matched=' + result.matched);
}
verify(reference, 1, 0, 0);
function transform(scale, offsetX, offsetY) {
    var output = new Int32Array(width * height);
    for (var y = 0; y < height; y++) for (var x = 0; x < width; x++) {
        var sx = Math.floor((x - offsetX) / scale), sy = Math.floor((y - offsetY) / scale);
        if (sx >= 0 && sx < width && sy >= 0 && sy < height) output[y * width + x] = reference[sy * width + sx];
    }
    return output;
}
verify(transform(0.8, 54, 80), 0.8, 54, 80);
verify(transform(1, 12, -110), 1, 12, -110);
// Masks extracted after bilinear resampling of the actual RGB screenshot (Android-like resizing).
require('./tests/linear-variants.json').forEach(function (variant) {
    var pixels = new Int32Array(width * height);
    variant.runs.forEach(function (row) {
        for (var i = 1; i < row.length; i += 2) {
            for (var x = row[i]; x < row[i + 1]; x++) pixels[row[0] * width + x] = 0xFFD08020;
        }
    });
    verify(pixels, variant.scale, variant.x, variant.y);
});
assert.throws(function () { detector.detect(new Int32Array(width * height), width, height); }, /未识别/);
var missing = reference.slice();
for (var y = 715; y < 850; y++) missing.fill(0, y * width, (y + 1) * width);
assert.throws(function () { detector.detect(missing, width, height); }, /未识别/);
assert.throws(function () { detector.detect(reference, width, height, function () { throw new Error('cancelled'); }); }, /cancelled/);
console.log('PASS: empty screen, incomplete grid and cancellation');
