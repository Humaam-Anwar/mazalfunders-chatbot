(function () {
  const container = document.createElement("div");
  container.id = "chatbot-container";
  document.body.appendChild(container);

  fetch("https://mazalfunders-chatbot-production.up.railway.app/")
    .then((res) => res.text())
    .then((html) => {
      // Convert relative paths to absolute
      const baseUrl = "https://mazalfunders-chatbot-production.up.railway.app";
      html = html.replace(/(src|href)="\.\/(.*?)"/g, `$1="${baseUrl}/$2"`);

      container.innerHTML = html;

      // Re-run scripts
      container.querySelectorAll("script").forEach((oldScript) => {
        const newScript = document.createElement("script");
        if (oldScript.src) {
          newScript.src = oldScript.src;
        } else {
          newScript.textContent = oldScript.textContent;
        }
        container.appendChild(newScript);
      });
    })
    .catch((err) => {
      console.error("⚠️ Widget load error:", err);
    });
})();
