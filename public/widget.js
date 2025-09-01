(function () {
  // Container create karo
  const container = document.createElement("div");
  container.id = "chatbot-container";
  document.body.appendChild(container);

  // Widget.html fetch karke inject karo
  fetch("https://mazalfunders-chatbot-production.up.railway.app/") // ✅ sahi path, no double slash
    .then((res) => res.text())
    .then((html) => {
      container.innerHTML = html;

      // Scripts ko dobara execute karna
      const scripts = container.querySelectorAll("script");
      scripts.forEach((oldScript) => {
        const newScript = document.createElement("script");
        if (oldScript.src) {
          newScript.src = oldScript.src;
        } else {
          newScript.textContent = oldScript.textContent;
        }
        // Important: container me hi add karo
        container.appendChild(newScript);
      });
    })
    .catch((err) => {
      console.error("⚠️ Widget load error:", err);
    });
})();
