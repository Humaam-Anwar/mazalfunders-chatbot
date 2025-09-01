(function () {
  const chatContainer = document.createElement("div");
  chatContainer.innerHTML = `
    <style>
      #chat-root {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 350px;
        height: 500px;
        border: 1px solid #ccc;
        border-radius: 12px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        background: white;
        z-index: 99999;
        display: flex;
        flex-direction: column;
      }
      #chat-root header {
        background: #0073e6;
        color: white;
        padding: 10px;
        font-weight: bold;
        border-top-left-radius: 12px;
        border-top-right-radius: 12px;
      }
      #chat-root .messages {
        flex: 1;
        padding: 10px;
        overflow-y: auto;
      }
      #chat-root input {
        border: none;
        padding: 10px;
        width: 100%;
        box-sizing: border-box;
        border-top: 1px solid #ddd;
      }
    </style>
    <div id="chat-root">
      <header>💬 Consultation Chatbot</header>
      <div class="messages"></div>
      <input id="chat-input" type="text" placeholder="Type a message..." />
    </div>
  `;
  document.body.appendChild(chatContainer);

  const messages = chatContainer.querySelector(".messages");
  const input = chatContainer.querySelector("#chat-input");

  function addMessage(text, sender) {
    const msg = document.createElement("div");
    msg.textContent = text;
    msg.style.margin = "5px 0";
    msg.style.textAlign = sender === "bot" ? "left" : "right";
    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;
  }

  async function sendMessage() {
    const userText = input.value.trim();
    if (!userText) return;
    addMessage(userText, "user");
    input.value = "";

    try {
      const res = await fetch("https://mazalfunders-chatbot-production.up.railway.app/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText }),
      });
      const data = await res.json();
      addMessage(data.reply, "bot");
    } catch (err) {
      addMessage("⚠️ Connection error", "bot");
    }
  }

  input.addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendMessage();
  });

  // Auto greeting
  addMessage("Hi, how may I help you?", "bot");
})();
