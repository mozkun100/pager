// =============================================================
//  نسيت رمز لوحة الكاشير؟
//  1) وقّف السيرفر   2) اكتب: npm run reset-pin   3) شغّل السيرفر
//  أول ما تفتح لوحة الكاشير بتطلب منك تختار رمز جديد.
//  (الطلبات والإعدادات ما تنمسح — الرمز بس)
// =============================================================
const db = require('../db');
db.resetPin();
console.log('\n  Cashier PIN has been reset.');
console.log('  Start the server and open the cashier page to choose a new PIN.\n');
