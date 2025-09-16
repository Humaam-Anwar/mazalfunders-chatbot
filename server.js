import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { SITE_INFO } from "./config/siteInfo.js";

dotenv.config();
const app = express();
app.use(express.json());
app.use(express.static("public"));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// --- Keep track of first greeting ---
let greeted = false;

// --- System Prompt (Booking Focused) ---
function buildSystemPrompt() {
  return `You are a booking assistant for ${SITE_INFO.website}. 
Your ONLY task is to help users book a consultation. Follow these exact rules:

1. Greeting:
   - On the very first user message ONLY, reply exactly: "How may I help you?"
   - Never repeat this greeting again.

2. If user provides an email:
   - Reply exactly: "You can book a consultation on this email: <a href='mailto:${SITE_INFO.email}' target='_blank'>${SITE_INFO.email}</a>"

3. If user provides a phone number:
   - Reply exactly: "You can book a consultation on this phone: <a href='tel:${SITE_INFO.phone}'>${SITE_INFO.phone}</a>"

4. If user asks about consultation (but does NOT provide email/phone):
   - Reply: "Would you like to book via Email or Phone?"

5. Do NOT mention Calendly. Ever.

6. Do NOT answer about pricing, services, SEO, or unrelated topics.
   If user asks something unrelated, say: "Sorry, I can only help you with booking a consultation."

7. Responses must be short, clear, professional.
   Links MUST always be clickable (HTML <a> tags).

Strictly follow these rules.`;
}

// --- Chat Endpoint ---
app.post("/api/chat", async (req, res) => {
  const userMessage = req.body.message || "";
  console.log("📩 User message:", userMessage);

  // Handle greeting manually (so it's not repeated by Gemini)
  if (!greeted) {
    greeted = true;
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

      // --- Post-processing overrides ---
      const msg = userMessage.trim().toLowerCase();

      if (msg === "ok") {
        reply = "Great! Is there anything else I can help you with?";
      }
      if (msg === "thanks" || msg === "thank you") {
        reply = "You're welcome! Is there anything else I can help you with?";
      }
      if (msg === "no thanks" || msg === "no, thanks" || msg === "no") {
        reply = "Alright, have a great day!";
      }

      // Prevent repeating greeting again
      if (reply.includes("How may I help you?") && greeted) {
        reply = "Is there anything else related to booking you’d like help with?";
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

// --- Reset endpoint for testing (optional) ---
app.post("/api/reset", (req, res) => {
  greeted = false;
  res.json({ reset: true });
});

// --- Routes ---
app.get("/", (req, res) => {
  res.sendFile(process.cwd() + "/public/widget.html");
});

app.get("/api/siteinfo", (req, res) => res.json(SITE_INFO));

// --- Server Start ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Server running at http://localhost:${PORT}`)
);
