import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import bodyParser from "body-parser";
import { SITE_INFO } from "./config/siteInfo.js";

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public")); // Serve widget.html and assets from public folder

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

// Health check (return widget.html instead of plain text)
app.get("/", (req, res) => {
  res.sendFile(process.cwd() + "/public/widget.html");
});

// Chat endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const userMessage = req.body.message || "";

    const response = await fetch(
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
                  text: buildSystemPrompt() + "\nUser: " + userMessage
                }
              ]
            }
          ]
        }),
      }
    );

    const data = await response.json();
    console.log("Gemini raw response:", data);

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



