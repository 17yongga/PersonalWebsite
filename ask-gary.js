// Configuration
const API_BASE_URL = "https://api.gary-yong.com"; // Change to your backend URL after deployment
const REQUEST_TIMEOUT = 60000; // 60 seconds timeout
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds initial delay

// DOM elements
const chatWindow = document.getElementById("messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");

// State
let sessionId = generateSessionId();
let isLoading = false;

/**
 * Generate a unique session ID for this chat session
 */
function generateSessionId() {
  return "session_" + Date.now() + "_" + Math.random().toString(36).substring(2, 9);
}

/**
 * Add a message to the chat window with smooth animation
 */
function addMessage(role, content, sources = []) {
  // create message bubble matching page styles (.chat-message .user/.bot)
  const msg = document.createElement("div");
  msg.className = `chat-message ${role === "user" ? "user" : "bot"}`;
  msg.style.opacity = "0";
  msg.style.transform = "translateY(10px) scale(0.95)";

  if (role === "user") {
    // plain text for user messages
    msg.textContent = content;
  } else {
    // render assistant messages as Markdown
    const html = window.marked ? window.marked.parse(content) : content;
    msg.innerHTML = html;
  }

  // Add meta (sources / author) inside the bubble for consistency with markup
  if (sources && sources.length > 0) {
    const meta = document.createElement("div");
    meta.className = "chat-meta";

    const left = document.createElement("span");
    left.textContent = role === "user" ? "You" : "Ask Gary";

    const right = document.createElement("span");
    right.className = "sources";
    right.textContent = `Sources: ${sources.join(", ")}`;

    meta.appendChild(left);
    meta.appendChild(right);
    msg.appendChild(meta);
  }

  chatWindow.appendChild(msg);
  
  // Trigger animation
  requestAnimationFrame(() => {
    msg.style.transition = "opacity 0.3s ease-out, transform 0.3s ease-out";
    msg.style.opacity = "1";
    msg.style.transform = "translateY(0) scale(1)";
  });

  // Smooth scroll to bottom
  setTimeout(() => {
    chatWindow.scrollTo({
      top: chatWindow.scrollHeight,
      behavior: "smooth"
    });
  }, 50);
}

/**
 * Show loading indicator with typing animation
 */
function showLoading() {
  const loadingMsg = document.createElement("div");
  loadingMsg.className = "chat-message bot";
  loadingMsg.id = "loading-indicator";
  loadingMsg.style.opacity = "0";
  loadingMsg.innerHTML = `
    <div class="thinking-indicator">
      <span data-i18n="ask_gary.thinking">Ask Gary is thinking</span>
      <div class="typing-dots">
        <span></span><span></span><span></span>
      </div>
    </div>
  `;
  chatWindow.appendChild(loadingMsg);
  
  // Animate in
  requestAnimationFrame(() => {
    loadingMsg.style.transition = "opacity 0.3s ease-out, transform 0.3s ease-out";
    loadingMsg.style.opacity = "1";
    loadingMsg.style.transform = "translateY(0) scale(1)";
  });
  
  // Smooth scroll
  setTimeout(() => {
    chatWindow.scrollTo({
      top: chatWindow.scrollHeight,
      behavior: "smooth"
    });
  }, 50);
}

/**
 * Remove loading indicator
 */
function removeLoading() {
  const loadingIndicator = document.getElementById("loading-indicator");
  if (loadingIndicator) loadingIndicator.remove();
}

/**
 * Make a fetch request with timeout and retry logic
 */
async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    
    // If response is not ok, check if we should retry
    if (!response.ok) {
      const status = response.status;
      // Retry on 5xx server errors, but not on 4xx client errors
      if (status >= 500 && retries > 0) {
        throw new Error(`HTTP error! status: ${status}`);
      }
      // Don't retry on 4xx errors - these are client errors
      throw new Error(`HTTP error! status: ${status}`);
    }
    
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    
    // Retry on network errors, timeouts, or 5xx server errors
    const isNetworkError = 
      error.name === 'AbortError' || 
      error.message.includes('fetch') ||
      error.message.includes('Failed to fetch') ||
      error.message.includes('NetworkError');
    
    const isServerError = error.message.includes('HTTP error! status: 5');
    
    if ((isNetworkError || isServerError) && retries > 0) {
      console.log(`Request failed, retrying... (${MAX_RETRIES - retries + 1}/${MAX_RETRIES})`);
      // Exponential backoff: wait longer for each retry
      const delay = RETRY_DELAY * Math.pow(2, MAX_RETRIES - retries);
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, retries - 1);
    }
    
    throw error;
  }
}

/**
 * Wake up the backend by calling the health endpoint
 */
async function wakeUpBackend() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout for health check
    
    await fetch(`${API_BASE_URL}/health`, {
      method: "GET",
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    console.log("Backend is awake");
  } catch (error) {
    console.warn("Health check failed (this is okay, backend may wake up on first request):", error);
  }
}

/**
 * Send a message to the backend
 */
async function sendMessage() {
  const message = userInput.value.trim();
  if (!message || isLoading) {
    return;
  }

  isLoading = true;
  sendButton.disabled = true;

  // Add user message to chat
  addMessage("user", message);
  userInput.value = "";
  userInput.style.height = "auto"; // Reset textarea height
  userInput.focus();

  // Show loading indicator
  showLoading();

  try {
    const response = await fetchWithRetry(`${API_BASE_URL}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session_id: sessionId,
        message: message,
      }),
    });

    const data = await response.json();

    // Remove loading indicator
    removeLoading();

    // Add assistant message (FastAPI returns { answer, sources })
    addMessage("assistant", data.answer, data.sources);

  } catch (error) {
    console.error("Error:", error);
    removeLoading();

    const errorMessage = `I encountered an error: ${error.message}. Please make sure the backend is running at ${API_BASE_URL}.`;
    addMessage("assistant", errorMessage);

  } finally {
    isLoading = false;
    sendButton.disabled = false;
    userInput.focus();
  }
}

/**
 * Event listeners
 */
sendButton.addEventListener("click", sendMessage);

// Auto-resize textarea
userInput.addEventListener("input", () => {
  userInput.style.height = "auto";
  userInput.style.height = `${Math.min(userInput.scrollHeight, 140)}px`;
});

userInput.addEventListener("keypress", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !isLoading) {
    event.preventDefault();
    sendMessage();
  }
});

// Conversation starters
document.addEventListener("DOMContentLoaded", () => {
  const conversationStarters = document.querySelectorAll(".conversation-starter");
  conversationStarters.forEach(starter => {
    starter.addEventListener("click", () => {
      const question = starter.getAttribute("data-question");
      if (question && !isLoading) {
        userInput.value = question;
        userInput.style.height = "auto";
        userInput.style.height = `${Math.min(userInput.scrollHeight, 140)}px`;
        userInput.focus();
        // Small delay so user sees the text appear before sending
        setTimeout(() => sendMessage(), 150);
      }
    });
  });
});

// Wake up backend on page load to prevent first-request failures
wakeUpBackend();

// Focus on input on page load
userInput.focus();

// Add typing indicator styles
const style = document.createElement("style");
style.textContent = `
  .thinking-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 0;
    color: var(--text-muted);
    font-style: italic;
    font-size: 0.9rem;
  }
  
  .typing-dots {
    display: flex;
    align-items: center;
    gap: 3px;
  }
  
  .typing-dots span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    display: inline-block;
    animation: thinking 1.4s infinite ease-in-out;
  }
  
  .typing-dots span:nth-child(1) {
    animation-delay: -0.32s;
  }
  
  .typing-dots span:nth-child(2) {
    animation-delay: -0.16s;
  }
  
  .typing-dots span:nth-child(3) {
    animation-delay: 0s;
  }
  
  @keyframes thinking {
    0%, 80%, 100% {
      transform: scale(0.7);
      opacity: 0.4;
    }
    40% {
      transform: scale(1);
      opacity: 1;
    }
  }
  
  #loading-indicator {
    transform: translateY(10px) scale(0.95);
  }
`;
document.head.appendChild(style);
