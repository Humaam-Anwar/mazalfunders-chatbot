import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { SITE_INFO } from "./config/siteInfo.js";

dotenv.config();
const app = express();
app.use(express.json());
app.use(express.static("public"));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// --- System Prompt (Booking Focused) ---
function buildSystemPrompt() {
  return `You are a helpful booking assistant for ${SITE_INFO.website}.
Your only job is to help users book a consultation.

Rules:
- If user gives their email → respond with: "You can book a consultation on this email: <a href='mailto:${SITE_INFO.email}'>${SITE_INFO.email}</a>"
- If user gives their phone → respond with: "You can book a consultation on this phone: <a href='tel:${SITE_INFO.phone}'>${SITE_INFO.phone}</a>"
- Always return clickable links as shown above.
- Do not use Calendly. Only email or phone.
- Do not answer about pricing, services, SEO, or unrelated topics.
- Keep responses short, clear, and professional.`;
}


// --- Chat Endpoint ---
app.post("/api/chat", async (req, res) => {
  const userMessage = req.body.message || "";
  console.log("📩 User message:", userMessage);

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
    } else {
      reply = "⚠️ Sorry, I couldn’t generate a proper response.";
    }

    res.json({ reply });
  } catch (err) {
    console.error("💥 Chat API error:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
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



