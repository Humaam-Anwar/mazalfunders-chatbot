import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import bodyParser from "body-parser";
import { SITE_INFO } from "./config/siteInfo.js";

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

// ----------------- SYSTEM PROMPT -----------------
function buildSystemPrompt() {
  return `You are a helpful assistant for ${SITE_INFO.website}.
Contact methods:
- Phone: ${SITE_INFO.phone}
- Email: ${SITE_INFO.email}
- Calendly: ${SITE_INFO.booking}

Your only job is to help users book a consultation.
Always start by greeting: "Hi, how may I help you?".
If user asks about booking, respond:
"Would you like to book via Email, Phone, or Calendly?"
Depending on their choice, share the correct contact method or link.
Do not talk about unrelated services or topics.`;
}

// ----------------- ROUTES -----------------

// Health check
app.get("/", (req, res) => {
  res.send("✅ Consultation Chatbot is running.");
});

// Chat endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const userMessage = req.body.message || "";

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=" +
        process.env.GOOGLE_API_KEY,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: buildSystemPrompt() + "\nUser: " + userMessage }],
            },
          ],
        }),
      }
    );

    const data = await response.json();

    let botMessage =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "⚠️ Sorry, I couldn’t process your request.";

    res.json({ reply: botMessage });
  } catch (err) {
    console.error("Chat error:", err);
    res
      .status(500)
      .json({ reply: "⚠️ Network error. Please check server logs." });
  }
});

// ----------------- START SERVER -----------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
