(function () {
  // Container create karo
  const container = document.createElement("div");
  container.id = "chatbot-container";
  document.body.appendChild(container);

  // Widget.html fetch karke inject karo
  fetch("https://tumhara-bot.railway.app/") // ✅ root par hai file
    .then((res) => res.text())
    .then((html) => {
      container.innerHTML = html;

      // Scripts ko properly re-run karna
      container.querySelectorAll("script").forEach((oldScript) => {
        const newScript = document.createElement("script");
        if (oldScript.src) {
          newScript.src = oldScript.src;
        } else {
          newScript.textContent = oldScript.textContent;
        }
        document.body.appendChild(newScript);
      });
    })
    .catch((err) => {
      console.error("⚠️ Widget load error:", err);
    });
})();
