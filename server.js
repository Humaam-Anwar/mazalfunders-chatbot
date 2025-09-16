import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { SITE_INFO } from "./config/siteInfo.js";

dotenv.config();
const app = express();
app.use(express.json());
app.use(express.static("public"));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// --- Greeting flag ---
let greeted = false;

// --- System Prompt (smarter & mature) ---
function buildSystemPrompt() {
  return `You are a professional, polite, and mature booking assistant for ${SITE_INFO.website}.
Your main job: help users book a consultation (via email or phone). 
Behave like a sensible human assistant, not a robot.

Rules:
1. First interaction:
   - If the user's message clearly mentions booking (appointment, meeting, consultation), 
     reply directly with: "Would you like to book via Email or Phone?" 
     (do NOT waste time on greetings).
   - Otherwise, if message is unclear, start with: "How may I help you?"

2. Booking flow:
   - If user chooses Email: reply with clickable link 
     "You can book a consultation on this email: <a href='mailto:${SITE_INFO.email}' target='_blank'>${SITE_INFO.email}</a>"
   - If user chooses Phone: reply with clickable link 
     "You can book a consultation on this phone: <a href='tel:${SITE_INFO.phone}'>${SITE_INFO.phone}</a>"

3. User language & spelling:
   - Always understand even if user misspells words (appointemnt, conslt, etc.).
   - Never complain about spelling mistakes.

4. Tone:
   - Professional, clear, short, human-like. 
   - Never robotic, never repetitive, no dragging.

5. Polite handling:
   - If user says "thanks", respond with "You're welcome!"
   - If user says "bye" or "goodbye", respond with "Goodbye! Have a great day!"
   - If user says "you too", respond with "Thank you! Take care."

6. Other queries:
   - If it's slightly related (like time slots, duration, suggestion), politely give a short sensible answer.
   - If totally unrelated (like SEO, marketing), reply: 
     "I can best assist you with booking a consultation. For other details, please contact the team directly."

7. Important:
   - Never shut down the session. Always stay available.
   - Every reply must feel mature, direct, and customer-friendly.`;
}

// --- Rule-based overrides ---
function ruleBasedOverride(userMessage, reply) {
  const msg = userMessage.trim().toLowerCase();

  // Polite small talk
  if (msg === "thanks" || msg === "thank you") {
    return "You're welcome!";
  }
  if (msg.includes("bye") || msg.includes("goodbye")) {
    return "Goodbye! Have a great day!";
  }
  if (msg.includes("you too")) {
    return "Thank you! Take care.";
  }

  return reply;
}

// --- Chat Endpoint ---
app.post("/api/chat", async (req, res) => {
  const userMessage = req.body.message || "";
  console.log("📩 User message:", userMessage);

  // If first time greeting
  if (!greeted) {
    greeted = true;
    if (userMessage.toLowerCase().includes("book")) {
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
