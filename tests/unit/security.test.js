const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
process.env.RAZORPAY_KEY_SECRET = 'unit-test-secret';
process.env.RAZORPAY_KEY_ID = 'rzp_test_x';
const { installFake } = require('../helpers/fakeSupabase');
installFake({});
const pay = require('../../backend/services/paymentService');
const { sniffImage } = require('../../backend/services/imageCheck');

const sign = (o, p) => crypto.createHmac('sha256', 'unit-test-secret').update(`${o}|${p}`).digest('hex');

test('a genuine Razorpay signature is accepted', () => assert.ok(pay.verifySignature('order_A', 'pay_B', sign('order_A', 'pay_B'))));

test('forged, reused-on-another-payment, wrong-length and empty signatures are rejected', () => {
  assert.equal(pay.verifySignature('order_A', 'pay_OTHER', sign('order_A', 'pay_B')), false);
  assert.equal(pay.verifySignature('order_OTHER', 'pay_B', sign('order_A', 'pay_B')), false);
  assert.equal(pay.verifySignature('order_A', 'pay_B', 'abc'), false);
  assert.equal(pay.verifySignature('order_A', 'pay_B', ''), false);
  assert.equal(pay.verifySignature('order_A', 'pay_B', undefined), false);
  assert.equal(pay.verifySignature('order_A', 'pay_B', 'x'.repeat(64)), false);
});

test('payments are only "configured" when both keys exist', () => {
  assert.equal(pay.configured(), true);
  const id = process.env.RAZORPAY_KEY_ID; delete process.env.RAZORPAY_KEY_ID;
  assert.equal(pay.configured(), false);
  process.env.RAZORPAY_KEY_ID = id;
});

test('uploads are identified by their contents, not their name or claimed type', () => {
  const pad = Buffer.alloc(16);
  assert.equal(sniffImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), pad]))?.ext, 'jpg');
  assert.equal(sniffImage(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pad]))?.ext, 'png');
  assert.equal(sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), pad]))?.ext, 'webp');
  assert.equal(sniffImage(Buffer.from('<script>alert(1)</script>    ')), null);
  assert.equal(sniffImage(Buffer.from('GIF89a......................')), null);
  assert.equal(sniffImage(Buffer.alloc(3)), null);
  assert.equal(sniffImage('not a buffer'), null);
});
