// Yeh wohi code hai jo aapke widget.html ke andar <script> tag mein tha
// Bas isko alag file bana diya gaya hai

(function() {
    // API base URL set karo
    const API_BASE_URL = 'https://mazalfunders-chatbot-production.up.railway.app';
    
    const toggle = document.getElementById('toggle');
    const panel = document.getElementById('chat-panel');
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('send');
    const unreadEl = document.getElementById('unread');
    const quick = document.getElementById('quick');
    const minimizeBtn = document.getElementById('minimize');
    const closeBtn = document.getElementById('close');

    let openState = false, unread = 0;

    function timeNow() {
        const d = new Date(); 
        return d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    }
    
    function addMessage({who = 'bot', text = '', time = ''}) {
        const row = document.createElement('div'); 
        row.className = 'msg-row';
        
        const bubble = document.createElement('div'); 
        bubble.className = 'msg ' + (who === 'user' ? 'user' : 'bot'); 
        bubble.innerHTML = text;
        row.appendChild(bubble);
        
        if(time) {
            const meta = document.createElement('div'); 
            meta.className = 'meta'; 
            meta.textContent = time; 
            row.appendChild(meta);
        }
        
        messagesEl.appendChild(row); 
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function setTyping(on = true) {
        const existing = document.getElementById('typing');
        if(on && !existing) {
            const r = document.createElement('div'); 
            r.className = 'msg-row'; 
            r.id = 'typing';
            
            const t = document.createElement('div'); 
            t.className = 'typing'; 
            t.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
            
            r.appendChild(t); 
            messagesEl.appendChild(r); 
            messagesEl.scrollTop = messagesEl.scrollHeight;
        } else if(!on && existing) { 
            existing.remove(); 
        }
    }

    function openPanel() {
        panel.style.display = 'flex'; 
        setTimeout(() => panel.classList.add('open'), 10); 
        openState = true; 
        unread = 0; 
        unreadEl.style.display = 'none'; 
        inputEl.focus();
    }
    
    function closePanel() {
        panel.classList.remove('open'); 
        setTimeout(() => panel.style.display = 'none', 200); 
        openState = false;
    }
    
    function togglePanel() {
        openState ? closePanel() : openPanel();
    }
    
    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]);
    }

    async function sendMessage(text) {
        if(!text) return;
        
        addMessage({who: 'user', text: escapeHtml(text), time: timeNow()});
        inputEl.value = '';
        setTyping(true);
        sendBtn.disabled = true;
        
        try {
            // Yahan full URL use karo
            const res = await fetch(API_BASE_URL + '/api/chat', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({message: text})
            });
            
            const json = await res.json();
            setTyping(false);
            sendBtn.disabled = false;
            
            if(res.ok && json?.reply) {
                addMessage({who: 'bot', text: escapeHtml(json.reply), time: timeNow()});
            } else {
                const err = json?.detail || json?.error || 'No response';
                addMessage({who: 'bot', text: '⚠️ Error: ' + escapeHtml(err), time: timeNow()});
                if(!openState) {
                    unread++;
                    unreadEl.textContent = unread;
                    unreadEl.style.display = 'flex';
                }
            }
        } catch(e) {
            setTyping(false);
            sendBtn.disabled = false;
            addMessage({who: 'bot', text: '⚠️ Network error. Please check server.', time: timeNow()});
            if(!openState) {
                unread++;
                unreadEl.textContent = unread;
                unreadEl.style.display = 'flex';
            }
        }
    }

    // Event listeners
    toggle.addEventListener('click', togglePanel);
    toggle.addEventListener('keydown', e => {
        if(e.key === 'Enter' || e.key === ' ') togglePanel();
    });
    
    closeBtn.addEventListener('click', closePanel);
    minimizeBtn.addEventListener('click', closePanel);
    
    sendBtn.addEventListener('click', () => {
        const v = inputEl.value.trim();
        if(!v) return;
        sendMessage(v);
    });
    
    inputEl.addEventListener('keydown', e => {
        if(e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendBtn.click();
        }
    });
    
    quick.addEventListener('click', e => {
        const btn = e.target.closest('button[data-q]');
        if(!btn) return;
        
        const q = btn.getAttribute('data-q');
        if(!openState) openPanel();
        sendMessage(q);
    });

    // Greeting message
    addMessage({
        who: 'bot',
        text: 'How may I help you? You can book a consultation via Email, Phone, or Calendly.',
        time: timeNow()
    });

    // Escape key se close karne ke liye
    document.addEventListener('keydown', e => {
        if(e.key === 'Escape' && openState) closePanel();
    });

})();
