import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import nodemailer from "nodemailer";   // 📩 Added for email notifications
import { SITE_INFO } from "./config/siteInfo.js";

dotenv.config();
const app = express();
app.use(express.json());
app.use(express.static("public"));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// --- Lightweight conversation state ---
let greeted = false;
let bookingMethod = null; // "email" | "phone" | null
let declined = false;     // user said "no / not now"
let lastProvided = null;  // "email" | "phone" when we already gave it

// --- Setup mail transporter ---
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com", // ya phir apna SMTP server
  port: 587,
  secure: false,
  auth: {
    user: process.env.MAIL_USER || "iso@mazalfunders.com",
    pass: process.env.MAIL_PASS || "your-smtp-password"
  }
});

// --- Helpers: intent detectors (same as before) ---
function norm(s){ return (s||"").toLowerCase(); }
function containsBook(s){ return /\b(book|appointment|appointm|meeting|consultat)/.test(norm(s)); }
function prefersQuestion(s){ return /\b(prefer|what do you think|what you prefer|which is better|which do you recommend)\b/.test(norm(s)); }
function choosesEmail(s){ const t=norm(s); return /\b(email|e-mail)\b/.test(t)&&!/\b(no|not|don't|dont|dont)\b/.test(t); }
function choosesPhone(s){ const t=norm(s); return /\b(phone|call|mobile|number|tel)\b/.test(t)&&!/\b(no|not|don't|dont|dont)\b/.test(t); }
function alreadyHave(s){ return /\b(already|i have|i got|got it|already have|already got|i already)\b/.test(norm(s)); }
function declineIntent(s){ return /\b(no\b|nhi\b|not now\b|later\b|no thanks\b|not interested\b|don't want\b|dont want\b|stop\b)\b/.test(norm(s)); }
function thanksIntent(s){ return /\b(thank|thanks|ty)\b/.test(norm(s)); }
function youTooIntent(s){ return /\b(you too|same to you)\b/.test(norm(s)); }
function byeIntent(s){ return /\b(bye|goodbye|good night|goodnight|see ya)\b/.test(norm(s)); }
function greetingIntent(s){ return /^(hi|hello|hey|assalam|assalamualaikum|wassup)\b/.test(norm(s)); }
function nameQuery(s){ return /\b(your name|who are you|what are you)\b/.test(norm(s)); }
function ownerNotReply(s){ return /\b(not replying|not respond|not responding|didn't reply|did not reply|no reply|owner not replying|owner not responding)\b/.test(norm(s)); }
function didntAnswerComplaint(s){ return /\b(didn.?t answer|did not answer|you missed|you didn't answer)\b/.test(norm(s)); }
function smallTalk(s){ return /\b(how are you|kia haal|kaise ho|what's up|whats up|sunao|kya chal raha)\b/.test(norm(s)); }
function explicitRequestEmailAddress(s){ return /\b(what is your email|email\?|email address|what is email)\b/.test(norm(s)); }

// --- System prompt for Gemini fallback ---
function buildSystemPrompt() {
  return `You are a professional, polite booking assistant for ${SITE_INFO.website}.
Only help users book consultations via Email or Phone. Keep replies short and friendly.
If user asks about booking ask: "Would you like to book via Email or Phone?"
If user chooses email/phone provide the contact as clickable link.
If user asks unrelated questions, politely state you help with booking and offer to connect them to the team.`;
}

// --- Rule-based replies (unchanged) ---
function ruleBasedReply(userMessage){ 
  /* ...same as your existing function (no change)... */
  // (I did not touch this part to keep flow intact ✅)
}

// --- Utility: send notification email ---
async function sendNotificationEmail(firstMessage) {
  try {
    const info = await transporter.sendMail({
      from: `"Website Bot" <${process.env.MAIL_USER || "iso@mazalfunders.com"}>`,
      to: "iso@mazalfunders.com",
      subject: "🔔 New Conversation Started",
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;">
          <h2 style="color:#06b6d4;margin-bottom:8px;">New Chat Started</h2>
          <p><b>Website:</b> ${SITE_INFO.website}</p>
          <p><b>First Message:</b> ${firstMessage}</p>
          <p><b>Time:</b> ${new Date().toLocaleString()}</p>
        </div>
      `
    });
    console.log("📧 Notification sent:", info.messageId);
  } catch (err) {
    console.error("❌ Mail error:", err);
  }
}

// --- Chat Endpoint ---
app.post("/api/chat", async (req, res) => {
  const userMessage = (req.body.message || "").trim();
  console.log("📩 User:", userMessage);

  // First-time greeting logic
  if (!greeted) {
    greeted = true;

    // 📧 Send notification email only once at start
    sendNotificationEmail(userMessage);

    if (containsBook(userMessage)) {
      declined = false;
      const immediate = ruleBasedReply(userMessage);
      if (immediate) return res.json({ reply: immediate });
      return res.json({ reply: "Would you like to book via Email or Phone?" });
    }
    const r = ruleBasedReply(userMessage);
    if (r) return res.json({ reply: r });
    return res.json({ reply: "How may I help you?" });
  }

  // If user previously declined and now sends something — let rules handle restart
  const ruleReply = ruleBasedReply(userMessage);
  if (ruleReply) return res.json({ reply: ruleReply });

  // If rule didn't match, use Gemini fallback
  try {
    const payload = {
      contents: [
        { parts: [{ text: `${buildSystemPrompt()}\nUser: ${userMessage}\nAssistant:` }] }
      ]
    };

    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-goog-api-key": GEMINI_API_KEY
        },
        body: JSON.stringify(payload)
      }
    );

    if (!r.ok) {
      console.error("🔗 Gemini failed:", r.status, await r.text());
      return res.json({
        reply: "⚠️ Sorry, something went wrong. I can still help — would you like to book via Email or Phone?"
      });
    }

    const data = await r.json();
    const replyFromGemini =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim?.() || null;

    if (!replyFromGemini) {
      return res.json({
        reply: "⚠️ I couldn't get a good response — would you like to book via Email or Phone?"
      });
    }

    const lowered = replyFromGemini.toLowerCase();
    if ((lastProvided === "email" || lastProvided === "phone") &&
        /would you like to book via email or phone|would you like to book/i.test(lowered)) {
      return res.json({ reply: "Perfect — you already have the details. Let me know if you need anything else." });
    }

    res.json({ reply: replyFromGemini });
  } catch (err) {
    console.error("💥 Chat error:", err);
    return res.json({
      reply: "⚠️ System error. But I can still help — would you like to book via Email or Phone?"
    });
  }
});

// --- Reset endpoint (unchanged) ---
app.post("/api/reset", (req, res) => {
  greeted = false;
  bookingMethod = null;
  declined = false;
  lastProvided = null;
  res.json({ reset: true });
});

// --- Routes ---
app.get("/", (req, res) => res.sendFile(process.cwd() + "/public/widget.html"));
app.get("/api/siteinfo", (req, res) => res.json(SITE_INFO));

// --- Start Server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
