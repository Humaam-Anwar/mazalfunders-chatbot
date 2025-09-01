// server.js
import express from "express";
import cors from "cors";
import { SITE_INFO } from "./siteInfo.js";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

// Build system prompt for consultation-only bot
function buildSystemPrompt() {
  return `
You are a helpful assistant for ${SITE_INFO.website}.
Your only job: help clients book a consultation.

Always greet with: "Hi! How may I help you?"

If client asks about consultation → ask:
"Would you like to book via Email, Phone, or Calendly?"

- If Email → reply: ${SITE_INFO.email}
- If Phone → reply: ${SITE_INFO.phone}
- If Calendly → reply: ${SITE_INFO.calendly}

Do not answer about services, pricing, or anything else.
Stay focused on consultation booking only.
  `;
}

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=YOUR_API_KEY", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: message }] }],
        systemInstruction: { role: "system", parts: [{ text: buildSystemPrompt() }] }
      })
    });

    const data = await response.json();
    const botReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I couldn't process that.";

    res.json({ reply: botReply });

  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ reply: "Internal server error." });
  }
});

app.listen(3000, () => console.log("Server running on port 3000"));
