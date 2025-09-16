import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { SITE_INFO } from "./config/siteInfo.js";

dotenv.config();
const app = express();
app.use(express.json());
app.use(express.static("public"));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// --- Keep track of first greeting & exit ---
let greeted = false;
let sessionClosed = false;

// --- System Prompt ---
function buildSystemPrompt() {
  return `You are a booking assistant for ${SITE_INFO.website}.
Your ONLY task is to help users book a consultation. Follow these exact rules:

1. First greeting (only once):
   - Reply exactly: "How may I help you?"
   - Never repeat this greeting again.

2. If user asks about consultation (no email/phone yet):
   - Reply: "Would you like to book via Email or Phone?"

3. If user selects email:
   - Reply exactly: "You can book a consultation on this email: <a href='mailto:${SITE_INFO.email}' target='_blank'>${SITE_INFO.email}</a>"

4. If user selects phone:
   - Reply exactly: "You can book a consultation on this phone: <a href='tel:${SITE_INFO.phone}'>${SITE_INFO.phone}</a>"

5. If user asks anything unrelated (pricing, services, SEO, etc.):
   - Reply: "Sorry, I can only help you with booking a consultation."

6. After polite exit (user says no / bye / thanks / you too):
   - End conversation with a short polite closing.
   - Never ask again if they need more help.

7. All responses must be short, clear, professional.
   Links MUST always be clickable (HTML <a> tags).

Strictly follow these rules.`;
}

// --- Rule-based overrides ---
function ruleBasedOverride(userMessage, reply) {
  const msg = userMessage.trim().toLowerCase();

  // If session closed, stay quiet (no repeats)
  if (sessionClosed) {
    return "✅ Session closed.";
  }

  // Polite closings (end session)
  if (msg === "no" || msg === "no thanks" || msg === "no, thanks") {
    sessionClosed = true;
    return "Alright, have a great day!";
  }
  if (msg === "bye" || msg === "goodbye") {
    sessionClosed = true;
    return "Goodbye! Take care.";
  }
  if (msg.includes("you too")) {
    sessionClosed = true;
    return "Thank you! Take care.";
  }

  // Polite but keep session open
  if (msg === "ok") {
    return "Great! Would you like to book via Email or Phone?";
  }
  if (msg === "thanks" || msg === "thank you") {
    return "You're welcome!";
  }

  // Prevent repeating greeting
  if (reply.includes("How may I help you?") && greeted) {
    return "Sorry, I can only help you with booking a consultation.";
  }

  return reply;
}

// --- Chat Endpoint ---
app.post("/api/chat", async (req, res) => {
  const userMessage = req.body.message || "";
  console.log("📩 User message:", userMessage);

  // Greeting once
  if (!greeted) {
    greeted = true;
    return res.json({ reply: "How may I help you?" });
  }

  // If session closed, no more back & forth
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

      // If closing message triggered, mark session closed
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

// --- Reset endpoint (for testing) ---
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
