// server.js (complete) - save/replace your existing server.js with this file

import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { SITE_INFO } from "./config/siteInfo.js";
import fs from "fs";
import path from "path";
import crypto from "crypto";

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static("public"));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const MAIL_USER = process.env.MAIL_USER;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "humaamanwarofficial@gmail.com";

// --- Notification persistence (simple file store) ---
const DATA_DIR = path.resolve(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "notifications.json");

// Ensure data dir exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// in-memory store mirrors file
let notifyStore = {}; // { key: { lastNotified: timestamp(ms) } }

// load existing store if present
function loadStore() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, "utf8");
      notifyStore = JSON.parse(raw) || {};
      console.log("🔁 Notification store loaded:", Object.keys(notifyStore).length, "keys");
    } else {
      notifyStore = {};
    }
  } catch (err) {
    console.error("⚠️ Failed loading notification store:", err);
    notifyStore = {};
  }
}

// write store to disk
function saveStore() {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(notifyStore, null, 2), "utf8");
  } catch (err) {
    console.error("⚠️ Failed saving notification store:", err);
  }
}

loadStore();

// --- Helper: compute stable client key from IP + User-Agent ---
function uaHash(ua) {
  try {
    return crypto.createHash("sha256").update(String(ua || "")).digest("hex").slice(0, 20);
  } catch (e) {
    return String(ua || "").slice(0, 20);
  }
}
function clientKeyForRequest(req) {
  const ip = (req.headers["x-forwarded-for"] || req.connection?.remoteAddress || req.socket?.remoteAddress || req.ip || "unknown").split(",")[0].trim();
  const ua = req.headers["user-agent"] || "unknown";
  return `${ip}::${uaHash(ua)}`;
}

// --- Notification policy ---
// Send only once per 24 hours per client key (IP+UA). This covers:
// - same device/browser (same UA) even if IP changes (hash helps)
// - different device => different UA => treated as new client
const NOTIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function shouldNotifyKey(key) {
  const rec = notifyStore[key];
  if (!rec) return true;
  const last = rec.lastNotified || 0;
  return Date.now() - last > NOTIFY_TTL_MS;
}
function markNotified(key) {
  notifyStore[key] = { lastNotified: Date.now() };
  saveStore();
}

// --- Brevo HTTP send (safe; avoids SMTP block) ---
async function sendNotificationEmail(firstMessage, ip) {
  if (!BREVO_API_KEY) {
    console.error("❌ BREVO_API_KEY not set!");
    return { ok: false, error: "BREVO_API_KEY not set" };
  }
  if (!MAIL_USER) {
    console.error("❌ MAIL_USER not set!");
    return { ok: false, error: "MAIL_USER not set" };
  }

  const htmlContent = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;">
      <h2 style="color:#06b6d4;margin-bottom:8px;">New Chat Started</h2>
      <p><b>Website:</b> ${escapeHtml(String(SITE_INFO.website || ""))}</p>
      <p><b>IP:</b> ${escapeHtml(String(ip || "unknown"))}</p>
      <p><b>Time:</b> ${escapeHtml(new Date().toLocaleString())}</p>
      <p><b>First Message:</b> ${escapeHtml(String(firstMessage || ""))}</p>
    </div>
  `;

  const payload = {
    sender: { email: MAIL_USER, name: "Website Bot" },
    to: [{ email: ADMIN_EMAIL }],
    subject: "🔔 New Conversation Started",
    htmlContent,
  };

  try {
    const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "api-key": BREVO_API_KEY,
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      console.error("❌ Brevo API error:", resp.status, data || "(no body)");
      return { ok: false, status: resp.status, body: data };
    }
    console.log("📧 Brevo API success:", data);
    return { ok: true, body: data };
  } catch (err) {
    console.error("❌ Brevo API request failed:", err);
    return { ok: false, error: String(err) };
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// --- Lightweight conversation state moved to per-client session maps ---
const sessionState = {}; // { key: { greeted: bool, bookingMethod, declined, lastProvided } }

// helper to get or create session object
function getSessionForKey(key) {
  if (!sessionState[key]) {
    sessionState[key] = {
      greeted: false,
      bookingMethod: null,
      declined: false,
      lastProvided: null,
    };
  }
  return sessionState[key];
}

// --- Intent helpers (kept from your code) ---
function norm(s) { return (s || "").toLowerCase(); }
function containsBook(s) { return /\b(book|appointment|appointm|meeting|consultat)/.test(norm(s)); }
function prefersQuestion(s) { return /\b(prefer|what do you think|what you prefer|which is better|which do you recommend)\b/.test(norm(s)); }
function choosesEmail(s) { const t = norm(s); return /\b(email|e-mail)\b/.test(t) && !/\b(no|not|don't|dont|dont)\b/.test(t); }
function choosesPhone(s) { const t = norm(s); return /\b(phone|call|mobile|number|tel)\b/.test(t) && !/\b(no|not|don't|dont|dont)\b/.test(t); }
function alreadyHave(s) { return /\b(already|i have|i got|got it|already have|already got|i already)\b/.test(norm(s)); }
function declineIntent(s) { return /\b(no\b|nhi\b|not now\b|later\b|no thanks\b|not interested\b|don't want\b|dont want\b|stop\b)\b/.test(norm(s)); }
function thanksIntent(s) { return /\b(thank|thanks|ty)\b/.test(norm(s)); }
function youTooIntent(s) { return /\b(you too|same to you)\b/.test(norm(s)); }
function byeIntent(s) { return /\b(bye|goodbye|good night|goodnight|see ya)\b/.test(norm(s)); }
function greetingIntent(s) { return /^(hi|hello|hey|assalam|assalamualaikum|wassup)\b/.test(norm(s)); }
function nameQuery(s) { return /\b(your name|who are you|what are you)\b/.test(norm(s)); }
function ownerNotReply(s) { return /\b(not replying|not respond|not responding|didn't reply|did not reply|no reply|owner not replying|owner not responding)\b/.test(norm(s)); }
function didntAnswerComplaint(s) { return /\b(didn.?t answer|did not answer|you missed|you didn't answer)\b/.test(norm(s)); }
function smallTalk(s) { return /\b(how are you|kia haal|kaise ho|what's up|whats up|sunao|kya chal raha)\b/.test(norm(s)); }
function explicitRequestEmailAddress(s) { const t = norm(s); return /\b(what is your email|email\?|email address|what is email)\b/.test(t); }

// --- System prompt for Gemini fallback ---
function buildSystemPrompt() {
  return `You are a professional, polite booking assistant for ${SITE_INFO.website}.
Only help users book consultations via Email or Phone. Keep replies short and friendly.
If user asks about booking ask: "Would you like to book via Email or Phone?"
If user chooses email/phone provide the contact as clickable link.
If user asks unrelated questions, politely state you help with booking and offer to connect them to the team.`;
}

// --- Rule-based responses (first-line, avoids loops) ---
function ruleBasedReply(userMessage, session) {
  const msg = userMessage || "";
  if (greetingIntent(msg)) {
    // reset user's booking "intent" session only when they explicitly greet to start fresh
    session.bookingMethod = null;
    session.declined = false;
    session.lastProvided = null;
    session.greeted = true;
    return "Welcome back! How may I help you with booking?";
  }

  if (declineIntent(msg)) {
    session.declined = true;
    return "No problem — if you change your mind later I’m here to help with booking.";
  }

  if (thanksIntent(msg)) return "You're welcome!";
  if (youTooIntent(msg)) return "Thank you! Take care.";
  if (byeIntent(msg)) return "Goodbye! Have a great day!";
  if (nameQuery(msg)) return "I'm your booking assistant — I can help you book a consultation by Email or Phone.";
  if (smallTalk(msg)) return "I’m good, thanks for asking! If you'd like, I can help you book a consultation — Email or Phone works.";
  if (explicitRequestEmailAddress(msg)) {
    session.bookingMethod = "email";
    session.lastProvided = "email";
    return `You can book a consultation on this email: <a href="mailto:${SITE_INFO.email}" target="_blank">${SITE_INFO.email}</a>`;
  }
  if (didntAnswerComplaint(msg)) {
    return "Sorry if I missed that. Could you tell me again what you'd like to book or which method you prefer — Email or Phone?";
  }
  if (ownerNotReply(msg)) {
    if (session.lastProvided !== "phone") {
      return "Sorry to hear that. If the email isn't responding, would you like to try booking by phone instead? I can share the number.";
    } else {
      return "Understood — maybe try contacting again later or try the other method. Would you like the email or phone again?";
    }
  }
  if (alreadyHave(msg)) {
    if (session.lastProvided === "email") return "Great — you already have the email. Let me know if you'd like the phone instead.";
    if (session.lastProvided === "phone") return "Great — you already have the phone. Let me know if you'd like the email instead.";
    return "Great! You already have the details. Let me know if you'd like the other option.";
  }
  if (prefersQuestion(msg)) {
    return "Both work. Phone is faster for quick confirmation; Email is better if you prefer written details. Which would you like?";
  }
  if (choosesEmail(msg)) {
    session.bookingMethod = "email";
    session.lastProvided = "email";
    session.declined = false;
    return `You can book a consultation on this email: <a href="mailto:${SITE_INFO.email}" target="_blank">${SITE_INFO.email}</a>`;
  }
  if (choosesPhone(msg)) {
    session.bookingMethod = "phone";
    session.lastProvided = "phone";
    session.declined = false;
    return `You can book a consultation on this phone: <a href="tel:${SITE_INFO.phone}">${SITE_INFO.phone}</a>`;
  }

  const t = norm(msg);
  if (/\b(got it|i got it|done|done!|done.)\b/.test(t)) {
    if (session.lastProvided) return "Perfect — you have the details now. Reach out anytime if you need help.";
    return "Great — would you like to book via Email or Phone?";
  }
  if (/^(ok|okay|alright|sure|yes|yep|yah|ya)$/.test(t)) {
    if (session.lastProvided) return "Perfect! You’re all set. Let me know if you need anything else.";
    if (session.declined) return "No worries — I’ll be here whenever you want to book.";
    return "Alright — would you like to book via Email or Phone?";
  }
  if (/\b(no\b|nhi\b|not now|later|not interested)\b/.test(t)) {
    session.declined = true;
    return "Understood — no problem. If you change your mind, I’m here to help with booking.";
  }

  return null;
}

// --- Chat Endpoint ---
// Behavior:
// - Determine client key from req
// - If first message from this client since >24h -> send a notification (Brevo API) and mark notified
// - Use per-client sessionState for greeting/booking rules
app.post("/api/chat", async (req, res) => {
  const userMessage = (req.body.message || "").trim();
  const clientIP = (req.headers["x-forwarded-for"] || req.connection?.remoteAddress || req.socket?.remoteAddress || req.ip || "unknown").split(",")[0].trim();
  const clientKey = clientKeyForRequest(req);

  console.log("📩 User:", userMessage, "Key:", clientKey, "IP:", clientIP);

  // Ensure session for this client
  const session = getSessionForKey(clientKey);

  // If this looks like a new conversation (first after TTL), notify
  try {
    if (shouldNotifyKey(clientKey)) {
      const result = await sendNotificationEmail(userMessage, clientIP);
      if (result?.ok) {
        markNotified(clientKey);
      } else {
        // Log detail — do not block user flow; still proceed
        console.error("⚠️ Notification failed (but user flow continues):", result);
      }
    } else {
      // not sending notification (within TTL)
      // console.log("ℹ️ Notification suppressed for key (within TTL).");
    }
  } catch (err) {
    console.error("💥 Notification error (ignored for chat flow):", err);
  }

  // Rule-based first
  const ruleReply = ruleBasedReply(userMessage, session);
  if (ruleReply) return res.json({ reply: ruleReply });

  // If rule didn't match, use Gemini fallback
  try {
    const payload = {
      contents: [
        {
          parts: [
            {
              text: `${buildSystemPrompt()}\nUser: ${userMessage}\nAssistant:`,
            },
          ],
        },
      ],
    };

    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-goog-api-key": GEMINI_API_KEY,
        },
        body: JSON.stringify(payload),
      }
    );

    if (!r.ok) {
      console.error("🔗 Gemini failed:", r.status, await r.text());
      return res.json({
        reply: "⚠️ Sorry, something went wrong. I can still help — would you like to book via Email or Phone?",
      });
    }

    const data = await r.json();
    const replyFromGemini = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim?.() || null;
    if (!replyFromGemini) {
      return res.json({
        reply: "⚠️ I couldn't get a good response — would you like to book via Email or Phone?",
      });
    }

    // Avoid Gemini re-asking booking if we already provided details
    const lowered = replyFromGemini.toLowerCase();
    if ((session.lastProvided === "email" || session.lastProvided === "phone") &&
      /would you like to book via email or phone|would you like to book/i.test(lowered)) {
      return res.json({ reply: "Perfect — you already have the details. Let me know if you need anything else." });
    }

    res.json({ reply: replyFromGemini });
  } catch (err) {
    console.error("💥 Chat error:", err);
    return res.json({
      reply: "⚠️ System error. But I can still help — would you like to book via Email or Phone?",
    });
  }
});

// --- Reset endpoint (per test) ---
app.post("/api/reset", (req, res) => {
  // clear store and session state (use carefully)
  for (const k of Object.keys(notifyStore)) delete notifyStore[k];
  saveStore();
  for (const k of Object.keys(sessionState)) delete sessionState[k];
  res.json({ reset: true });
});

// --- Test mail endpoint (manual test) ---
app.get("/testmail", async (req, res) => {
  const clientKey = clientKeyForRequest(req);
  const clientIP = (req.headers["x-forwarded-for"] || req.connection?.remoteAddress || req.socket?.remoteAddress || req.ip || "unknown").split(",")[0].trim();
  const out = await sendNotificationEmail("Test mail from /testmail", clientIP);
  res.json(out);
});

// --- Routes ---
app.get("/", (req, res) => res.sendFile(process.cwd() + "/public/widget.html"));
app.get("/api/siteinfo", (req, res) => res.json(SITE_INFO));

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

// --- Debug env print ---
console.log("MAIL_USER:", MAIL_USER);
console.log("BREVO_API_KEY:", BREVO_API_KEY ? "****" : "Not Set");
console.log("ADMIN_EMAIL:", ADMIN_EMAIL);
