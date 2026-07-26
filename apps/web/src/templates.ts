export function renderIndexHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Adam Remote Prompt</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: Inter, system-ui, -apple-system, sans-serif;
      }
      body {
        margin: 0;
        background: #0b1020;
        color: #f3f4f6;
      }
      .container {
        max-width: 900px;
        margin: 0 auto;
        padding: 20px;
        display: grid;
        gap: 16px;
      }
      .card {
        background: #111827;
        border: 1px solid #1f2937;
        border-radius: 12px;
        padding: 16px;
      }
      h1, h2 {
        margin: 0 0 12px 0;
      }
      label {
        display: block;
        margin-bottom: 8px;
        font-size: 14px;
      }
      input, select, textarea, button {
        width: 100%;
        box-sizing: border-box;
        border-radius: 8px;
        border: 1px solid #374151;
        background: #0f172a;
        color: #f9fafb;
        padding: 10px;
        font: inherit;
      }
      textarea {
        min-height: 120px;
        resize: vertical;
      }
      button {
        cursor: pointer;
        background: #2563eb;
        border-color: #1d4ed8;
        font-weight: 600;
      }
      .row {
        display: grid;
        grid-template-columns: 1fr 180px;
        gap: 10px;
      }
      .status {
        font-size: 13px;
        border-radius: 8px;
        padding: 10px;
        margin-top: 12px;
      }
      .status.info {
        background: #0f172a;
        border: 1px solid #1f2937;
      }
      .status.error {
        background: #3f1d1d;
        border: 1px solid #7f1d1d;
      }
      #feed {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 10px;
      }
      #feed li {
        border: 1px solid #1f2937;
        border-radius: 8px;
        padding: 10px;
        background: #0f172a;
      }
      .meta {
        color: #93c5fd;
        font-size: 12px;
        margin-bottom: 4px;
      }
    </style>
  </head>
  <body>
    <main class="container">
      <section class="card">
        <h1>Adam Remote Prompt</h1>
        <label for="token">Device token</label>
        <input id="token" type="password" autocomplete="off" />
        <div class="row" style="margin-top: 10px;">
          <select id="sessionId"></select>
          <button id="refreshSessions" type="button">Refresh sessions</button>
        </div>
      </section>

      <section class="card">
        <h2>Send prompt</h2>
        <label for="promptText">Prompt</label>
        <textarea id="promptText" placeholder="Ask Codex to continue your task..."></textarea>
        <button id="sendPrompt" type="button" style="margin-top: 10px;">Send prompt</button>
        <div id="promptStatus" class="status info">Ready.</div>
      </section>

      <section class="card">
        <h2>Activity feed</h2>
        <ul id="feed"></ul>
      </section>
    </main>
    <script type="module" src="/app.js"></script>
  </body>
</html>`;
}

export function renderClientScript(): string {
  return `
const feed = document.getElementById("feed");
const tokenInput = document.getElementById("token");
const sessionSelect = document.getElementById("sessionId");
const promptInput = document.getElementById("promptText");
const promptStatus = document.getElementById("promptStatus");
const refreshSessionsButton = document.getElementById("refreshSessions");
const sendPromptButton = document.getElementById("sendPrompt");

let sinceSequence = 0;
let pollTimer = null;

function getToken() {
  return tokenInput.value.trim();
}

function setStatus(text, type = "info") {
  promptStatus.textContent = text;
  promptStatus.className = "status " + type;
}

function renderEvent(event) {
  const item = document.createElement("li");
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = "#" + event.sequence + " • " + event.type + " • " + new Date(event.createdAt).toLocaleTimeString();
  item.appendChild(meta);

  const body = document.createElement("div");
  const payload = event.payload || {};
  if (event.type === "message") {
    body.textContent = (payload.role || "system") + ": " + (payload.text || "");
  } else if (event.type === "activity") {
    body.textContent = (payload.title || "Activity") + " — " + (payload.status || "unknown");
  } else if (event.type === "prompt_delivery") {
    body.textContent = "Prompt " + (payload.promptId || "") + " -> " + (payload.state || "unknown");
  } else if (event.type === "error") {
    body.textContent = (payload.code || "error") + ": " + (payload.message || "Unknown error");
  } else {
    body.textContent = JSON.stringify(payload);
  }
  item.appendChild(body);
  feed.prepend(item);
}

async function request(path, init) {
  const options = init || {};
  const headers = new Headers(options.headers || {});
  if (path !== "/api/bootstrap") {
    const token = getToken();
    if (!token) {
      throw new Error("Device token is required.");
    }
    headers.set("x-adam-device-token", token);
  }
  const response = await fetch(path, {
    ...options,
    headers
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload.message === "string" ? payload.message : "Request failed.";
    throw new Error(message);
  }
  return payload;
}

async function loadBootstrap() {
  await request("/api/bootstrap");
}

async function loadSessions() {
  const sessionsPayload = await request("/api/sessions");
  const sessions = Array.isArray(sessionsPayload.sessions) ? sessionsPayload.sessions : [];
  sessionSelect.innerHTML = "";
  if (sessions.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No active sessions";
    sessionSelect.appendChild(option);
    return;
  }

  for (const session of sessions) {
    const option = document.createElement("option");
    option.value = session.relaySessionId;
    option.textContent = session.id + " • " + session.deviceId + " (" + session.status + ")";
    sessionSelect.appendChild(option);
  }
}

async function pollEvents() {
  if (!getToken()) {
    return;
  }
  const payload = await request("/api/events?sinceSequence=" + sinceSequence + "&limit=100");
  const events = Array.isArray(payload.events) ? payload.events : [];
  for (const event of events) {
    renderEvent(event);
  }
  if (typeof payload.lastSequence === "number") {
    sinceSequence = payload.lastSequence;
  }
}

async function submitPrompt() {
  const relaySessionId = sessionSelect.value;
  const text = promptInput.value.trim();
  if (!relaySessionId) {
    throw new Error("Select an active session first.");
  }
  if (!text) {
    throw new Error("Prompt cannot be empty.");
  }

  setStatus("Submitting prompt...", "info");
  const payload = await request("/api/prompts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ relaySessionId, text, clientPromptId: crypto.randomUUID() })
  });
  promptInput.value = "";
  setStatus("Prompt queued (" + payload.promptId + ").", "info");
}

function startPolling() {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
  }
  pollTimer = setInterval(() => {
    pollEvents().catch((error) => setStatus(String(error.message || error), "error"));
  }, 3000);
}

refreshSessionsButton.addEventListener("click", async () => {
  try {
    await loadSessions();
    setStatus("Sessions refreshed.", "info");
  } catch (error) {
    setStatus(String(error.message || error), "error");
  }
});

sendPromptButton.addEventListener("click", async () => {
  try {
    await submitPrompt();
    await pollEvents();
  } catch (error) {
    setStatus(String(error.message || error), "error");
  }
});

loadBootstrap()
  .then(() => loadSessions())
  .then(() => pollEvents())
  .then(() => startPolling())
  .catch((error) => setStatus(String(error.message || error), "error"));
`;
}
