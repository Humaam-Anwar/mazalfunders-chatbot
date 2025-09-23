import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import nodemailer from "nodemailer";
import { SITE_INFO } from "./config/siteInfo.js";

dotenv.config();
const app = express();
app.use(express.json());
app.use(express.static("public"));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// --- Conversation state ---
let bookingMethod = null;
let declined = false;
let lastProvided = null;

// --- Setup Nodemailer ---
const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",  // Brevo SMTP server
  port: 587,                     // Brevo port (TLS)
  secure: false,                 // port 587 -> false, port 465 -> true
   auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

// --- Send notification email ---
async function sendNotificationEmail(firstMessage, ip) {
  const htmlContent = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;">
      <h2 style="color:#06b6d4;margin-bottom:8px;">New Chat Started</h2>
      <p><b>Website:</b> ${SITE_INFO.website}</p>
      <p><b>IP Address:</b> ${ip}</p>
      <p><b>Time:</b> ${new Date().toLocaleString()}</p>
      <p><b>First Message:</b> ${firstMessage}</p>
    </div>
  `;

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "api-key": process.env.BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: { email: process.env.MAIL_USER, name: "Website Bot" },
      to: [{ email: "humaamanwarofficial@gmail.com" }],
      subject: "🔔 New Conversation Started",
      htmlContent,
    }),
  });

  const data = await res.json();
  console.log("📧 Brevo API Response:", data);
}

// --- Get client IP ---
function getClientIP(req) {
  return (
    req.headers["x-forwarded-for"] ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    req.ip
  );
}

// --- Helpers ---
function norm(s) {
  return (s || "").toLowerCase();
}
function containsBook(s) {
  return /\b(book|appointment|appointm|meeting|consultat)/.test(norm(s));
}
function prefersQuestion(s) {
  return /\b(prefer|what do you think|what you prefer|which is better|which do you recommend)\b/.test(norm(s));
}
function choosesEmail(s) {
  const t = norm(s);
  return /\b(email|e-mail)\b/.test(t) && !/\b(no|not|don't|dont|dont)\b/.test(t);
}
function choosesPhone(s) {
  const t = norm(s);
  return /\b(phone|call|mobile|number|tel)\b/.test(t) && !/\b(no|not|don't|dont|dont)\b/.test(t);
}
function alreadyHave(s) {
  return /\b(already|i have|i got|got it|already have|already got|i already)\b/.test(norm(s));
}
function declineIntent(s) {
  return /\b(no\b|nhi\b|not now\b|later\b|no thanks\b|not interested\b|don't want\b|dont want\b|stop\b)\b/.test(norm(s));
}
function thanksIntent(s) {
  return /\b(thank|thanks|ty)\b/.test(norm(s));
}
function youTooIntent(s) {
  return /\b(you too|same to you)\b/.test(norm(s));
}
function byeIntent(s) {
  return /\b(bye|goodbye|good night|goodnight|see ya)\b/.test(norm(s));
}
function greetingIntent(s) {
  return /^(hi|hello|hey|assalam|assalamualaikum|wassup)\b/.test(norm(s));
}
function nameQuery(s) {
  return /\b(your name|who are you|what are you)\b/.test(norm(s));
}
function ownerNotReply(s) {
  return /\b(not replying|not respond|not responding|didn't reply|did not reply|no reply|owner not replying|owner not responding)\b/.test(norm(s));
}
function didntAnswerComplaint(s) {
  return /\b(didn.?t answer|did not answer|you missed|you didn't answer)\b/.test(norm(s));
}
function smallTalk(s) {
  return /\b(how are you|kia haal|kaise ho|what's up|whats up|sunao|kya chal raha)\b/.test(norm(s));
}
function explicitRequestEmailAddress(s) {
  const t = norm(s);
  return /\b(what is your email|email\?|email address|what is email)\b/.test(t);
}

// --- System prompt ---
function buildSystemPrompt() {
  return `You are a professional, polite booking assistant for ${SITE_INFO.website}.
Only help users book consultations via Email or Phone. Keep replies short and friendly.
If user asks about booking ask: "Would you like to book via Email or Phone?"
If user chooses email/phone provide the contact as clickable link.
If user asks unrelated questions, politely state you help with booking and offer to connect them to the team.`;
}

// --- Rule-based reply (unchanged) ---
function ruleBasedReply(msg) {
  if (!msg) return null;
  if (greetingIntent(msg)) {
    bookingMethod = null;
    declined = false;
    lastProvided = null;
    return "Welcome back! How may I help you with booking?";
  }
  if (declineIntent(msg)) {
    declined = true;
    return "No problem — if you change your mind later I’m here to help with booking.";
  }
  if (thanksIntent(msg)) return "You're welcome!";
  if (youTooIntent(msg)) return "Thank you! Take care.";
  if (byeIntent(msg)) return "Goodbye! Have a great day!";
  if (nameQuery(msg))
    return "I'm your booking assistant — I can help you book a consultation by Email or Phone.";
  if (smallTalk(msg))
    return "I’m good, thanks for asking! If you'd like, I can help you book a consultation — Email or Phone works.";
  if (explicitRequestEmailAddress(msg)) {
    bookingMethod = "email";
    lastProvided = "email";
    return `You can book a consultation on this email: <a href="mailto:${SITE_INFO.email}" target="_blank">${SITE_INFO.email}</a>`;
  }
  if (didntAnswerComplaint(msg))
    return "Sorry if I missed that. Could you tell me again what you'd like to book or which method you prefer — Email or Phone?";
  if (ownerNotReply(msg)) {
    if (lastProvided !== "phone") {
      return "Sorry to hear that. If the email isn't responding, would you like to try booking by phone instead? I can share the number.";
    } else {
      return "Understood — maybe try contacting again later or try the other method. Would you like the email or phone again?";
    }
  }
  if (alreadyHave(msg)) {
    if (lastProvided === "email")
      return "Great — you already have the email. Let me know if you'd like the phone instead.";
    if (lastProvided === "phone")
      return "Great — you already have the phone. Let me know if you'd like the email instead.";
    return "Great! You already have the details. Let me know if you'd like the other option.";
  }
  if (prefersQuestion(msg))
    return "Both work. Phone is faster for quick confirmation; Email is better if you prefer written details. Which would you like?";
  if (choosesEmail(msg)) {
    bookingMethod = "email";
    lastProvided = "email";
    declined = false;
    return `You can book a consultation on this email: <a href="mailto:${SITE_INFO.email}" target="_blank">${SITE_INFO.email}</a>`;
  }
  if (choosesPhone(msg)) {
    bookingMethod = "phone";
    lastProvided = "phone";
    declined = false;
    return `You can book a consultation on this phone: <a href="tel:${SITE_INFO.phone}">${SITE_INFO.phone}</a>`;
  }
  const t = norm(msg);
  if (/\b(got it|i got it|done|done!|done.)\b/.test(t)) {
    if (lastProvided)
      return "Perfect — you have the details now. Reach out anytime if you need help.";
    return "Great — would you like to book via Email or Phone?";
  }
  if (/^(ok|okay|alright|sure|yes|yep|yah|ya)$/.test(t)) {
    if (lastProvided)
      return "Perfect! You’re all set. Let me know if you need anything else.";
    if (declined)
      return "No worries — I’ll be here whenever you want to book.";
    return "Alright — would you like to book via Email or Phone?";
  }
  if (/\b(no\b|nhi\b|not now|later|not interested)\b/.test(t)) {
    declined = true;
    return "Understood — no problem. If you change your mind, I’m here to help with booking.";
  }
  return null;
}

// --- Chat endpoint ---
app.post("/api/chat", async (req, res) => {
  const userMessage = (req.body.message || "").trim();
  const clientIP = getClientIP(req);
  console.log("📩 User:", userMessage, "IP:", clientIP);

  // 🔔 Always send notification on first message of chat (no timer)
  sendNotificationEmail(userMessage, clientIP);

  const ruleReply = ruleBasedReply(userMessage);
  if (ruleReply) return res.json({ reply: ruleReply });

  if (containsBook(userMessage)) {
    declined = false;
    return res.json({ reply: "Would you like to book via Email or Phone?" });
  }

  try {
    const payload = {
      contents: [{ parts: [{ text: `${buildSystemPrompt()}\nUser: ${userMessage}\nAssistant:` }] }],
    };
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-goog-api-key": GEMINI_API_KEY },
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
    res.json({ reply: replyFromGemini });
  } catch (err) {
    console.error("💥 Chat error:", err);
    return res.json({
      reply: "⚠️ System error. But I can still help — would you like to book via Email or Phone?",
    });
  }
});

// --- Reset endpoint ---
app.post("/api/reset", (req, res) => {
  bookingMethod = null;
  declined = false;
  lastProvided = null;
  res.json({ reset: true });
});

// --- Routes ---
app.get("/", (req, res) => res.sendFile(process.cwd() + "/public/widget.html"));
app.get("/api/siteinfo", (req, res) => res.json(SITE_INFO));

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

console.log("MAIL_USER:", process.env.MAIL_USER);
console.log("MAIL_PASS:", process.env.MAIL_PASS ? "****" : "Not Set");
