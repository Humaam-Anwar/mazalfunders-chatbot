import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { SITE_INFO } from "./config/siteInfo.js";

dotenv.config();
const app = express();
app.use(express.json());
app.use(express.static("public"));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// --- State ---
let greeted = false;
let sessionClosed = false;

// --- Keywords for booking intent ---
const bookingKeywords = [
  "book",
  "appointment",
  "meeting",
  "schedule",
  "consultation",
  "call"
];

// --- System Prompt ---
function buildSystemPrompt() {
  return `You are a professional booking assistant for ${SITE_INFO.website}.
Your ONLY job is to help users book a consultation.

Rules:
1. If the user clearly asks to book (appointment, meeting, call, consultation):
   - Immediately offer: "Would you like to book via Email or Phone?"
   - Do NOT waste time with greetings.

2. If user just says "hi", "hello", or is unclear:
   - Reply once with: "How may I help you?"

3. If user selects Email:
   - Reply exactly: "You can book a consultation on this email: <a href='mailto:${SITE_INFO.email}' target='_blank'>${SITE_INFO.email}</a>"

4. If user selects Phone:
   - Reply exactly: "You can book a consultation on this phone: <a href='tel:${SITE_INFO.phone}'>${SITE_INFO.phone}</a>"

5. If user asks anything unrelated (pricing, SEO, services, etc.):
   - Reply: "Sorry, I can only help you with booking a consultation."

6. For polite exits:
   - If user says "no", "bye", "thanks", or "you too", reply politely once and close session.
   - After that, NEVER send more replies.

7. Be short, clear, professional. No unnecessary repetition.
Links MUST be clickable using <a> tags.`;
}

// --- Rule-based Overrides ---
function ruleBasedOverride(userMessage, reply) {
  const msg = userMessage.trim().toLowerCase();

  if (sessionClosed) {
    return "✅ Session closed.";
  }

  // Booking intent → jump directly
  if (bookingKeywords.some((kw) => msg.includes(kw))) {
    return "Would you like to book via Email or Phone?";
  }

  // Closings
  if (msg === "no" || msg === "no thanks") {
    sessionClosed = true;
    return "Alright, have a great day!";
  }
  if (msg.includes("bye")) {
    sessionClosed = true;
    return "Goodbye! Take care.";
  }
  if (msg.includes("you too")) {
    sessionClosed = true;
    return "Thank you! Take care.";
  }
  if (msg === "thanks" || msg === "thank you") {
    return "You're welcome!";
  }

  // Greeting once
  if ((msg === "hi" || msg === "hello") && !greeted) {
    greeted = true;
    return "How may I help you?";
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

    console.log("🔗 Gemini API status:", r.status);

    if (!r.ok) {
      const errText = await r.text();
      console.error("❌ Gemini request failed:", r.status, errText);
      return res.status(500).json({
        error: "Gemini request failed",
        status: r.status,
        detail: errText
      });
    }

    const data = await r.json();
    console.log("✅ Gemini API response:", JSON.stringify(data, null, 2));

    let reply = "";
    if (data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      reply = data.candidates[0].content.parts[0].text;
      reply = ruleBasedOverride(userMessage, reply);

      // Auto-close session if polite exit
      if (
        reply.startsWith("Alright") ||
        reply.startsWith("Goodbye") ||
        reply.startsWith("Thank you")
      ) {
        sessionClosed = true;
      }
    } else {
      reply = "⚠️ Sorry, I couldn’t generate a proper response.";
    }

    res.json({ reply });
  } catch (err) {
    console.error("💥 Chat API error:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});

// --- Reset for testing ---
app.post("/api/reset", (req, res) => {
  greeted = false;
  sessionClosed = false;
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
