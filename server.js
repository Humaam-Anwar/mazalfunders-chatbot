import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import nodemailer from "nodemailer"; // 📩 Add nodemailer
import { SITE_INFO } from "./config/siteInfo.js";

dotenv.config();
const app = express();
app.use(express.json());
app.use(express.static("public"));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// --- Conversation state ---
let greeted = false;
let bookingMethod = null; // "email" | "phone" | null
let declined = false;
let lastProvided = null;

// --- Setup Nodemailer ---
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false, // true for 465
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS
  }
});

// --- Send notification email ---
async function sendNotificationEmail(firstMessage, extraInfo = {}) {
  if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
    console.error("❌ Mail credentials not set!");
    return;
  }

  try {
    const htmlContent = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;">
        <h2 style="color:#06b6d4;margin-bottom:8px;">New Chat Started</h2>
        <p><b>Website:</b> ${SITE_INFO.website}</p>
        <p><b>Time:</b> ${new Date().toLocaleString()}</p>
        <p><b>First Message:</b> ${firstMessage}</p>
        ${extraInfo.name ? `<p><b>Name:</b> ${extraInfo.name}</p>` : ""}
        ${extraInfo.email ? `<p><b>Email:</b> ${extraInfo.email}</p>` : ""}
        ${extraInfo.phone ? `<p><b>Phone:</b> ${extraInfo.phone}</p>` : ""}
        ${extraInfo.address ? `<p><b>Address:</b> ${extraInfo.address}</p>` : ""}
      </div>
    `;
    const info = await transporter.sendMail({
      from: `"Website Bot" <${process.env.MAIL_USER}>`,
      to: process.env.MAIL_USER,
      subject: "🔔 New Conversation Started",
      html: htmlContent
    });
    console.log("📧 Notification sent:", info.messageId);
  } catch (err) {
    console.error("❌ Mail error:", err);
  }
}

// --- Intent helpers ---
function norm(s) { return (s || "").toLowerCase(); }
function containsBook(s) { return /\b(book|appointment|appointm|meeting|consultat)/.test(norm(s)); }
function prefersQuestion(s) { return /\b(prefer|what do you think|what you prefer|which is better|which do you recommend)\b/.test(norm(s)); }
function choosesEmail(s) { return /\b(email|e-mail)\b/.test(norm(s)) && !/\b(no|not|don't|dont|dont)\b/.test(norm(s)); }
function choosesPhone(s) { return /\b(phone|call|mobile|number|tel)\b/.test(norm(s)) && !/\b(no|not|don't|dont|dont)\b/.test(norm(s)); }
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
function explicitRequestEmailAddress(s) { return /\b(what is your email|email\?|email address|what is email)\b/.test(norm(s)); }

// --- System prompt ---
function buildSystemPrompt() {
  return `You are a professional, polite booking assistant for ${SITE_INFO.website}.
Only help users book consultations via Email or Phone. Keep replies short and friendly.
If user asks about booking ask: "Would you like to book via Email or Phone?"
If user chooses email/phone provide the contact as clickable link.
If user asks unrelated questions, politely state you help with booking and offer to connect them to the team.`;
}

// --- Rule-based reply ---
function ruleBasedReply(msg) {
  const t = msg || "";
  if (greetingIntent(t)) { bookingMethod = null; declined = false; lastProvided = null; return "Welcome back! How may I help you with booking?"; }
  if (declineIntent(t)) { declined = true; return "No problem — if you change your mind later I’m here to help with booking."; }
  if (thanksIntent(t)) return "You're welcome!";
  if (youTooIntent(t)) return "Thank you! Take care.";
  if (byeIntent(t)) return "Goodbye! Have a great day!";
  if (nameQuery(t)) return "I'm your booking assistant — I can help you book a consultation by Email or Phone.";
  if (smallTalk(t)) return "I’m good, thanks for asking! If you'd like, I can help you book a consultation — Email or Phone works.";
  if (explicitRequestEmailAddress(t)) { bookingMethod = "email"; lastProvided = "email"; return `You can book a consultation on this email: <a href="mailto:${SITE_INFO.email}" target="_blank">${SITE_INFO.email}</a>`; }
  if (didntAnswerComplaint(t)) return "Sorry if I missed that. Could you tell me again what you'd like to book or which method you prefer — Email or Phone?";
  if (ownerNotReply(t)) { if (lastProvided !== "phone") return "Sorry to hear that. If the email isn't responding, would you like to try booking by phone instead? I can share the number."; else return "Understood — maybe try contacting again later or try the other method. Would you like the email or phone again?"; }
  if (alreadyHave(t)) { if (lastProvided === "email") return "Great — you already have the email. Let me know if you'd like the phone instead."; if (lastProvided === "phone") return "Great — you already have the phone. Let me know if you'd like the email instead."; return "Great! You already have the details. Let me know if you'd like the other option."; }
  if (prefersQuestion(t)) return "Both work. Phone is faster for quick confirmation; Email is better if you prefer written details. Which would you like?";
  if (choosesEmail(t)) { bookingMethod = "email"; lastProvided = "email"; declined = false; return `You can book a consultation on this email: <a href="mailto:${SITE_INFO.email}" target="_blank">${SITE_INFO.email}</a>`; }
  if (choosesPhone(t)) { bookingMethod = "phone"; lastProvided = "phone"; declined = false; return `You can book a consultation on this phone: <a href="tel:${SITE_INFO.phone}">${SITE_INFO.phone}</a>`; }
  if (/\b(got it|i got it|done|done!|done.)\b/.test(t)) { if (lastProvided) return "Perfect — you have the details now. Reach out anytime if you need help."; return "Great — would you like to book via Email or Phone?"; }
  if (/^(ok|okay|alright|sure|yes|yep|yah|ya)$/.test(t)) { if (lastProvided) return "Perfect! You’re all set. Let me know if you need anything else."; if (declined) return "No worries — I’ll be here whenever you want to book."; return "Alright — would you like to book via Email or Phone?"; }
  if (/\b(no\b|nhi\b|not now|later|not interested)\b/.test(t)) { declined = true; return "Understood — no problem. If you change your mind, I’m here to help with booking."; }
  return null;
}

// --- Chat Endpoint ---
app.post("/api/chat", async (req, res) => {
  const userMessage = (req.body.message || "").trim();
  console.log("📩 User:", userMessage);

  // 🔔 Send notification email on first message
  if (!greeted) {
    greeted = true;
    sendNotificationEmail(userMessage); // <-- Mail integration
  }

  // Rule-based first
  const ruleReply = ruleBasedReply(userMessage);
  if (ruleReply) return res.json({ reply: ruleReply });

  // Gemini fallback
  try {
    const payload = { contents: [{ parts: [{ text: `${buildSystemPrompt()}\nUser: ${userMessage}\nAssistant:` }] }] };
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
      { method: "POST", headers: { "Content-Type": "application/json", "X-goog-api-key": GEMINI_API_KEY }, body: JSON.stringify(payload) }
    );
    if (!r.ok) { console.error("🔗 Gemini failed:", r.status, await r.text()); return res.json({ reply: "⚠️ Sorry, something went wrong. I can still help — would you like to book via Email or Phone?" }); }
    const data = await r.json();
    const replyFromGemini = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim?.() || null;
    if (!replyFromGemini) return res.json({ reply: "⚠️ I couldn't get a good response — would you like to book via Email or Phone?" });
    res.json({ reply: replyFromGemini });
  } catch (err) {
    console.error("💥 Chat error:", err);
    return res.json({ reply: "⚠️ System error. But I can still help — would you like to book via Email or Phone?" });
  }
});

// --- Reset endpoint ---
app.post("/api/reset", (req, res) => {
  greeted = false; bookingMethod = null; declined = false; lastProvided = null;
  res.json({ reset: true });
});

// --- Routes ---
app.get("/", (req, res) => res.sendFile(process.cwd() + "/public/widget.html"));
app.get("/api/siteinfo", (req, res) => res.json(SITE_INFO));

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

// --- Debug env ---
console.log("MAIL_USER:", process.env.MAIL_USER);
console.log("MAIL_PASS:", process.env.MAIL_PASS ? "****" : "Not Set");
