// QA stand-in for src/lib/sms/verify.ts in the action checks (_actionHarness): a verification
// text is recorded, not sent, and answered as sent. Twilio Verify's own wording is kept — the
// service is named "JobFlex", so the text reads "Your JobFlex verification code is NNNNNN".
const log = (globalThis.__qaSms ??= []);

async function sendVerifyCode(phone) {
  const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
  log.push({ kind: "verify", to: phone, channel: "sms", body: `Your JobFlex verification code is ${code}`, code, at: Date.now() });
  return { ok: true };
}

async function checkVerifyCode(phone, code) {
  const last = [...log].reverse().find((m) => m.to === phone);
  return { ok: true, approved: !!last && last.code === String(code).replace(/\D/g, "") };
}

module.exports = { sendVerifyCode, checkVerifyCode };
