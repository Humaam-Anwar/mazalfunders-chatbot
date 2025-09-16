import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { SITE_INFO } from "./config/siteInfo.js";

dotenv.config();
const app = express();
app.use(express.json());
app.use(express.static("public"));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// --- Conversation State ---
let greeted = false;
let bookingState = "pending"; 
// states: pending | choosing | booked

// --- System Prompt (mature + always-on) ---
function buildSystemPrompt() {
  return `You are a professional, polite, and mature booking assistant for ${SITE_INFO.website}.
Your job: help users book a consultation (via email or phone).
Behave like a sensible human assistant, not a robot.

Rules:
1. If user asks about booking (appointment, meeting, consultation — even with spelling mistakes), 
   reply directly with: "Would you like to book via Email or Phone?" and set state to choosing.

2. Booking flow:
   - If user chooses Email → reply with clickable link:
     "You can book a consultation on this email: <a href='mailto:${SITE_INFO.email}' target='_blank'>${SITE_INFO.email}</a>"
     (set state to booked)
   - If user chooses Phone → reply with clickable link:
     "You can book a consultation on this phone: <a href='tel:${SITE_INFO.phone}'>${SITE_INFO.phone}</a>"
     (set state to booked)

3. Tone:
   - Professional, clear, short, natural.
   - No robotic "sorry I can't" — instead politely guide them back to booking if needed.

4. Polite handling:
   - If user says "thanks" → "You're welcome!"
   - If user says "you too" → "Thank you! Take care."
   - If user says "bye" → "Goodbye! Have a great day!"
   - If user says "alright" or "ok":
       • If booking not done yet → ask "Would you like to book via Email or Phone?"
       • If booking already done → just reply politely like "Great!" or "Glad I could help."

5. Small extras:
   - If user asks "which is better" between email/phone → reply with a short neutral suggestion:
     "Both options work. If you prefer quick confirmation, phone is faster. If you prefer details in writing, email is better."
   - If user makes spelling mistakes, understand them but don’t point it out.

6. Always-on:
   - Never end or close the session.
   - If conversation seems over and user comes back later ("hi", "hello"), politely restart with:
     "Welcome back! How may I help you with booking?"`;
}

// --- Rule-based overrides ---
function ruleBasedOverride(userMessage, reply) {
  const msg = userMessage.trim().toLowerCase();

  // Booking flow updates
  if (msg.includes("book")) bookingState = "choosing";
  if (msg.includes("email")) bookingState = "booked";
  if (msg.includes("phone")) bookingState = "booked";

  // Polite responses
  if (msg === "thanks" || msg === "thank you") return "You're welcome!";
  if (msg.includes("you too")) return "Thank you! Take care.";
  if (msg.includes("bye") || msg.includes("goodbye"))
    return "Goodbye! Have a great day!";

  // Handle "alright" / "ok"
  if (msg === "alright" || msg === "ok") {
    if (bookingState === "booked") {
      return "Great! Glad I could help.";
    } else {
      return "Would you like to book via Email or Phone?";
    }
  }

  // Restart after pause
  if (msg === "hi" || msg === "hello")
    return "Welcome back! How may I help you with booking?";

  return reply;
}

// --- Chat Endpoint ---
app.post("/api/chat", async (req, res) => {
  const userMessage = req.body.message || "";
  console.log("📩 User message:", userMessage);

  // Greeting logic (first time only)
  if (!greeted) {
    greeted = true;
    if (userMessage.toLowerCase().includes("book")) {
      bookingState = "choosing";
      return res.json({ reply: "Would you like to book via Email or Phone?" });
    }
    return res.json({ reply: "How may I help you?" });
  }

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

    console.log("🔗 Gemini API status:", r.status);

    if (!r.ok) {
      const errText = await r.text();
      console.error("❌ Gemini request failed:", r.status, errText);
      return res.status(500).json({
        error: "Gemini request failed",
        status: r.status,
        detail: errText,
      });
    }

    const data = await r.json();
    console.log("✅ Gemini API response:", JSON.stringify(data, null, 2));

    let reply = "";
    if (data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      reply = data.candidates[0].content.parts[0].text;
      reply = ruleBasedOverride(userMessage, reply);
    } else {
      reply = "⚠️ Sorry, I couldn’t generate a proper response.";
    }

    res.json({ reply });
  } catch (err) {
    console.error("💥 Chat API error:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});

// --- Reset endpoint (for testing) ---
app.post("/api/reset", (req, res) => {
  greeted = false;
  bookingState = "pending";
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
