import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
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

// --- Helpers: intent detectors (simple, robust) ---
function norm(s){ return (s||"").toLowerCase(); }

function containsBook(s){
  const t = norm(s);
  return /\b(book|appointment|appointm|meeting|consultat)/.test(t);
}
function prefersQuestion(s){
  const t = norm(s);
  return /\b(prefer|what do you think|what you prefer|which is better|which do you recommend)\b/.test(t);
}
function choosesEmail(s){
  const t = norm(s);
  // email as explicit choice but ignore phrases like "not email" or "already email"
  return /\b(email|e-mail)\b/.test(t) && !/\b(no|not|don't|dont|dont)\b/.test(t);
}
function choosesPhone(s){
  const t = norm(s);
  return /\b(phone|call|mobile|number|tel)\b/.test(t) && !/\b(no|not|don't|dont|dont)\b/.test(t);
}
function alreadyHave(s){
  const t = norm(s);
  return /\b(already|i have|i got|got it|already have|already got|i already)\b/.test(t);
}
function declineIntent(s){
  const t = norm(s);
  // include english/pakistani variants
  return /\b(no\b|nhi\b|not now\b|later\b|no thanks\b|not interested\b|don't want\b|dont want\b|stop\b)\b/.test(t);
}
function thanksIntent(s){
  const t = norm(s);
  return /\b(thank|thanks|ty)\b/.test(t);
}
function youTooIntent(s){
  const t = norm(s);
  return /\b(you too|same to you)\b/.test(t);
}
function byeIntent(s){
  const t = norm(s);
  return /\b(bye|goodbye|good night|goodnight|see ya)\b/.test(t);
}
function greetingIntent(s){
  const t = norm(s);
  return /^(hi|hello|hey|assalam|assalamualaikum|wassup)\b/.test(t);
}
function nameQuery(s){
  const t = norm(s);
  return /\b(your name|who are you|what are you)\b/.test(t);
}
function ownerNotReply(s){
  const t = norm(s);
  return /\b(not replying|not respond|not responding|didn't reply|did not reply|no reply|owner not replying|owner not responding)\b/.test(t);
}
function didntAnswerComplaint(s){
  const t = norm(s);
  return /\b(didn.?t answer|did not answer|you missed|you didn't answer)\b/.test(t);
}
function smallTalk(s){
  const t = norm(s);
  return /\b(how are you|kia haal|kaise ho|what's up|whats up|sunao|kya chal raha)\b/.test(t);
}
function explicitRequestEmailAddress(s){
  // user asking "what is your email" or "email?"
  const t = norm(s);
  return /\b(what is your email|email\?|email address|what is email)\b/.test(t);
}

// --- System prompt for Gemini fallback (kept booking-focused) ---
function buildSystemPrompt() {
  return `You are a professional, polite booking assistant for ${SITE_INFO.website}.
Only help users book consultations via Email or Phone. Keep replies short and friendly.
If user asks about booking ask: "Would you like to book via Email or Phone?"
If user chooses email/phone provide the contact as clickable link.
If user asks unrelated questions, politely state you help with booking and offer to connect them to the team.`;
}

// --- Rule-based responses (first-line, avoids loops) ---
function ruleBasedReply(userMessage){
  const msg = userMessage || "";
  if (greetingIntent(msg)){
    // reset user's booking "intent" session only when they explicitly greet to start fresh
    bookingMethod = null;
    declined = false;
    lastProvided = null;
    return "Welcome back! How may I help you with booking?";
  }

  // If user explicitly declines booking
  if (declineIntent(msg)) {
    declined = true;
    return "No problem — if you change your mind later I’m here to help with booking.";
  }

  if (thanksIntent(msg)) return "You're welcome!";
  if (youTooIntent(msg)) return "Thank you! Take care.";
  if (byeIntent(msg)) return "Goodbye! Have a great day!";

  // Name / identity
  if (nameQuery(msg)) return "I'm your booking assistant — I can help you book a consultation by Email or Phone.";

  // Small talk - don't force booking, but offer help
  if (smallTalk(msg)) return "I’m good, thanks for asking! If you'd like, I can help you book a consultation — Email or Phone works.";

  // If user asks for email explicitly
  if (explicitRequestEmailAddress(msg)) {
    bookingMethod = "email";
    lastProvided = "email";
    return `You can book a consultation on this email: <a href="mailto:${SITE_INFO.email}" target="_blank">${SITE_INFO.email}</a>`;
  }

  // If user complains about not answering
  if (didntAnswerComplaint(msg)) {
    return "Sorry if I missed that. Could you tell me again what you'd like to book or which method you prefer — Email or Phone?";
  }

  // Owner not replying -> helpful suggestion, don't loop
  if (ownerNotReply(msg)) {
    // if we haven't suggested phone yet, suggest phone. If already suggested, acknowledge.
    if (lastProvided !== "phone") {
      return "Sorry to hear that. If the email isn't responding, would you like to try booking by phone instead? I can share the number.";
    } else {
      return "Understood — maybe try contacting again later or try the other method. Would you like the email or phone again?";
    }
  }

  // If user says they already have it
  if (alreadyHave(msg)) {
    // if lastProvided set, acknowledge; otherwise generic ack
    if (lastProvided === "email") return "Great — you already have the email. Let me know if you'd like the phone instead.";
    if (lastProvided === "phone") return "Great — you already have the phone. Let me know if you'd like the email instead.";
    return "Great! You already have the details. Let me know if you'd like the other option.";
  }

  // Preference question handling — answer preference without forcing booking
  if (prefersQuestion(msg)) {
    return "Both work. Phone is faster for quick confirmation; Email is better if you prefer written details. Which would you like?";
  }

  // If user explicitly chooses Email or Phone (and not a negation)
  // check variants like "for sure phone", "i'll call on phone", etc.
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

  // If user says "ok", "ok got it", "i got it", "done", "yes" — behave context-aware
  const t = norm(msg);
  if (/\b(got it|i got it|done|done\!|done\.)\b/.test(t)) {
    if (lastProvided) return "Perfect — you have the details now. Reach out anytime if you need help.";
    return "Great — would you like to book via Email or Phone?";
  }
  if (/^(ok|okay|alright|sure|yes|yep|yah|ya)$/.test(t)) {
    if (lastProvided) return "Perfect! You’re all set. Let me know if you need anything else.";
    if (declined) return "No worries — I’ll be here whenever you want to book.";
    return "Alright — would you like to book via Email or Phone?";
  }

  // If user says "no" but in a way not caught above (safety)
  if (/\b(no\b|nhi\b|not now|later|not interested)\b/.test(t)) {
    declined = true;
    return "Understood — no problem. If you change your mind, I’m here to help with booking.";
  }

  // If none of the above matched, return null to let Gemini handle a natural reply (still booking-focused)
  return null;
}

// --- Chat Endpoint ---
app.post("/api/chat", async (req, res) => {
  const userMessage = (req.body.message || "").trim();
  console.log("📩 User:", userMessage);

  // First-time greeting logic
  if (!greeted) {
    greeted = true;
    // If user already asks to book in first message, ask method directly
    if (containsBook(userMessage)) {
      // keep declined false when starting new flow
      declined = false;
      // If message already includes a clear choice, handle via ruleBasedReply below
      const immediate = ruleBasedReply(userMessage);
      if (immediate) return res.json({ reply: immediate });
      return res.json({ reply: "Would you like to book via Email or Phone?" });
    }
    // Normal greeting
    const r = ruleBasedReply(userMessage);
    if (r) return res.json({ reply: r });
    return res.json({ reply: "How may I help you?" });
  }

  // If user previously declined and now sends something — let rules handle restart
  const ruleReply = ruleBasedReply(userMessage);
  if (ruleReply) return res.json({ reply: ruleReply });

  // If rule didn't match, use Gemini fallback (booking-focused)
  try {
    const payload = {
      contents: [
        {
          parts: [
            {
              text: `${buildSystemPrompt()}\nUser: ${userMessage}\nAssistant:`
            }
          ]
        }
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
      // Stable polite fallback if external LLM fails
      console.error("🔗 Gemini failed:", r.status, await r.text());
      return res.json({
        reply:
          "⚠️ Sorry, something went wrong. I can still help — would you like to book via Email or Phone?"
      });
    }

    const data = await r.json();
    const replyFromGemini =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim?.() || null;

    if (!replyFromGemini) {
      return res.json({
        reply:
          "⚠️ I couldn't get a good response — would you like to book via Email or Phone?"
      });
    }

    // Extra safety: if Gemini tries to re-ask booking despite we already provided details, override
    const lowered = replyFromGemini.toLowerCase();
    if ((lastProvided === "email" || lastProvided === "phone") &&
        /would you like to book via email or phone|would you like to book/i.test(lowered)) {
      return res.json({ reply: "Perfect — you already have the details. Let me know if you need anything else." });
    }

    res.json({ reply: replyFromGemini });
  } catch (err) {
    console.error("💥 Chat error:", err);
    return res.json({
      reply:
        "⚠️ System error. But I can still help — would you like to book via Email or Phone?"
    });
  }
});

// --- Reset endpoint (for testing) ---
app.post("/api/reset", (req, res) => {
  greeted = false;
  bookingMethod = null;
  declined = false;
  lastProvided = null;
  res.json({ reset: true });
});

// --- Routes ---
app.get("/", (req, res) => {
  res.sendFile(process.cwd() + "/public/widget.html");
});
app.get("/api/siteinfo", (req, res) => res.json(SITE_INFO));

// --- Start Server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
