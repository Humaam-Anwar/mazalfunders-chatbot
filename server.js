import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { SITE_INFO } from "./config/siteInfo.js";

dotenv.config();
const app = express();
app.use(express.json());
app.use(express.static("public"));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// --- State memory (lightweight) ---
let greeted = false;
let bookingMethod = null; // "email" | "phone" | null

// --- System Prompt ---
function buildSystemPrompt() {
  return `You are a professional, polite, and mature booking assistant for ${SITE_INFO.website}.
Your job is ONLY to help users book a consultation via Email or Phone.

Rules:
1. If user asks about booking (appointment, meeting, consultation — even with spelling mistakes),
   reply with: "Would you like to book via Email or Phone?" (but not if they've already chosen).

2. Booking flow:
   - If user chooses Email → reply: "You can book a consultation on this email: <a href='mailto:${SITE_INFO.email}' target='_blank'>${SITE_INFO.email}</a>"
   - If user chooses Phone → reply: "You can book a consultation on this phone: <a href='tel:${SITE_INFO.phone}'>${SITE_INFO.phone}</a>"

3. Tone:
   - Professional, clear, short, natural.
   - No robotic "sorry I can’t" — instead politely guide back to booking.

4. Polite handling:
   - If user says "thanks" → "You're welcome!"
   - If user says "you too" → "Thank you! Take care."
   - If user says "bye" → "Goodbye! Have a great day!"
   - If user says "alright" or "ok" → only reply once: "Great! Would you like to book via Email or Phone?" (if no method selected yet).

5. Extra:
   - If user asks which is better → "Both work. Phone is faster for confirmation, Email is better for written details."
   - Understand spelling mistakes, don’t point them out.

6. Always-on:
   - Never close. If user returns with "hi/hello" → "Welcome back! How may I help you with booking?"`;
}

// --- Rule-based overrides ---
function ruleBasedOverride(userMessage) {
  const msg = userMessage.trim().toLowerCase();

  // Reset memory if user greets
  if (msg === "hi" || msg === "hello") {
    bookingMethod = null;
    return "Welcome back! How may I help you with booking?";
  }

  // Polite small talk
  if (msg === "thanks" || msg === "thank you") return "You're welcome!";
  if (msg.includes("you too")) return "Thank you! Take care.";
  if (msg.includes("bye") || msg.includes("goodbye"))
    return "Goodbye! Have a great day!";

  if ((msg === "alright" || msg === "ok") && !bookingMethod)
    return "Great! Would you like to book via Email or Phone?";

  // User chooses method
  if (msg.includes("email")) {
    bookingMethod = "email";
    return `You can book a consultation on this email: <a href='mailto:${SITE_INFO.email}' target='_blank'>${SITE_INFO.email}</a>`;
  }

  if (msg.includes("phone")) {
    bookingMethod = "phone";
    return `You can book a consultation on this phone: <a href='tel:${SITE_INFO.phone}'>${SITE_INFO.phone}</a>`;
  }

  // Which is better
  if (msg.includes("better")) {
    return "Both work. Phone is faster for confirmation, Email is better for written details.";
  }

  return null; // let Gemini handle
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

  // Apply rule-based overrides
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

    console.log("🔗 Gemini status:", r.status);

    if (!r.ok) {
      const errText = await r.text();
      console.error("❌ Gemini fail:", r.status, errText);
      return res.json({
        reply: "⚠️ Sorry, something went wrong. Can I help you with booking via Email or Phone?",
      });
    }

    const data = await r.json();
    let reply =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "⚠️ Sorry, I couldn’t generate a proper response.";
    res.json({ reply });
  } catch (err) {
    console.error("💥 Chat API error:", err);
    res.json({
      reply:
        "⚠️ System error. But I can still help — would you like to book via Email or Phone?",
    });
  }
});

// --- Reset endpoint (for testing) ---
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
