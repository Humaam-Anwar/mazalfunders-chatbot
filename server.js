import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { SITE_INFO } from "./config/siteInfo.js";

dotenv.config();
const app = express();
app.use(express.json());
app.use(express.static("public"));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

let sessionClosed = false;

// --- System Prompt ---
function buildSystemPrompt() {
  return `You are a professional booking assistant for ${SITE_INFO.website}.
Rules:
1. If user greets (hi, hello, hey) → respond once with: "Hello! How can I help you with booking your consultation today?"
2. If user directly asks about booking (book, meeting, appointment, consultation) → immediately offer: "You can book a consultation. Would you prefer Email or Phone?"
3. If user says "email" → reply: "You can book a consultation on this email: <a href='mailto:${SITE_INFO.email}'>${SITE_INFO.email}</a>"
4. If user says "phone" → reply: "You can book a consultation on this phone: <a href='tel:${SITE_INFO.phone}'>${SITE_INFO.phone}</a>"
5. If user asks unrelated (price, SEO, anything else) → reply: "I can only help you with booking a consultation."
6. If user says "thanks" → reply: "You're welcome!"
7. If user says "no" → reply: "Alright, have a great day!" and close the session.
8. If user says "you too" → reply: "Thank you! Take care." and close the session.
9. Keep replies short, polite, and professional.
Never repeat greetings or drag the conversation.`;
}

// --- Rule-based overrides (safety net) ---
function ruleBasedOverride(userMessage, reply) {
  const msg = userMessage.trim().toLowerCase();

  if (sessionClosed) return "✅ Session closed.";

  if (msg === "no") {
    sessionClosed = true;
    return "Alright, have a great day!";
  }
  if (msg.includes("you too")) {
    sessionClosed = true;
    return "Thank you! Take care.";
  }
  if (msg === "thanks" || msg === "thank you") {
    return "You're welcome!";
  }

  return reply;
}

// --- Chat Endpoint ---
app.post("/api/chat", async (req, res) => {
  const userMessage = req.body.message || "";
  console.log("📩 User:", userMessage);

  if (sessionClosed) {
    return res.json({ reply: "✅ Session closed." });
  }

  try {
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-goog-api-key": GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `${buildSystemPrompt()}\nUser: ${userMessage}\nAssistant:`
                }
              ]
            }
          ]
        })
      }
    );

    if (!r.ok) {
      const errText = await r.text();
      return res.status(500).json({ error: "Gemini error", detail: errText });
    }

    const data = await r.json();
    let reply =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "⚠️ Sorry, I couldn’t generate a proper response.";

    reply = ruleBasedOverride(userMessage, reply);

    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});

// Reset session
app.post("/api/reset", (req, res) => {
  sessionClosed = false;
  res.json({ reset: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Server running at http://localhost:${PORT}`)
);
