/**
 * Ask Gary AI - Modern Chatbot Widget
 * Embeddable chat widget for any page on gary-yong.com
 * 
 * Usage: Add <script src="ask-gary-widget.js"></script> to any page
 */

(function() {
  'use strict';

  // Configuration
  const CONFIG = {
    API_BASE_URL: 'https://api.gary-yong.com',
    WIDGET_ID: 'ask-gary-widget',
    STORAGE_KEY: 'askGarySession',
    MAX_MESSAGE_LENGTH: 500,
    TYPING_DELAY: 50
  };

  // State
  let state = {
    isOpen: false,
    isLoading: false,
    sessionId: null,
    messages: []
  };

  // Generate session ID
  function generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  }

  // Get or create session
  function getSession() {
    if (!state.sessionId) {
      const saved = localStorage.getItem(CONFIG.STORAGE_KEY);
      if (saved) {
        try {
          const data = JSON.parse(saved);
          state.sessionId = data.sessionId;
          state.messages = data.messages || [];
        } catch (e) {
          state.sessionId = generateSessionId();
          state.messages = [];
        }
      } else {
        state.sessionId = generateSessionId();
        state.messages = [];
      }
    }
    return state.sessionId;
  }

  // Save session
  function saveSession() {
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify({
      sessionId: state.sessionId,
      messages: state.messages.slice(-20) // Keep last 20 messages
    }));
  }

  // Create widget HTML
  function createWidget() {
    const widget = document.createElement('div');
    widget.id = CONFIG.WIDGET_ID;
    widget.innerHTML = `
      <style>
        #${CONFIG.WIDGET_ID} {
          --ag-primary: #3b82f6;
          --ag-primary-dark: #2563eb;
          --ag-bg: #0f172a;
          --ag-bg-card: #1e293b;
          --ag-bg-hover: #334155;
          --ag-text: #f1f5f9;
          --ag-text-muted: #94a3b8;
          --ag-border: #334155;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          position: fixed;
          bottom: 24px;
          right: 24px;
          z-index: 99999;
        }

        .ag-launcher {
          width: 60px;
          height: 60px;
          border-radius: 50%;
          background: linear-gradient(135deg, var(--ag-primary), var(--ag-primary-dark));
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 20px rgba(59, 130, 246, 0.4);
          transition: all 0.3s ease;
        }

        .ag-launcher:hover {
          transform: scale(1.1);
          box-shadow: 0 6px 30px rgba(59, 130, 246, 0.5);
        }

        .ag-launcher-icon {
          font-size: 28px;
          transition: transform 0.3s ease;
        }

        .ag-launcher.open .ag-launcher-icon {
          transform: rotate(180deg);
        }

        .ag-chat-window {
          position: absolute;
          bottom: 76px;
          right: 0;
          width: 380px;
          height: 520px;
          background: var(--ag-bg);
          border-radius: 16px;
          border: 1px solid var(--ag-border);
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
          display: none;
          flex-direction: column;
          overflow: hidden;
          animation: slideUp 0.3s ease;
        }

        .ag-chat-window.open {
          display: flex;
        }

        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(20px) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        .ag-header {
          padding: 16px 20px;
          background: var(--ag-bg-card);
          border-bottom: 1px solid var(--ag-border);
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .ag-avatar {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: linear-gradient(135deg, var(--ag-primary), #8b5cf6);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
        }

        .ag-header-info h3 {
          margin: 0;
          font-size: 1rem;
          color: var(--ag-text);
          font-weight: 600;
        }

        .ag-header-info p {
          margin: 2px 0 0;
          font-size: 0.75rem;
          color: var(--ag-text-muted);
        }

        .ag-status {
          width: 8px;
          height: 8px;
          background: #10b981;
          border-radius: 50%;
          display: inline-block;
          margin-right: 4px;
        }

        .ag-messages {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .ag-message {
          max-width: 85%;
          padding: 12px 16px;
          border-radius: 16px;
          font-size: 0.9rem;
          line-height: 1.5;
          animation: fadeIn 0.3s ease;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .ag-message.user {
          align-self: flex-end;
          background: var(--ag-primary);
          color: white;
          border-bottom-right-radius: 4px;
        }

        .ag-message.bot {
          align-self: flex-start;
          background: var(--ag-bg-card);
          color: var(--ag-text);
          border-bottom-left-radius: 4px;
        }

        .ag-message.bot p {
          margin: 0 0 8px;
        }

        .ag-message.bot p:last-child {
          margin-bottom: 0;
        }

        .ag-typing {
          display: flex;
          gap: 4px;
          padding: 8px 0;
        }

        .ag-typing span {
          width: 8px;
          height: 8px;
          background: var(--ag-text-muted);
          border-radius: 50%;
          animation: bounce 1.4s infinite ease-in-out;
        }

        .ag-typing span:nth-child(1) { animation-delay: -0.32s; }
        .ag-typing span:nth-child(2) { animation-delay: -0.16s; }

        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0.8); opacity: 0.5; }
          40% { transform: scale(1); opacity: 1; }
        }

        .ag-input-area {
          padding: 12px 16px;
          background: var(--ag-bg-card);
          border-top: 1px solid var(--ag-border);
          display: flex;
          gap: 10px;
        }

        .ag-input {
          flex: 1;
          padding: 10px 14px;
          border-radius: 24px;
          border: 1px solid var(--ag-border);
          background: var(--ag-bg);
          color: var(--ag-text);
          font-size: 0.9rem;
          outline: none;
          transition: border-color 0.2s;
        }

        .ag-input:focus {
          border-color: var(--ag-primary);
        }

        .ag-input::placeholder {
          color: var(--ag-text-muted);
        }

        .ag-send-btn {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          border: none;
          background: var(--ag-primary);
          color: white;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }

        .ag-send-btn:hover:not(:disabled) {
          background: var(--ag-primary-dark);
          transform: scale(1.05);
        }

        .ag-send-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .ag-suggestions {
          padding: 8px 16px;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .ag-suggestion {
          padding: 6px 12px;
          background: var(--ag-bg-card);
          border: 1px solid var(--ag-border);
          border-radius: 16px;
          font-size: 0.75rem;
          color: var(--ag-text-muted);
          cursor: pointer;
          transition: all 0.2s;
        }

        .ag-suggestion:hover {
          border-color: var(--ag-primary);
          color: var(--ag-primary);
        }

        @media (max-width: 480px) {
          #${CONFIG.WIDGET_ID} {
            bottom: 16px;
            right: 16px;
          }

          .ag-launcher {
            width: 50px;
            height: 50px;
          }

          .ag-launcher-icon {
            font-size: 22px;
          }

          .ag-chat-window {
            position: fixed;
            top: 10px;
            left: 10px;
            right: 10px;
            bottom: 80px;
            width: auto;
            height: auto;
            border-radius: 12px;
          }

          .ag-header {
            padding: 12px 14px;
            gap: 10px;
          }

          .ag-avatar {
            width: 32px;
            height: 32px;
            font-size: 16px;
          }

          .ag-header-info h3 {
            font-size: 0.9rem;
          }

          .ag-header-info p {
            font-size: 0.7rem;
          }

          .ag-messages {
            padding: 12px;
            gap: 8px;
          }

          .ag-message {
            max-width: 90%;
            padding: 10px 12px;
            font-size: 0.85rem;
            border-radius: 12px;
          }

          .ag-suggestions {
            padding: 6px 12px;
            gap: 6px;
          }

          .ag-suggestion {
            padding: 5px 10px;
            font-size: 0.7rem;
          }

          .ag-input-area {
            padding: 10px 12px;
            gap: 8px;
          }

          .ag-input {
            padding: 10px 12px;
            font-size: 0.85rem;
          }

          .ag-send-btn {
            width: 36px;
            height: 36px;
            font-size: 14px;
          }
        }

        @media (max-width: 380px) {
          .ag-message {
            font-size: 0.8rem;
            padding: 8px 10px;
          }

          .ag-suggestion {
            font-size: 0.65rem;
            padding: 4px 8px;
          }
        }
      </style>

      <button class="ag-launcher" onclick="AskGary.toggle()">
        <span class="ag-launcher-icon">💬</span>
      </button>

      <div class="ag-chat-window">
        <div class="ag-header">
          <div class="ag-avatar">🤖</div>
          <div class="ag-header-info">
            <h3>Ask Gary</h3>
            <p><span class="ag-status"></span>Gary's AI Career Assistant</p>
          </div>
        </div>
        
        <div class="ag-messages" id="ag-messages">
          <div class="ag-message bot">
            <p>👋 Hi! I'm Ask Gary, Gary's AI career assistant.</p>
            <p>Ask me about Gary's experience, skills, or projects!</p>
          </div>
        </div>

        <div class="ag-suggestions" id="ag-suggestions">
          <span class="ag-suggestion" onclick="AskGary.sendSuggestion('What did Gary do at Capco?')">Capco experience</span>
          <span class="ag-suggestion" onclick="AskGary.sendSuggestion('Tell me about Gary\\'s AI skills')">AI skills</span>
          <span class="ag-suggestion" onclick="AskGary.sendSuggestion('What projects has Gary built?')">Projects</span>
        </div>

        <div class="ag-input-area">
          <input 
            type="text" 
            class="ag-input" 
            id="ag-input" 
            placeholder="Ask about Gary's experience..." 
            maxlength="${CONFIG.MAX_MESSAGE_LENGTH}"
            onkeypress="if(event.key==='Enter')AskGary.send()"
          >
          <button class="ag-send-btn" onclick="AskGary.send()" id="ag-send-btn">
            ➤
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(widget);
    
    // Load saved messages
    getSession();
    if (state.messages.length > 0) {
      const messagesEl = document.getElementById('ag-messages');
      messagesEl.innerHTML = '';
      state.messages.forEach(msg => {
        addMessageToUI(msg.role, msg.content, false);
      });
    }
  }

  // Toggle chat window
  function toggle() {
    state.isOpen = !state.isOpen;
    const launcher = document.querySelector('.ag-launcher');
    const window = document.querySelector('.ag-chat-window');
    
    launcher.classList.toggle('open', state.isOpen);
    window.classList.toggle('open', state.isOpen);
    
    if (state.isOpen) {
      document.getElementById('ag-input').focus();
    }
  }

  // Add message to UI
  function addMessageToUI(role, content, animate = true) {
    const messagesEl = document.getElementById('ag-messages');
    const msg = document.createElement('div');
    msg.className = `ag-message ${role}`;
    
    if (role === 'bot') {
      // Parse simple markdown
      const html = content
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .split('\n\n').map(p => `<p>${p}</p>`).join('');
      msg.innerHTML = html;
    } else {
      msg.textContent = content;
    }
    
    if (!animate) {
      msg.style.animation = 'none';
    }
    
    messagesEl.appendChild(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // Show typing indicator
  function showTyping() {
    const messagesEl = document.getElementById('ag-messages');
    const typing = document.createElement('div');
    typing.className = 'ag-message bot';
    typing.id = 'ag-typing';
    typing.innerHTML = '<div class="ag-typing"><span></span><span></span><span></span></div>';
    messagesEl.appendChild(typing);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // Remove typing indicator
  function removeTyping() {
    const typing = document.getElementById('ag-typing');
    if (typing) typing.remove();
  }

  // Send message
  async function send() {
    const input = document.getElementById('ag-input');
    const sendBtn = document.getElementById('ag-send-btn');
    const message = input.value.trim();
    
    if (!message || state.isLoading) return;
    
    state.isLoading = true;
    sendBtn.disabled = true;
    input.value = '';
    
    // Hide suggestions after first message
    const suggestions = document.getElementById('ag-suggestions');
    if (suggestions) suggestions.style.display = 'none';
    
    // Add user message
    addMessageToUI('user', message);
    state.messages.push({ role: 'user', content: message });
    
    showTyping();
    
    try {
      const response = await fetch(`${CONFIG.API_BASE_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: getSession(),
          message: message
        })
      });
      
      const data = await response.json();
      removeTyping();
      
      // Add bot response (shorter, more conversational)
      const answer = data.answer || "I couldn't find an answer to that. Try asking about Gary's work experience, skills, or projects!";
      addMessageToUI('bot', answer);
      state.messages.push({ role: 'bot', content: answer });
      
    } catch (error) {
      console.error('Ask Gary Error:', error);
      removeTyping();
      addMessageToUI('bot', "Oops! I'm having trouble connecting. Please try again in a moment.");
    }
    
    saveSession();
    state.isLoading = false;
    sendBtn.disabled = false;
    input.focus();
  }

  // Send suggestion
  function sendSuggestion(text) {
    document.getElementById('ag-input').value = text;
    send();
  }

  // Initialize
  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', createWidget);
    } else {
      createWidget();
    }
  }

  // Public API
  window.AskGary = {
    toggle,
    send,
    sendSuggestion,
    open: () => { if (!state.isOpen) toggle(); },
    close: () => { if (state.isOpen) toggle(); }
  };

  init();
})();
