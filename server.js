import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { SITE_INFO } from "./config/siteInfo.js";

dotenv.config();
const app = express();
app.use(express.json());
app.use(express.static("public"));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// --- State memory ---
let greeted = false;
let bookingMethod = null; // "email" | "phone" | null

// --- System Prompt ---
function buildSystemPrompt() {
  return `You are a professional, polite, and mature booking assistant for ${SITE_INFO.website}.
Your ONLY job is to help users book a consultation via Email or Phone.

Rules:
1. If user asks about booking (appointment, meeting, consultation — even with spelling mistakes),
   reply with: "Would you like to book via Email or Phone?" (but not if they've already chosen).

2. Booking flow:
   - If user chooses Email → reply: "You can book a consultation on this email: <a href='mailto:${SITE_INFO.email}' target='_blank'>${SITE_INFO.email}</a>"
   - If user chooses Phone → reply: "You can book a consultation on this phone: <a href='tel:${SITE_INFO.phone}'>${SITE_INFO.phone}</a>"

3. Tone:
   - Professional, short, natural.
   - Never robotic, never loop same info twice.

4. Polite handling:
   - "thanks" → "You're welcome!"
   - "you too" → "Thank you! Take care."
   - "bye" → "Goodbye! Have a great day!"
   - "alright"/"ok" → if no method chosen → "Great! Would you like to book via Email or Phone?"
                     if method already chosen → "Great!"

5. Extras:
   - If user asks "which is better" → "Both work. Phone is faster for confirmation, Email is better for written details."
   - If user says "already got/have number/email" → acknowledge politely without repeating.
   - If user says "you didn’t answer" → "Sorry if I missed that. Could you repeat your question?"
   - If user asks "your name/who are you" → "I’m your booking assistant. I can help you with Email or Phone."

6. Always-on:
   - Never close. If user comes back with "hi/hello" → "Welcome back! How may I help you with booking?"`;
}

// --- Rule-based overrides ---
function ruleBasedOverride(userMessage) {
  const msg = userMessage.trim().toLowerCase();

  // --- Greetings reset ---
  if (["hi", "hello", "hey"].includes(msg)) {
    bookingMethod = null;
    return "Welcome back! How may I help you with booking?";
  }

  // --- Polite small talk ---
  if (["thanks", "thank you"].includes(msg)) return "You're welcome!";
  if (msg.includes("you too")) return "Thank you! Take care.";
  if (msg.includes("bye") || msg.includes("goodbye"))
    return "Goodbye! Have a great day!";

  // --- Stop / decline booking ---
  if (["no", "nhi", "not now", "later", "no thanks", "stop"].some(w => msg.includes(w))) {
    bookingMethod = "declined";
    return "No problem! If you change your mind, I’m here to help you with booking anytime.";
  }

  // --- Ok / Alright ---
  if (msg === "alright" || msg === "ok") {
    if (!bookingMethod || bookingMethod === "declined") {
      return "Got it. If you’d like to book later, just let me know.";
    }
    return "Great!";
  }

  // --- User chooses booking method ---
  if (msg.includes("email") && !msg.includes("already") && !msg.includes("no")) {
    bookingMethod = "email";
    return `You can book a consultation on this email: <a href='mailto:${SITE_INFO.email}' target='_blank'>${SITE_INFO.email}</a>`;
  }

  if (msg.includes("phone") && !msg.includes("already") && !msg.includes("no")) {
    bookingMethod = "phone";
    return `You can book a consultation on this phone: <a href='tel:${SITE_INFO.phone}'>${SITE_INFO.phone}</a>`;
  }

  // --- Already got info ---
  if (msg.includes("already")) {
    return "Great! You already have that. Let me know if you need the other option too.";
  }

  // --- Compare / prefer ---
  if (msg.includes("better") || msg.includes("prefer")) {
    return "Both work. Phone is faster for confirmation, Email is better for written details.";
  }

  // --- Complaint about no response ---
  if (msg.includes("didn’t answer") || msg.includes("did not answer") || msg.includes("you missed")) {
    return "Sorry if I missed that. Could you repeat your question?";
  }

  // --- Complaint about owner not replying ---
  if (msg.includes("not replying") || msg.includes("not responding")) {
    return "Sorry to hear that. If the email isn’t responsive, would you like to try booking by phone instead?";
  }

  // --- Identity ---
  if (msg.includes("your name") || msg.includes("who are you")) {
    return "I’m your booking assistant. I can help you with Email or Phone.";
  }

  return null; // fallback to Gemini
}


// --- Chat Endpoint ---
app.post("/api/chat", async (req, res) => {
  const userMessage = req.body.message || "";
  console.log("📩 User:", userMessage);

  // Greeting logic
  if (!greeted) {
    greeted = true;
    if (userMessage.toLowerCase().includes("book")) {
      return res.json({ reply: "Would you like to book via Email or Phone?" });
    }
    return res.json({ reply: "How may I help you?" });
  }

  // Rule-based first
  const ruleReply = ruleBasedOverride(userMessage);
  if (ruleReply) return res.json({ reply: ruleReply });

  // Fallback to Gemini
  try {
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-goog-api-key": GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `${buildSystemPrompt()}\nUser: ${userMessage}\nAssistant:`,
                },
              ],
            },
          ],
        }),
      }
    );

    if (!r.ok) {
      return res.json({
        reply:
          "⚠️ Sorry, something went wrong. Can I help you with booking via Email or Phone?",
      });
    }

    const data = await r.json();
    let reply =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "⚠️ Sorry, I couldn’t generate a proper response.";
    res.json({ reply });
  } catch (err) {
    res.json({
      reply:
        "⚠️ System error. But I can still help — would you like to book via Email or Phone?",
    });
  }
});

// --- Reset endpoint ---
app.post("/api/reset", (req, res) => {
  greeted = false;
  bookingMethod = null;
  res.json({ reset: true });
});

// --- Routes ---
app.get("/", (req, res) => {
  res.sendFile(process.cwd() + "/public/widget.html");
});
app.get("/api/siteinfo", (req, res) => res.json(SITE_INFO));

// --- Start Server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Server running at http://localhost:${PORT}`)
);

