/* ==========================================================================
   AetherAI Application Controller (v2.1)
   ========================================================================= */

const API_BASE = "";  // Same origin — server.py serves both static & API
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/";

// --- App State ---
let currentUser = null;
let sessionToken = null;
let chats = [];
let projects = [];
let activeChatId = null;
let activeProjectId = null;
let settings = {
    apiKey: "", model: "gemini-2.5-flash-preview-05-20", temperature: 0.7,
    systemInstruction: "You are a helpful, precise, and stylish AI assistant. Always respond with clear structure using bold, lists, tables or code blocks where appropriate."
};
let personalization = {
    tone: "Default", name: "", occupation: "", interests: "",
    customInstructions: "", memoryReference: true, historyReference: true
};
let isGenerating = false;
let searchQuery = "";
let speechRecognition = null;
let isRecording = false;
let attachedFiles = [];

// --- DOM Cache ---
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

// ============================================================
//  INITIALISATION
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
    const storedToken = localStorage.getItem("aether_session_token");
    const storedUser  = localStorage.getItem("aether_user");
    if (storedToken && storedUser) {
        sessionToken = storedToken;
        currentUser  = JSON.parse(storedUser);
        bootApp();
    } else {
        showAuthPortal();
    }
    setupAuthListeners();
    setupGoogleChooser();
});

// ============================================================
//  AUTH PORTAL
// ============================================================
let authMode = "login"; // "login" | "signup"

function showAuthPortal() {
    $("auth-portal").classList.remove("hidden");
    $("signup-name-group").style.display = "none";
    authMode = "login";
    syncAuthUI();
}

function hideAuthPortal() {
    $("auth-portal").classList.add("hidden");
}

function syncAuthUI() {
    if (authMode === "login") {
        $("signup-name-group").style.display = "none";
        $("auth-submit-btn").textContent  = "Continue";
        $("auth-toggle-msg").textContent  = "Don't have an account?";
        $("auth-toggle-btn").textContent  = "Sign up";
    } else {
        $("signup-name-group").style.display = "flex";
        $("auth-submit-btn").textContent  = "Create Account";
        $("auth-toggle-msg").textContent  = "Already have an account?";
        $("auth-toggle-btn").textContent  = "Log in";
    }
}

function showAuthError(msg) {
    const banner = $("auth-error-banner");
    banner.textContent = msg;
    banner.classList.remove("hidden");
    setTimeout(() => banner.classList.add("hidden"), 5000);
}

function setupAuthListeners() {
    $("auth-toggle-btn").addEventListener("click", () => {
        authMode = authMode === "login" ? "signup" : "login";
        syncAuthUI();
        $("auth-error-banner").classList.add("hidden");
    });

    $("auth-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const email    = $("auth-email").value.trim();
        const password = $("auth-password").value;
        const name     = $("auth-name").value.trim();

        if (!email || !password) { showAuthError("Email and password are required."); return; }
        if (authMode === "signup" && !name) { showAuthError("Please enter your full name."); return; }

        $("auth-submit-btn").disabled = true;
        $("auth-submit-btn").textContent = "Please wait…";

        try {
            const endpoint = authMode === "signup" ? "/api/auth/signup" : "/api/auth/login";
            const body     = authMode === "signup" ? { name, email, password } : { email, password };
            const res  = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
            const data = await res.json();

            if (!res.ok) { showAuthError(data.error || "Authentication failed."); return; }

            persistSession(data.token, data.user);
            bootApp();
        } catch (err) {
            showAuthError("Cannot reach the server. Make sure server.py is running.");
        } finally {
            $("auth-submit-btn").disabled = false;
            syncAuthUI();
        }
    });

    $("google-login-trigger").addEventListener("click", () => {
        $("google-chooser").classList.remove("hidden");
    });

    $("google-chooser-cancel").addEventListener("click", () => {
        $("google-chooser").classList.add("hidden");
    });
}

function setupGoogleChooser() {
    $$(".google-account-item").forEach(item => {
        item.addEventListener("click", async () => {
            const email = item.dataset.email;
            const name  = item.dataset.name;
            $("google-chooser").classList.add("hidden");

            try {
                const res  = await fetch("/api/auth/login", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email, name, isGoogleOAuth: true })
                });
                const data = await res.json();
                if (!res.ok) { showAuthError(data.error || "Google sign-in failed."); return; }
                persistSession(data.token, data.user);
                bootApp();
            } catch {
                showAuthError("Cannot reach server. Make sure server.py is running.");
            }
        });
    });
}

function persistSession(token, user) {
    sessionToken = token;
    currentUser  = user;
    localStorage.setItem("aether_session_token", token);
    localStorage.setItem("aether_user", JSON.stringify(user));
}

// ============================================================
//  BOOT SEQUENCE (after login)
// ============================================================
async function bootApp() {
    hideAuthPortal();
    updateProfileWidgetDisplay();
    await Promise.all([
        syncSettingsFromServer(),
        syncPersonalizationFromServer(),
        syncChatsFromServer(),
        syncProjectsFromServer()
    ]);
    setupEventListeners();
    setupSpeechRecognition();
    updateViewportState();
    checkApiKeyBanner();
    populateSettingsModal();
}

// ============================================================
//  SERVER API HELPERS
// ============================================================
function authHeaders() {
    return { "Content-Type": "application/json", "Authorization": `Bearer ${sessionToken}` };
}

async function apiFetch(path, opts = {}) {
    return fetch(path, { ...opts, headers: { ...authHeaders(), ...(opts.headers || {}) } });
}

async function syncSettingsFromServer() {
    try {
        const res  = await apiFetch("/api/settings");
        if (res.ok) { const d = await res.json(); settings = { apiKey: d.apiKey, model: d.model, temperature: d.temperature, systemInstruction: d.systemInstruction }; }
    } catch {}
}

async function saveSettingsToServer() {
    try {
        await apiFetch("/api/settings", { method: "POST", body: JSON.stringify({ apiKey: settings.apiKey, model: settings.model, temperature: settings.temperature, systemInstruction: settings.systemInstruction }) });
    } catch {}
}

async function syncPersonalizationFromServer() {
    try {
        const res = await apiFetch("/api/personalization");
        if (res.ok) { personalization = await res.json(); }
    } catch {}
}

async function savePersonalizationToServer() {
    try {
        await apiFetch("/api/personalization", { method: "POST", body: JSON.stringify(personalization) });
    } catch {}
}

async function syncChatsFromServer() {
    try {
        const res = await apiFetch("/api/chats");
        if (res.ok) { chats = await res.json(); }
    } catch {}
    renderChatHistoryList();
}

async function saveChatToServer(chat) {
    try {
        await apiFetch("/api/chats", { method: "POST", body: JSON.stringify({ id: chat.id, title: chat.title, messages: chat.messages, isPinned: chat.isPinned }) });
    } catch {}
}

async function deleteChatFromServer(id) {
    try { await apiFetch(`/api/chats/${id}`, { method: "DELETE" }); } catch {}
}

async function syncProjectsFromServer() {
    try {
        const res = await apiFetch("/api/projects");
        if (res.ok) { projects = await res.json(); }
    } catch {}
    renderProjectList();
}

async function saveProjectToServer(proj) {
    try {
        await apiFetch("/api/projects", { method: "POST", body: JSON.stringify(proj) });
    } catch {}
}

async function deleteProjectFromServer(id) {
    try { await apiFetch(`/api/projects/${id}`, { method: "DELETE" }); } catch {}
}

// ============================================================
//  PROFILE / USER UI
// ============================================================
function updateProfileWidgetDisplay() {
    if (!currentUser) return;
    const initials = getInitials(currentUser.name);
    $("profile-avatar-display").textContent       = initials;
    $("profile-widget-name").textContent          = currentUser.name;
    // Show truncated email under name
    const emailEl = $("profile-widget-email");
    if (emailEl) {
        const truncEmail = currentUser.email.length > 24
            ? currentUser.email.slice(0, 22) + "…"
            : currentUser.email;
        emailEl.textContent = truncEmail;
    }
    $("profile-edit-avatar-large").textContent    = initials;
    $("profile-edit-display-name").value          = currentUser.name;
    $("profile-edit-email").value                 = currentUser.email;
    $("account-detail-name").textContent          = currentUser.name;
    $("account-detail-email").textContent         = currentUser.email;
}

function getInitials(name) {
    return (name || "U").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
}

// ============================================================
//  EVENT LISTENERS SETUP
// ============================================================
function setupEventListeners() {
    // --- Sidebar toggle (mobile) ---
    $("sidebar-toggle").addEventListener("click", () => {
        $("sidebar").classList.toggle("open");
        $("sidebar-overlay").classList.toggle("open");
    });
    $("sidebar-overlay").addEventListener("click", () => {
        $("sidebar").classList.remove("open");
        $("sidebar-overlay").classList.remove("open");
    });

    // --- New Chat ---
    $("new-chat-btn").addEventListener("click", () => {
        activeChatId   = null;
        activeProjectId = null;
        updateViewportState();
        closeSidebarMobile();
        $("chat-input").focus();
    });

    // --- Search Chats ---
    $("search-chats-input").addEventListener("input", (e) => {
        searchQuery = e.target.value.trim().toLowerCase();
        renderChatHistoryList();
    });

    // --- Profile Popup Toggle ---
    $("profile-widget-trigger").addEventListener("click", (e) => {
        e.stopPropagation();
        $("profile-popup-menu").classList.toggle("hidden");
    });
    document.addEventListener("click", (e) => {
        const menu = $("profile-popup-menu");
        const trigger = $("profile-widget-trigger");
        if (menu && trigger && !menu.contains(e.target) && !trigger.contains(e.target)) {
            menu.classList.add("hidden");
        }
    });

    // --- Profile Popup Menu Items ---
    $("popup-personalization").addEventListener("click", () => { closeProfilePopup(); openSettingsModal("tab-personalization"); });
    $("popup-settings").addEventListener("click",       () => { closeProfilePopup(); openSettingsModal("tab-general"); });
    $("popup-profile").addEventListener("click",        () => { closeProfilePopup(); openProfileEditModal(); });
    $("popup-help").addEventListener("click",           () => { closeProfilePopup(); window.open("https://support.google.com", "_blank"); });
    $("popup-logout").addEventListener("click",         () => { closeProfilePopup(); handleLogout(); });

    // --- Settings Modal ---
    $("settings-modal-close").addEventListener("click", closeSettingsModal);
    $("settings-cancel").addEventListener("click",      closeSettingsModal);
    $("settings-save").addEventListener("click",        saveAllSettings);
    $("banner-settings-trigger").addEventListener("click", () => openSettingsModal("tab-general"));

    // Settings tab navigation
    $$(".settings-tab-link").forEach(btn => {
        btn.addEventListener("click", () => {
            const tabId = btn.dataset.tab;
            // Placeholder tabs: show placeholder panel
            if (btn.classList.contains("placeholder")) {
                $$(".settings-tab-panel").forEach(p => p.classList.add("hidden"));
                $("tab-placeholder").classList.remove("hidden");
                $("placeholder-panel-title").textContent = btn.querySelector("span").textContent;
            } else {
                $$(".settings-tab-panel").forEach(p => p.classList.add("hidden"));
                $(tabId).classList.remove("hidden");
            }
            $$(".settings-tab-link").forEach(l => l.classList.remove("active"));
            btn.classList.add("active");
        });
    });

    // General tab password toggle
    $("general-pwd-toggle").addEventListener("click", () => {
        const inp = $("general-api-key");
        const isPass = inp.type === "password";
        inp.type = isPass ? "text" : "password";
        $("general-pwd-toggle").querySelector(".eye-open").classList.toggle("hidden", isPass);
        $("general-pwd-toggle").querySelector(".eye-closed").classList.toggle("hidden", !isPass);
    });

    // Temperature slider sync
    $("general-temp-slider").addEventListener("input", e => {
        $("general-temp-val").textContent = parseFloat(e.target.value).toFixed(1);
    });

    // Theme select in General tab
    $("general-theme-select").addEventListener("change", e => {
        document.documentElement.setAttribute("data-theme", e.target.value);
    });

    // Account delete trigger
    $("account-delete-trigger").addEventListener("click", async () => {
        if (!confirm("⚠️ This will permanently delete your account and ALL data. Are you absolutely sure?")) return;
        try {
            await apiFetch("/api/account", { method: "DELETE" });
        } catch {}
        handleLogout();
    });

    // Data controls wipe
    $("wipe-chats-btn").addEventListener("click", async () => {
        if (!confirm("Delete all conversations? This cannot be undone.")) return;
        for (const c of chats) await deleteChatFromServer(c.id);
        chats = [];
        activeChatId = null;
        renderChatHistoryList();
        updateViewportState();
        closeSettingsModal();
    });

    // Export data (mock)
    $("export-data-btn").addEventListener("click", () => {
        const exportData = { user: currentUser, chats, projects, personalization, settings: { ...settings, apiKey: "***" } };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href = url; a.download = "aether_export.json"; a.click();
        URL.revokeObjectURL(url);
    });

    // --- Edit Profile Modal ---
    $("profile-edit-cancel").addEventListener("click", () => closeModal("profile-edit-modal"));
    $("profile-edit-save").addEventListener("click",   saveProfileEdit);

    // --- Projects ---
    $("add-project-trigger").addEventListener("click",  () => openModal("project-create-modal"));
    $("project-modal-cancel").addEventListener("click", () => closeModal("project-create-modal"));
    $("project-modal-close-btn").addEventListener("click", () => closeModal("project-create-modal"));
    $("project-modal-save").addEventListener("click",   createProject);

    // --- Chat Input ---
    $("chat-input").addEventListener("input", () => {
        $("chat-input").style.height = "auto";
        $("chat-input").style.height = $("chat-input").scrollHeight + "px";
        $("send-btn").disabled = ($("chat-input").value.trim().length === 0 && attachedFiles.length === 0) || isGenerating;
    });
    $("chat-input").addEventListener("keydown", e => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
    });
    $("send-btn").addEventListener("click", () => handleSendMessage());

    // Clear chat
    $("clear-chat-btn").addEventListener("click", () => {
        if (!activeChatId) return;
        if (!confirm("Clear all messages in this chat?")) return;
        const chat = chats.find(c => c.id === activeChatId);
        if (chat) { chat.messages = []; saveChatToServer(chat); updateViewportState(); }
    });

    // Voice btn
    $("voice-btn").addEventListener("click", () => {
        if (!speechRecognition) return;
        isRecording ? stopVoiceRecording() : startVoiceRecording();
    });

    // Suggestion cards
    $$(".suggestion-card").forEach(card => {
        card.addEventListener("click", () => {
            const prompt = card.dataset.prompt;
            if (prompt) handleSendMessage(prompt);
        });
    });

    // Close modals on overlay click
    $$(".modal-overlay").forEach(overlay => {
        overlay.addEventListener("click", e => {
            if (e.target === overlay) overlay.classList.remove("open");
        });
    });

    // File attachments
    $("attach-btn").addEventListener("click", handleAttachClick);
    $("file-input").addEventListener("change", handleFileSelection);
}

// ============================================================
//  SETTINGS MODAL
// ============================================================
function openSettingsModal(tabId = "tab-general") {
    populateSettingsModal();
    // Activate correct tab
    $$(".settings-tab-link").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.tab === tabId);
    });
    $$(".settings-tab-panel").forEach(p => p.classList.add("hidden"));
    if ($(tabId)) $(tabId).classList.remove("hidden");
    $("settings-modal").classList.add("open");
}

function closeSettingsModal() { $("settings-modal").classList.remove("open"); }

function populateSettingsModal() {
    $("general-api-key").value          = settings.apiKey;
    // Set model select - fallback to first option if stored value not in list
    const modelSelect = $("general-model-select");
    modelSelect.value = settings.model;
    if (!modelSelect.value) modelSelect.selectedIndex = 0;
    $("general-temp-slider").value      = settings.temperature;
    $("general-temp-val").textContent   = parseFloat(settings.temperature).toFixed(1);
    $("general-system-prompt").value    = settings.systemInstruction;
    $("general-theme-select").value     = document.documentElement.getAttribute("data-theme");

    $("personal-tone-dropdown").value   = personalization.tone;
    $("personal-name").value            = personalization.name;
    $("personal-occupation").value      = personalization.occupation;
    $("personal-interests").value       = personalization.interests;
    $("personal-instructions").value    = personalization.customInstructions;
    $("personal-memory-toggle").checked = personalization.memoryReference;
    $("personal-history-toggle").checked = personalization.historyReference;

    if (currentUser) {
        $("account-detail-name").textContent  = currentUser.name;
        $("account-detail-email").textContent = currentUser.email;
    }
}

async function saveAllSettings() {
    // Read general tab values
    settings.apiKey            = $("general-api-key").value.trim();
    settings.model             = $("general-model-select").value;
    settings.temperature       = parseFloat($("general-temp-slider").value);
    settings.systemInstruction = $("general-system-prompt").value.trim();

    const theme = $("general-theme-select").value;
    document.documentElement.setAttribute("data-theme", theme);

    // Read personalization values
    personalization.tone               = $("personal-tone-dropdown").value;
    personalization.name               = $("personal-name").value.trim();
    personalization.occupation         = $("personal-occupation").value.trim();
    personalization.interests          = $("personal-interests").value.trim();
    personalization.customInstructions = $("personal-instructions").value.trim();
    personalization.memoryReference    = $("personal-memory-toggle").checked;
    personalization.historyReference   = $("personal-history-toggle").checked;

    await Promise.all([saveSettingsToServer(), savePersonalizationToServer()]);

    $("current-model-badge").textContent = getModelDisplay(settings.model);
    checkApiKeyBanner();
    closeSettingsModal();
}

function checkApiKeyBanner() {
    $("api-warning-banner").classList.toggle("hidden", !!settings.apiKey);
    $("current-model-badge").textContent = getModelDisplay(settings.model);
}

function getModelDisplay(model) {
    const map = {
        "gemini-2.5-flash-preview-05-20": "Gemini 2.5 Flash Preview",
        "gemini-2.5-flash": "Gemini 2.5 Flash",
        "gemini-2.5-pro-preview-06-05": "Gemini 2.5 Pro Preview",
        "gemini-2.5-pro": "Gemini 2.5 Pro",
        "gemini-2.0-flash": "Gemini 2.0 Flash",
        "gemini-2.0-flash-lite": "Gemini 2.0 Flash Lite",
        "gemini-1.5-flash": "Gemini 1.5 Flash",
        "gemini-1.5-pro": "Gemini 1.5 Pro"
    };
    return settings.apiKey ? (map[model] || "Gemini LLM") : "Sandbox Mode";
}

// ============================================================
//  PROFILE EDIT MODAL
// ============================================================
function openProfileEditModal() {
    $("profile-edit-display-name").value = currentUser.name;
    $("profile-edit-email").value        = currentUser.email;
    $("profile-edit-avatar-large").textContent = getInitials(currentUser.name);
    openModal("profile-edit-modal");
}

async function saveProfileEdit() {
    const newName  = $("profile-edit-display-name").value.trim();
    const newEmail = $("profile-edit-email").value.trim();
    if (!newName || !newEmail) { alert("Name and email are required."); return; }

    try {
        const res  = await apiFetch("/api/profile/update", { method: "POST", body: JSON.stringify({ name: newName, email: newEmail }) });
        const data = await res.json();
        if (!res.ok) { alert(data.error || "Update failed."); return; }
        currentUser = { ...currentUser, name: newName, email: newEmail };
        localStorage.setItem("aether_user", JSON.stringify(currentUser));
        updateProfileWidgetDisplay();
        closeModal("profile-edit-modal");
    } catch {
        alert("Server error. Make sure server.py is running.");
    }
}

// ============================================================
//  LOGOUT
// ============================================================
async function handleLogout() {
    try { await apiFetch("/api/auth/logout", { method: "POST" }); } catch {}
    sessionToken = null;
    currentUser  = null;
    chats = []; projects = []; activeChatId = null; activeProjectId = null;
    localStorage.removeItem("aether_session_token");
    localStorage.removeItem("aether_user");
    $("chat-list").innerHTML        = "";
    $("pinned-chat-list").innerHTML = "";
    $("sidebar-projects-list").innerHTML = "";
    $("messages-list").innerHTML    = "";
    showAuthPortal();
}

// ============================================================
//  PROJECTS
// ============================================================
function renderProjectList() {
    const container = $("sidebar-projects-list");
    container.innerHTML = "";

    if (projects.length === 0) {
        container.innerHTML = `<div style="padding:4px 10px; font-size:0.72rem; color:var(--text-muted)">No projects yet</div>`;
        return;
    }

    projects.forEach(proj => {
        const item = document.createElement("div");
        item.className = `project-sidebar-item ${proj.id === activeProjectId ? "active" : ""}`;
        item.innerHTML = `
            <div class="proj-item-left">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                <span class="proj-title-span">${escapeHTML(proj.title)}</span>
            </div>
            <button class="proj-delete-btn" title="Delete project">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>`;

        item.querySelector(".proj-item-left").addEventListener("click", () => {
            activeProjectId = proj.id;
            activeChatId    = null;
            renderProjectList();
            updateViewportState();
            closeSidebarMobile();
        });

        item.querySelector(".proj-delete-btn").addEventListener("click", async (e) => {
            e.stopPropagation();
            if (!confirm(`Delete project "${proj.title}"?`)) return;
            await deleteProjectFromServer(proj.id);
            projects = projects.filter(p => p.id !== proj.id);
            if (activeProjectId === proj.id) activeProjectId = null;
            renderProjectList();
        });

        container.appendChild(item);
    });
}

async function createProject() {
    const title        = $("project-title-input").value.trim();
    const description  = $("project-desc-input").value.trim();
    const instructions = $("project-instructions-input").value.trim();

    if (!title) { alert("Project name is required."); return; }

    const proj = { id: "proj_" + Date.now(), title, description, instructions, files: [] };
    projects.unshift(proj);
    await saveProjectToServer(proj);
    renderProjectList();
    closeModal("project-create-modal");

    // Clear form
    $("project-title-input").value = "";
    $("project-desc-input").value  = "";
    $("project-instructions-input").value = "";
}

// ============================================================
//  CHAT HISTORY LIST
// ============================================================
function renderChatHistoryList() {
    const pinned  = chats.filter(c => c.isPinned && matchesSearch(c));
    const recents = chats.filter(c => !c.isPinned && matchesSearch(c));

    // Pinned section
    const pinnedSection = $("pinned-chats-section");
    pinnedSection.classList.toggle("hidden", pinned.length === 0);
    $("pinned-chat-list").innerHTML = "";
    pinned.forEach(c => $("pinned-chat-list").appendChild(buildChatItem(c)));

    // Recents section
    $("chat-list").innerHTML = "";
    recents.forEach(c => $("chat-list").appendChild(buildChatItem(c)));

    if (recents.length === 0 && pinned.length === 0) {
        $("chat-list").innerHTML = `<div style="padding:10px; font-size:0.75rem; color:var(--text-muted); text-align:center">No conversations yet</div>`;
    }
}

function matchesSearch(chat) {
    if (!searchQuery) return true;
    return chat.title.toLowerCase().includes(searchQuery);
}

function buildChatItem(chat) {
    const item = document.createElement("div");
    item.className = `chat-item ${chat.id === activeChatId ? "active" : ""} ${chat.isPinned ? "pinned-state" : ""}`;
    item.dataset.id = chat.id;

    item.innerHTML = `
        <div class="chat-item-left">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            <div class="chat-item-title-wrapper">
                <span class="chat-item-title">${escapeHTML(chat.title)}</span>
            </div>
        </div>
        <div class="chat-item-actions">
            <button class="chat-item-action-btn pin" title="${chat.isPinned ? "Unpin" : "Pin"}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="17" x2="12" y2="22"></line>
                    <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path>
                </svg>
            </button>
            <button class="chat-item-action-btn rename" title="Rename">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
            </button>
            <button class="chat-item-action-btn delete" title="Delete">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        </div>`;

    item.querySelector(".chat-item-left").addEventListener("click", () => selectChat(chat.id));
    item.querySelector(".pin").addEventListener("click",    (e) => { e.stopPropagation(); togglePin(chat.id); });
    item.querySelector(".rename").addEventListener("click", (e) => { e.stopPropagation(); startRename(chat.id, item); });
    item.querySelector(".delete").addEventListener("click", (e) => { e.stopPropagation(); deleteChat(chat.id); });

    return item;
}

function selectChat(id) {
    activeChatId    = id;
    activeProjectId = null;
    renderChatHistoryList();
    updateViewportState();
    closeSidebarMobile();
}

async function togglePin(id) {
    const chat = chats.find(c => c.id === id);
    if (!chat) return;
    chat.isPinned = !chat.isPinned;
    await saveChatToServer(chat);
    renderChatHistoryList();
}

function startRename(id, itemEl) {
    const span = itemEl.querySelector(".chat-item-title");
    const orig = span.textContent;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "chat-rename-input";
    input.value = orig;
    span.replaceWith(input);
    input.focus(); input.select();

    const finish = async () => {
        const newTitle = input.value.trim() || orig;
        const chat = chats.find(c => c.id === id);
        if (chat) { chat.title = newTitle; await saveChatToServer(chat); }
        if (id === activeChatId) $("chat-title-text").textContent = newTitle;
        renderChatHistoryList();
    };
    input.addEventListener("blur", finish);
    input.addEventListener("keypress", e => { if (e.key === "Enter") finish(); });
}

async function deleteChat(id) {
    if (!confirm("Delete this conversation?")) return;
    await deleteChatFromServer(id);
    chats = chats.filter(c => c.id !== id);
    if (activeChatId === id) { activeChatId = null; updateViewportState(); }
    renderChatHistoryList();
}

// ============================================================
//  VIEWPORT STATE
// ============================================================
function updateViewportState() {
    const activeChat = chats.find(c => c.id === activeChatId);
    const activeProj = projects.find(p => p.id === activeProjectId);

    if (activeProj && !activeChatId) {
        // Project selected but no chat — show welcome with project branding
        $("welcome-screen").classList.remove("hidden");
        $("messages-list").classList.add("hidden");
        $("welcome-header-title").textContent = `📁 ${activeProj.title}`;
        $("welcome-header-desc").textContent  = activeProj.description || "Start a conversation in this project workspace.";
        $("chat-title-text").textContent      = activeProj.title;
        $("active-project-badge").textContent = "Project";
        $("active-project-badge").classList.remove("hidden");
        $("messages-list").innerHTML = "";
        return;
    }

    $("active-project-badge").classList.add("hidden");

    if (activeChat) {
        $("welcome-screen").classList.add("hidden");
        $("messages-list").classList.remove("hidden");
        $("chat-title-text").textContent = activeChat.title;
        // Restore project badge if chat belongs to a project
        const proj = projects.find(p => p.id === activeProjectId);
        if (proj) {
            $("active-project-badge").textContent = proj.title;
            $("active-project-badge").classList.remove("hidden");
        }
        renderMessages(activeChat.messages);
        scrollToBottom();
    } else {
        $("welcome-screen").classList.remove("hidden");
        $("messages-list").classList.add("hidden");
        $("welcome-header-title").textContent = "How can I assist you today?";
        $("welcome-header-desc").textContent  = "AetherAI combines modern aesthetics with Gemini LLM's power.";
        $("chat-title-text").textContent      = "New Conversation";
        $("messages-list").innerHTML          = "";
    }
}

// ============================================================
//  MESSAGE RENDERING
// ============================================================
function renderMessages(messages) {
    $("messages-list").innerHTML = "";
    messages.forEach((msg, idx) => {
        appendMessageEl(msg, idx === messages.length - 1);
    });
}

function appendMessageEl(msg, isLast = false) {
    const wrapper = document.createElement("div");
    wrapper.className = `message-wrapper ${msg.sender === "user" ? "user-msg" : "ai-msg"}`;

    const avatarHtml = msg.sender === "user"
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";

    // Prepend attachments inside the bubble if present
    if (msg.files && msg.files.length > 0) {
        const attachmentContainer = document.createElement("div");
        attachmentContainer.className = "message-attachments";
        msg.files.forEach(file => {
            if (file.isImage) {
                const img = document.createElement("img");
                img.src = file.data;
                img.className = "msg-attachment-image";
                img.alt = file.name;
                attachmentContainer.appendChild(img);
            } else {
                const fileEl = document.createElement("div");
                fileEl.className = "msg-attachment-file";
                fileEl.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                        <line x1="16" y1="13" x2="8" y2="13"></line>
                        <line x1="16" y1="17" x2="8" y2="17"></line>
                    </svg>
                    <span>${escapeHTML(file.name)}</span>
                `;
                attachmentContainer.appendChild(fileEl);
            }
        });
        bubble.appendChild(attachmentContainer);
    }

    const textContent = document.createElement("div");
    textContent.className = "message-text-content";
    if (msg.sender === "user") {
        textContent.textContent = msg.text;
    } else {
        textContent.innerHTML = parseMarkdown(msg.text);
    }
    bubble.appendChild(textContent);

    const meta = document.createElement("div");
    meta.className = "message-meta";

    const copyBtn = document.createElement("button");
    copyBtn.className = "meta-action";
    copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><span>Copy</span>`;
    copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(msg.text);
        copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg><span>Copied!</span>`;
        setTimeout(() => { copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><span>Copy</span>`; }, 2000);
    });
    meta.appendChild(copyBtn);

    if (msg.sender === "ai" && isLast) {
        const regenBtn = document.createElement("button");
        regenBtn.className = "meta-action";
        regenBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg><span>Regenerate</span>`;
        regenBtn.addEventListener("click", regenerate);
        meta.appendChild(regenBtn);
    }

    wrapper.innerHTML = `<div class="avatar">${avatarHtml}</div>`;
    wrapper.appendChild(bubble);
    $("messages-list").appendChild(wrapper);
    bubble.after(meta);
}

function scrollToBottom() {
        $("chat-viewport").scrollTo({ top: $("chat-viewport").scrollHeight, behavior: "smooth" });
}

// ============================================================
//  SEND MESSAGE FLOW
// ============================================================
async function handleSendMessage(textOverride = "") {
    let raw = "";
    if (typeof textOverride === "string" && textOverride.trim().length > 0) {
        raw = textOverride.trim();
    } else {
        raw = $("chat-input").value.trim();
    }

    // Allow sending if there is text OR if there are attached files
    if ((!raw && attachedFiles.length === 0) || isGenerating) return;

    if (typeof textOverride !== "string" || textOverride.trim().length === 0) {
        $("chat-input").value = "";
        $("chat-input").style.height = "auto";
        $("send-btn").disabled = true;
    }

    let chat = chats.find(c => c.id === activeChatId);
    if (!chat) {
        chat = { id: "chat_" + Date.now(), title: makeChatTitle(raw || attachedFiles[0]?.name || "Attachment"), messages: [], isPinned: false };
        if (activeProjectId) chat.projectId = activeProjectId;
        chats.unshift(chat);
        activeChatId = chat.id;
        renderChatHistoryList();
    }

    // Capture attached files
    const msgFiles = [...attachedFiles];
    attachedFiles = [];
    renderAttachmentPreviews();

    const userMsg = { sender: "user", text: raw, ts: Date.now(), files: msgFiles };
    chat.messages.push(userMsg);
    await saveChatToServer(chat);

    $("welcome-screen").classList.add("hidden");
    $("messages-list").classList.remove("hidden");
    $("chat-title-text").textContent = chat.title;
    appendMessageEl(userMsg);
    scrollToBottom();

    await generateAIResponse(chat);
}

async function regenerate() {
    if (!activeChatId || isGenerating) return;
    const chat = chats.find(c => c.id === activeChatId);
    if (!chat || !chat.messages.length) return;
    if (chat.messages[chat.messages.length - 1].sender === "ai") {
        chat.messages.pop();
        await saveChatToServer(chat);
        updateViewportState();
    }
    await generateAIResponse(chat);
}

async function generateAIResponse(chat) {
    isGenerating = true;
    $("send-btn").disabled = true;

    const typingEl = document.createElement("div");
    typingEl.className = "message-wrapper ai-msg";
    typingEl.innerHTML = `<div class="avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div class="message-bubble"><div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div>`;
    $("messages-list").appendChild(typingEl);
    scrollToBottom();

    let responseText = "";
    if (!settings.apiKey) {
        await new Promise(r => setTimeout(r, 1400));
        // Impose the 4-message sandbox limit
        if (chat.messages.length > 4) {
            responseText = `### ⚠️ Message Limit Reached (Offline Sandbox)\n\nYou have reached the limit of **4 messages** in Sandbox Mode for this conversation.\n\nTo continue chatting and upload files/images with high-potential AI, please configure your **Gemini API Key** in Settings:\n\n1. Click your profile avatar in the bottom-left corner and select **Settings**.\n2. Navigate to the **General** tab.\n3. Paste your API Key from [Google AI Studio](https://aistudio.google.com/).\n4. Click **Save Settings** to enable direct AI completions.`;
        } else {
            responseText = buildOfflineResponse(chat.messages);
        }
    } else {
        try { responseText = await callGeminiAPI(chat); }
        catch (err) { responseText = `⚠️ **API Error:** ${err.message}`; }
    }

    typingEl.remove();

    const aiMsg = { sender: "ai", text: responseText, ts: Date.now() };
    chat.messages.push(aiMsg);
    await saveChatToServer(chat);
    animateTypewriter(aiMsg, chat);
}

function animateTypewriter(msg, chat) {
    const wrapper = document.createElement("div");
    wrapper.className = "message-wrapper ai-msg";
    
    const avatarHtml = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.innerHTML = avatarHtml;
    
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    
    wrapper.appendChild(avatar);
    wrapper.appendChild(bubble);
    $("messages-list").appendChild(wrapper);

    let idx = 0;
    const text = msg.text;
    const baseSpeed = 15;
    const charsPerTick = Math.max(2, Math.floor(text.length / 250));

    function tick() {
        if (idx < text.length) {
            idx += charsPerTick;
            if (idx > text.length) idx = text.length;
            bubble.innerHTML = parseMarkdown(text.slice(0, idx));
            scrollToBottom();
            setTimeout(tick, baseSpeed);
        } else {
            isGenerating = false;
            $("send-btn").disabled = $("chat-input").value.trim().length === 0 && attachedFiles.length === 0;
            renderMessages(chat.messages);
            scrollToBottom();
        }
    }
    tick();
}

// ============================================================
//  GEMINI API CALL
// ============================================================
async function callGeminiAPI(chat) {
    const activeProj = projects.find(p => p.id === activeProjectId || p.id === chat.projectId);
    let sysPrompt = settings.systemInstruction || "";

    const toneMap = {
        "Professional": "Respond in a polished and precise professional tone.",
        "Friendly": "Respond in a warm, conversational, and chatty tone.",
        "Candid": "Be direct, honest, and encouraging in your responses.",
        "Quirky": "Be playful, imaginative, and a little quirky in your responses.",
        "Efficient": "Be extremely concise and plain. No fluff.",
        "Cynical": "Respond with a critical, sarcastic, cynical tone."
    };
    if (personalization.tone && toneMap[personalization.tone]) {
        sysPrompt += " " + toneMap[personalization.tone];
    }
    if (personalization.name) sysPrompt += ` The user's name is ${personalization.name}.`;
    if (personalization.occupation) sysPrompt += ` They work as: ${personalization.occupation}.`;
    if (personalization.customInstructions) sysPrompt += " " + personalization.customInstructions;

    if (activeProj && activeProj.instructions) {
        sysPrompt += "\n\nProject context: " + activeProj.instructions;
    }

    const contents = chat.messages.map(m => {
        const parts = [];
        
        // Append text prompt if present
        if (m.text && m.text.trim()) {
            parts.push({ text: m.text });
        }
        
        // Append attached files / images
        if (m.files && m.files.length > 0) {
            m.files.forEach(file => {
                if (file.isImage) {
                    const base64Data = file.data.split(",")[1];
                    parts.push({
                        inlineData: {
                            mimeType: file.type,
                            data: base64Data
                        }
                    });
                } else if (file.isText) {
                    // Send text/code file contents appended to this message turn
                    parts.push({
                        text: `\n\n[Attached File: ${file.name}]\n\`\`\`\n${file.data}\n\`\`\``
                    });
                }
            });
        }
        
        // Ensure at least one part exists
        if (parts.length === 0) {
            parts.push({ text: " " });
        }

        return {
            role: m.sender === "user" ? "user" : "model",
            parts: parts
        };
    });

    // Build request body — use maxOutputTokens=8192 for pro, else 4096
    const isProModel = settings.model.includes("pro");
    const body = {
        contents,
        generationConfig: {
            temperature: settings.temperature,
            maxOutputTokens: isProModel ? 8192 : 4096
        }
    };
    if (sysPrompt.trim()) body.systemInstruction = { parts: [{ text: sysPrompt.trim() }] };

    // Helper: try a specific model endpoint
    async function tryModel(modelName) {
        const url = `${GEMINI_API_URL}${modelName}:generateContent?key=${settings.apiKey}`;
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        return res;
    }

    let res = await tryModel(settings.model);

    // If the primary model fails with 404 / 400 (model not found or not available),
    // fall back gracefully through the known-working model list
    if (!res.ok && (res.status === 404 || res.status === 400 || res.status === 403)) {
        const fallbackModels = [
            "gemini-2.5-flash-preview-05-20",
            "gemini-2.5-flash",
            "gemini-2.0-flash",
            "gemini-1.5-flash"
        ];
        for (const fb of fallbackModels) {
            if (fb === settings.model) continue;
            res = await tryModel(fb);
            if (res.ok) break;
        }
    }

    if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errMsg  = errData.error?.message || `HTTP ${res.status}`;
        // Provide a helpful, human-readable hint
        if (res.status === 400 && errMsg.includes("API key")) {
            throw new Error("Invalid API key. Please check your Gemini API Key in Settings → General.");
        } else if (res.status === 403) {
            throw new Error("API key does not have permission to use this model. Try a different model in Settings.");
        } else if (res.status === 429) {
            throw new Error("Rate limit exceeded. Please wait a moment and try again.");
        } else {
            throw new Error(errMsg);
        }
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
        // Check finish reason for safety blocks
        const finishReason = data.candidates?.[0]?.finishReason;
        if (finishReason === "SAFETY") {
            throw new Error("Response blocked by safety filters. Please rephrase your request.");
        }
        throw new Error("Empty response from Gemini. Verify your API key and selected model.");
    }
    return text;
}

// ============================================================
//  OFFLINE SANDBOX RESPONSES
// ============================================================
function buildOfflineResponse(history) {
    const lastMsg = history[history.length - 1];
    const last = (lastMsg?.text || "").toLowerCase().trim();

    // Recompense for files/images in offline mode
    if (lastMsg?.files && lastMsg.files.length > 0) {
        const fileNames = lastMsg.files.map(f => `\`${f.name}\``).join(", ");
        const hasImage = lastMsg.files.some(f => f.isImage);
        
        if (hasImage) {
            return `### 📷 Image Upload Detected\n\nI see you attached the image(s): ${fileNames}.\n\nSince you are in **Offline Sandbox** mode, my visual recognition capabilities are disabled.\n\nTo let me analyze and describe this image, please add your **Gemini API Key** in Settings!`;
        } else {
            return `### 📄 File Upload Detected\n\nI see you attached the file(s): ${fileNames}.\n\nSince you are in **Offline Sandbox** mode, my code and logic analysis capabilities are disabled.\n\nTo analyze and read the contents of these files, please add your **Gemini API Key** in Settings!`;
        }
    }

    if (last === "hello" || last === "hi" || last === "hey" || last === "hola" || last === "greetings") {
        return `Hello! I am **AetherAI**, your intelligent companion. How can I help you today?\n\n> 💡 *Note: For complex inquiries, logical reasoning, and live API access, please add your **Gemini API Key** in Settings.*`;
    }
    
    if (last === "how are you" || last === "how's it going" || last === "how are you doing") {
        return `I am doing great and ready to help you! What project or conversation are we working on today?\n\n> 💡 *Note: To unlock direct Gemini LLM responses for complex coding or math questions, configure your **API Key** in Settings.*`;
    }
    
    if (last.includes("your name") || last === "who are you" || last === "what is aetherai") {
        return `I am **AetherAI**, a premium, glassmorphic chatbot interface inspired by ChatGPT and powered by the Gemini Developer API.\n\nYou can configure my settings, create project workspaces, customize my tone, and pin conversations.`;
    }

    if (last.includes("thank you") || last === "thanks") {
        return `You're very welcome! If you need anything else, just ask.`;
    }

    if (last.includes("quantum")) {
        return `### Quantum Computing 🌌\n\nImagine a normal computer uses bits (**0** or **1**). A quantum computer uses **qubits** that can be both 0 and 1 simultaneously.\n\n| Feature | Classical | Quantum |\n|:---|:---|:---|\n| **Unit** | Bit | Qubit |\n| **Logic** | Boolean | Quantum |\n| **Best for** | Browsing, files | Simulation, cryptography |\n\n> 💡 Enter a **Gemini API Key** in Settings to get live AI responses!`;
    }

    if (last.includes("code") || last.includes("javascript") || last.includes("python")) {
        return `Here is a clean modern JavaScript counter:\n\`\`\`javascript\nconst state = { count: 0 };\n\nfunction updateUI() {\n  document.getElementById("display").textContent = state.count;\n}\n\ndocument.getElementById("plus").addEventListener("click", () => {\n  state.count++;\n  updateUI();\n});\n\ndocument.getElementById("minus").addEventListener("click", () => {\n  state.count--;\n  updateUI();\n});\n\`\`\`\n\nSave as \`counter.js\` and link in your HTML.`;
    }

    if (last.includes("email") || last.includes("extension")) {
        return `**Subject:** Request for 2-Day Extension – Layout Deliverables\n\nDear [Manager],\n\nI hope this email finds you well. I am writing to request a short **two-day extension** for the layout deliverables currently due on [Date].\n\nWe have completed the core wireframes but need additional time to fine-tune the mobile breakpoints.\n\nBest regards,\n**[Your Name]**`;
    }

    return `### 💡 High-Potential Reasoning Required\n\nThis request (**"${escapeHTML(history[history.length - 1]?.text || "Your query")}"**) requires deeper reasoning, live logical calculations, or broad information extraction.\n\nTo generate high-quality live responses for this question, please configure your **Gemini API Key** in Settings:\n\n1. Click your profile avatar in the bottom-left corner and select **Settings**.\n2. Navigate to the **General** tab.\n3. Paste your API Key from [Google AI Studio](https://aistudio.google.com/).\n4. Click **Save Settings** to enable direct AI completions.\n\n*You can still explore all UI features (theme toggle, project sessions, chat pinning, and chat search) in Offline Sandbox mode!*`;
}

// ============================================================
//  MARKDOWN PARSER
// ============================================================
function parseMarkdown(md) {
    if (!md) return "";
    
    const codeBlocks = [];
    let processedMd = md.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
        const placeholder = `__CODE_BLOCK_PLACEHOLDER_${codeBlocks.length}__`;
        codeBlocks.push({ lang: lang || "code", code: code.trim() });
        return `\n\n${placeholder}\n\n`;
    });

    const tables = [];
    processedMd = processedMd.replace(/((?:\|[^\n]+\|\r?\n?)+)/g, (match) => {
        const placeholder = `__TABLE_PLACEHOLDER_${tables.length}__`;
        tables.push(match);
        return `\n\n${placeholder}\n\n`;
    });

    const lines = processedMd.split(/\r?\n/);
    const htmlBlocks = [];
    let currentBlock = null;

    function closeCurrentBlock() {
        if (!currentBlock) return;
        
        if (currentBlock.type === "paragraph") {
            const parsedLines = currentBlock.lines.map(l => parseInlineStyles(escapeHTML(l)));
            const text = parsedLines.join("<br>");
            if (text.trim()) {
                htmlBlocks.push(`<p>${text}</p>`);
            }
        } else if (currentBlock.type === "blockquote") {
            const content = currentBlock.lines.join("\n");
            htmlBlocks.push(`<blockquote>${parseMarkdown(content)}</blockquote>`);
        } else if (currentBlock.type === "ul") {
            let listHtml = "<ul>";
            currentBlock.lines.forEach(line => {
                let content = line;
                let isChecked = null;
                if (content.startsWith("[x] ")) {
                    isChecked = true;
                    content = content.substring(4);
                } else if (content.startsWith("[ ] ")) {
                    isChecked = false;
                    content = content.substring(4);
                }
                
                const parsedContent = parseInlineStyles(escapeHTML(content));
                if (isChecked !== null) {
                    listHtml += `<li><input type="checkbox" ${isChecked ? "checked" : ""} disabled style="margin-right:6px">${parsedContent}</li>`;
                } else {
                    listHtml += `<li>${parsedContent}</li>`;
                }
            });
            listHtml += "</ul>";
            htmlBlocks.push(listHtml);
        } else if (currentBlock.type === "ol") {
            let listHtml = "<ol>";
            currentBlock.lines.forEach(line => {
                const parsedContent = parseInlineStyles(escapeHTML(line));
                listHtml += `<li>${parsedContent}</li>`;
            });
            listHtml += "</ol>";
            htmlBlocks.push(listHtml);
        }
        currentBlock = null;
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (!trimmed) {
            closeCurrentBlock();
            continue;
        }

        if (trimmed.startsWith("__CODE_BLOCK_PLACEHOLDER_") && trimmed.endsWith("__")) {
            closeCurrentBlock();
            htmlBlocks.push(trimmed);
            continue;
        }
        if (trimmed.startsWith("__TABLE_PLACEHOLDER_") && trimmed.endsWith("__")) {
            closeCurrentBlock();
            htmlBlocks.push(trimmed);
            continue;
        }

        const headerMatch = line.match(/^(#{1,6})\s+(.*)$/);
        if (headerMatch) {
            closeCurrentBlock();
            const level = headerMatch[1].length;
            const text = parseInlineStyles(escapeHTML(headerMatch[2]));
            htmlBlocks.push(`<h${level}>${text}</h${level}>`);
            continue;
        }

        if (trimmed.startsWith(">")) {
            if (currentBlock && currentBlock.type !== "blockquote") {
                closeCurrentBlock();
            }
            if (!currentBlock) {
                currentBlock = { type: "blockquote", lines: [] };
            }
            const content = line.substring(line.indexOf(">") + 1);
            currentBlock.lines.push(content.startsWith(" ") ? content.substring(1) : content);
            continue;
        }

        const ulMatch = line.match(/^[\-\*]\s+(.*)$/);
        if (ulMatch) {
            if (currentBlock && currentBlock.type !== "ul") {
                closeCurrentBlock();
            }
            if (!currentBlock) {
                currentBlock = { type: "ul", lines: [] };
            }
            currentBlock.lines.push(ulMatch[1]);
            continue;
        }

        const olMatch = line.match(/^\d+\.\s+(.*)$/);
        if (olMatch) {
            if (currentBlock && currentBlock.type !== "ol") {
                closeCurrentBlock();
            }
            if (!currentBlock) {
                currentBlock = { type: "ol", lines: [] };
            }
            currentBlock.lines.push(olMatch[1]);
            continue;
        }

        if (currentBlock && currentBlock.type !== "paragraph") {
            closeCurrentBlock();
        }
        if (!currentBlock) {
            currentBlock = { type: "paragraph", lines: [] };
        }
        currentBlock.lines.push(line);
    }

    closeCurrentBlock();

    let finalHtml = htmlBlocks.join("");

    tables.forEach((tableMd, idx) => {
        const placeholder = `__TABLE_PLACEHOLDER_${idx}__`;
        const tableHtml = renderTableHtml(tableMd);
        finalHtml = finalHtml.replace(placeholder, tableHtml);
    });

    codeBlocks.forEach((block, idx) => {
        const placeholder = `__CODE_BLOCK_PLACEHOLDER_${idx}__`;
        const codeHtml = renderCodeBlockHtml(block.code, block.lang);
        finalHtml = finalHtml.replace(placeholder, codeHtml);
    });

    return finalHtml;
}

function parseInlineStyles(text) {
    if (!text) return "";
    let html = text;
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    return html;
}

function renderTableHtml(tableMd) {
    const rows = tableMd.trim().split("\n").filter(r => !r.match(/^\|[\s\-|]+\|$/));
    if (rows.length < 1) return "";
    let table = "<table><thead><tr>";
    const headers = rows[0].split("|").filter((_, i, a) => i > 0 && i < a.length - 1);
    headers.forEach(h => { table += `<th>${escapeHTML(h.trim())}</th>`; });
    table += "</tr></thead><tbody>";
    rows.slice(1).forEach(row => {
        const cols = row.split("|").filter((_, i, a) => i > 0 && i < a.length - 1);
        table += "<tr>" + cols.map(c => `<td>${parseInlineStyles(escapeHTML(c.trim()))}</td>`).join("") + "</tr>";
    });
    return table + "</tbody></table>";
}

function renderCodeBlockHtml(code, lang) {
    const language = lang || "code";
    return `<div class="code-block-wrapper"><div class="code-block-header"><span class="code-lang">${language}</span><button class="copy-code-btn" onclick="copyCodeBlock(this)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><span>Copy</span></button></div><pre><code>${syntaxHighlight(code, language)}</code></pre></div>`;
}

function syntaxHighlight(code, lang) {
    const l = lang.toLowerCase();
    if (!["js","javascript","ts","typescript","python","py","html","css","json"].includes(l)) return escapeHTML(code);
    let h = escapeHTML(code);
    h = h.replace(/(["'`])(.*?)\1/g, '<span class="hl-string">$&</span>');
    h = h.replace(/\b(const|let|var|function|return|if|else|for|while|class|import|export|from|def|print|elif|true|false|null|undefined|await|async|new|this|super)\b/g, '<span class="hl-keyword">$1</span>');
    h = h.replace(/\b(\d+\.?\d*)\b/g, '<span class="hl-number">$1</span>');
    h = h.replace(/\b(\w+)(?=\s*\()/g, '<span class="hl-function">$1</span>');
    h = h.replace(/(\/\/.*|#[^!].*)$/gm, '<span class="hl-comment">$1</span>');
    return h;
}

window.copyCodeBlock = function(btn) {
    const code = btn.closest(".code-block-wrapper").querySelector("code").textContent;
    navigator.clipboard.writeText(code);
    const span = btn.querySelector("span");
    span.textContent = "Copied!";
    setTimeout(() => { span.textContent = "Copy"; }, 2000);
};

// ============================================================
//  HELPERS
// ============================================================
function escapeHTML(str) {
    return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

function makeChatTitle(text) {
    const words = text.split(" ").slice(0, 5).join(" ");
    return words.length > 28 ? words.slice(0, 28) + "…" : words;
}

function openModal(id)  { $(id).classList.add("open"); }
function closeModal(id) { $(id).classList.remove("open"); }

function closeProfilePopup() { $("profile-popup-menu").classList.add("hidden"); }
function closeSidebarMobile() {
    $("sidebar").classList.remove("open");
    $("sidebar-overlay").classList.remove("open");
}

// ============================================================
//  VOICE RECOGNITION
// ============================================================
function setupSpeechRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { $("voice-btn").style.opacity = "0.35"; $("voice-btn").style.cursor = "not-allowed"; return; }
    speechRecognition = new SR();
    speechRecognition.continuous = false;
    speechRecognition.lang = "en-US";
    speechRecognition.interimResults = false;
    speechRecognition.onstart  = () => { isRecording = true;  $("voice-btn").style.color = "#ef4444"; $("chat-input").placeholder = "Listening…"; };
    speechRecognition.onresult = (e) => { const t = e.results[0][0].transcript; if (t) { $("chat-input").value = ($("chat-input").value + " " + t).trim(); $("chat-input").dispatchEvent(new Event("input")); } };
    speechRecognition.onerror  = () => stopVoiceRecording();
    speechRecognition.onend    = () => stopVoiceRecording();
}

function startVoiceRecording() { if (speechRecognition && !isRecording) speechRecognition.start(); }
function stopVoiceRecording()  {
    isRecording = false;
    $("voice-btn").style.color = "var(--text-muted)";
    $("chat-input").placeholder = "Message AetherAI…";
    try { speechRecognition.stop(); } catch {}
}

// ============================================================
//  ATTACHMENT PREVIEWS & HANDLERS
// ============================================================
function handleAttachClick() {
    $("file-input").click();
}

function handleFileSelection(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    files.forEach(file => {
        const isImage = file.type.startsWith("image/");
        const reader = new FileReader();
        
        reader.onload = (event) => {
            const dataUrl = event.target.result;
            attachedFiles.push({
                name: file.name,
                size: file.size,
                type: file.type,
                data: dataUrl,
                isImage: isImage
            });
            renderAttachmentPreviews();
            $("send-btn").disabled = isGenerating;
        };

        if (isImage) {
            reader.readAsDataURL(file);
        } else {
            const textExtensions = ["txt", "js", "py", "html", "css", "json", "md", "pdf"];
            const ext = file.name.split(".").pop().toLowerCase();
            if (textExtensions.includes(ext) || file.type.startsWith("text/")) {
                reader.onload = (event) => {
                    attachedFiles.push({
                        name: file.name,
                        size: file.size,
                        type: file.type,
                        data: event.target.result,
                        isImage: false,
                        isText: true
                    });
                    renderAttachmentPreviews();
                    $("send-btn").disabled = isGenerating;
                };
                reader.readAsText(file);
            } else {
                reader.readAsDataURL(file);
            }
        }
    });
    e.target.value = "";
}

function renderAttachmentPreviews() {
    const area = $("attachment-preview-area");
    if (!attachedFiles.length) {
        area.classList.add("hidden");
        area.innerHTML = "";
        return;
    }

    area.classList.remove("hidden");
    area.innerHTML = "";

    attachedFiles.forEach((file, idx) => {
        const item = document.createElement("div");
        item.className = "attachment-preview-item";
        
        let previewHtml = "";
        if (file.isImage) {
            previewHtml = `<img src="${file.data}" alt="${file.name}">`;
        } else {
            previewHtml = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
            `;
        }

        item.innerHTML = `
            ${previewHtml}
            <span class="attachment-preview-name">${escapeHTML(file.name)}</span>
            <button class="attachment-remove-btn" title="Remove file">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        `;

        item.querySelector(".attachment-remove-btn").addEventListener("click", () => {
            attachedFiles.splice(idx, 1);
            renderAttachmentPreviews();
            $("send-btn").disabled = ($("chat-input").value.trim().length === 0 && attachedFiles.length === 0) || isGenerating;
        });

        area.appendChild(item);
    });
}
