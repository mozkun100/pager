// =============================================================
//  الإشعارات (Web Push)
//  يرسل إشعار لجوال العميل لما يجهز طلبه — حتى لو الجوال مقفل والمتصفح مسكّر.
//
//  "مفاتيح VAPID": زوج مفاتيح يثبت إن الإشعار جاي من سيرفرنا.
//  تنولّد مرة وحدة وتنحفظ في data/vapid.json (لو انحذفت، الجوالات تشترك من جديد تلقائياً).
// =============================================================

const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const db = require('./db');

const KEY_FILE = path.join(__dirname, 'data', 'vapid.json');

function loadKeys() {
  try {
    return JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
  } catch {
    const keys = webpush.generateVAPIDKeys();
    fs.writeFileSync(KEY_FILE, JSON.stringify(keys, null, 2));
    return keys;
  }
}

const keys = loadKeys();
// "عنوان تواصل" يطلبه نظام الإشعارات. غيّره بإيميل حقيقي لما تنقل لاستضافة حقيقية:
//   PUSH_SUBJECT=mailto:you@example.com
webpush.setVapidDetails(process.env.PUSH_SUBJECT || 'mailto:noreply@example.com', keys.publicKey, keys.privateKey);

const publicKey = keys.publicKey;

// نص الإشعار باللغتين
const TEXT = {
  ar: { title: (n) => `🔔 طلبك رقم ${n} جاهز!`, body: 'تفضّل استلمه من الكاشير' },
  en: { title: (n) => `🔔 Order #${n} is ready!`, body: 'Please pick it up at the counter' },
};

// نرسل "طلبك جاهز" لكل الجوالات المشتركة في هذا الطلب
async function notifyReady(order, log = () => {}) {
  const subs = db.getPushSubs(order.id);
  await Promise.all(subs.map(async ({ endpoint, sub, lang }) => {
    const tx = TEXT[lang] || TEXT.ar;
    const payload = JSON.stringify({
      title: tx.title(order.number),
      body: tx.body,
      tag: 'order-' + order.id,
      url: '/',
    });
    try {
      await webpush.sendNotification(sub, payload, { TTL: 600, urgency: 'high' });
      log(`push sent for order #${order.number}`);
    } catch (err) {
      // 404/410 = الاشتراك ما عاد صالح (العميل لغى الإذن أو مسح المتصفح)
      if (err.statusCode === 404 || err.statusCode === 410) db.deletePushSub(endpoint);
      log(`push failed for order #${order.number} (${err.statusCode || err.message})`);
    }
  }));
}

module.exports = { publicKey, notifyReady };
