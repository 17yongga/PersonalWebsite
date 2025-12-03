// Configuration
const API_BASE_URL = "https://ec2-98-82-129-231.compute-1.amazonaws.com:8000"; // Change to your backend URL after deployment

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
 * Add a message to the chat window
 */
function addMessage(role, content, sources = []) {
  // create message bubble matching page styles (.chat-message .user/.bot)
  const msg = document.createElement("div");
  msg.className = `chat-message ${role === "user" ? "user" : "bot"}`;
  msg.textContent = content;

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
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

/**
 * Show loading indicator
 */
function showLoading() {
  // create a bot-style loading message so the layout is consistent
  const loadingMsg = document.createElement("div");
  loadingMsg.className = "chat-message bot";
  loadingMsg.id = "loading-indicator";
  loadingMsg.textContent = "Thinking...";
  chatWindow.appendChild(loadingMsg);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

/**
 * Remove loading indicator
 */
function removeLoading() {
  const loadingIndicator = document.getElementById("loading-indicator");
  if (loadingIndicator) loadingIndicator.remove();
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
  userInput.focus();

  // Show loading indicator
  showLoading();

  try {
    const response = await fetch(`${API_BASE_URL}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session_id: sessionId,
        message: message,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

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

userInput.addEventListener("keypress", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !isLoading) {
    event.preventDefault();
    sendMessage();
  }
});

// Focus on input on page load
userInput.focus();
