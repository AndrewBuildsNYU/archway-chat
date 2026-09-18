/* Archway Chat — transcript state, streaming turn loop, and the controls around it.
   Keys, models, errors and the readout strip all belong to the shared Archway client. */

(function () {
  "use strict";

  var el = {
    model: document.getElementById("model"),
    modelHint: document.getElementById("model-hint"),
    maxTokens: document.getElementById("max-tokens"),
    temperature: document.getElementById("temperature"),
    tempValue: document.getElementById("temp-value"),
    systemToggle: document.getElementById("system-toggle"),
    systemPanel: document.getElementById("system-panel"),
    system: document.getElementById("system"),
    transcript: document.getElementById("transcript"),
    emptyState: document.getElementById("empty-state"),
    readout: document.getElementById("readout"),
    errors: document.getElementById("errors"),
    composer: document.getElementById("composer"),
    prompt: document.getElementById("prompt"),
    send: document.getElementById("send"),
    stop: document.getElementById("stop"),
    newChat: document.getElementById("new-chat"),
    turns: document.getElementById("turns")
  };

  var state = {
    ready: false,      // a key is present and at least one model loaded
    busy: false,       // a stream is in flight
    modelsById: {},
    messages: [],      // the whole prior transcript, re-sent every turn
    controller: null
  };

  // Auto-scroll only while the reader is already at the bottom, so scrolling
  // back to re-read an earlier answer is not yanked away mid-stream.
  var stickToBottom = true;

  Archway.mountThemeToggle(document.getElementById("theme-toggle"));

  Archway.mountKeyPanel(document.getElementById("key-mount"), {
    onReady: function () {
      loadModels();
    },
    onClear: function () {
      state.ready = false;
      state.modelsById = {};
      Archway.clear(el.model);
      el.model.appendChild(new Option("Connect a key to load models", ""));
      el.modelHint.textContent = "The catalogue is filtered to what your key may call.";
      setEnabled(false);
    }
  });

  /* ---------------------------------------------------------------- models */

  function loadModels() {
    setEnabled(false);
    Archway.clear(el.errors);
    el.modelHint.textContent = "Loading the catalogue…";

    Archway.listModels().then(function (models) {
      var list = models || [];
      state.modelsById = {};
      list.forEach(function (m) { state.modelsById[m.id] = m; });

      if (!list.length) {
        el.modelHint.textContent = "No chat models available to this key.";
        showNotice("No models available",
          "This key cannot reach any chat model yet. Check your quota policy in the Archway portal.");
        return;
      }

      Archway.fillModelSelect(el.model, list, preferredModelId(list));
      describeModel();
      state.ready = true;
      setEnabled(true);
      el.prompt.focus();
    }).catch(function (err) {
      el.modelHint.textContent = "Could not load the catalogue.";
      Archway.renderError(el.errors, err);
    });
  }

  // Claude first when the key can reach one; it is the house default.
  function preferredModelId(models) {
    var claude = null;
    var fallback = null;
    models.forEach(function (m) {
      var hay = ((m.id || "") + " " + (m.provider || "") + " " + (m.owned_by || "")).toLowerCase();
      var isClaude = hay.indexOf("claude") > -1 || hay.indexOf("anthropic") > -1;
      if (!claude && isClaude && !m.deprecated) claude = m.id;
      if (!fallback && !m.deprecated) fallback = m.id;
    });
    return claude || fallback || models[0].id;
  }

  function describeModel() {
    var m = state.modelsById[el.model.value];
    if (!m) {
      el.modelHint.textContent = "The catalogue is filtered to what your key may call.";
      return;
    }

    var bits = [];
    if (m.provider) bits.push(m.provider);
    if (m.context_window) bits.push(Archway.formatInt(m.context_window) + " token context");
    if (m.max_output_tokens) {
      bits.push(Archway.formatInt(m.max_output_tokens) + " max output");
      // Keep the input inside what this model will actually accept.
      el.maxTokens.max = String(m.max_output_tokens);
      if (Number(el.maxTokens.value) > m.max_output_tokens) {
        el.maxTokens.value = String(m.max_output_tokens);
      }
    } else {
      el.maxTokens.removeAttribute("max");
    }
    if (m.deprecated) bits.push("deprecated");
    el.modelHint.textContent = bits.join(" · ");
  }

  /* ------------------------------------------------------------ transcript */

  function addMessage(role, text) {
    var wrap = Archway.el("div", role === "user" ? "msg msg--user" : "msg");
    wrap.appendChild(Archway.el("div", "msg__role", role === "user" ? "You" : "Assistant"));
    var body = Archway.el("div", "msg__body", text || "");
    wrap.appendChild(body);
    el.transcript.appendChild(wrap);
    stickToBottom = true;
    scrollToEnd();
    return { wrap: wrap, body: body };
  }

  function scrollToEnd() {
    if (stickToBottom) el.transcript.scrollTop = el.transcript.scrollHeight;
  }

  el.transcript.addEventListener("scroll", function () {
    var slack = el.transcript.scrollHeight - el.transcript.scrollTop - el.transcript.clientHeight;
    stickToBottom = slack < 80;
  });

  function refreshTranscriptChrome() {
    var turns = state.messages.filter(function (m) { return m.role === "user"; }).length;
    el.emptyState.classList.toggle("hidden", state.messages.length > 0);
    el.turns.textContent = turns === 0 ? "No turns yet" : turns + (turns === 1 ? " turn" : " turns");
  }

  function showNotice(title, detail) {
    var box = Archway.el("div", "alert");
    box.appendChild(Archway.el("div", "alert__title", title));
    box.appendChild(Archway.el("p", "small", detail));
    Archway.clear(el.errors);
    el.errors.appendChild(box);
  }

  /* ------------------------------------------------------------- the turn */

  function send() {
    if (!state.ready || state.busy) return;

    var text = el.prompt.value.trim();
    var model = el.model.value;
    if (!text || !model) return;

    Archway.clear(el.errors);
    el.prompt.value = "";
    sizePrompt();

    state.messages.push({ role: "user", content: text });
    var userBubble = addMessage("user", text);
    refreshTranscriptChrome();

    var bubble = addMessage("assistant", "");
    bubble.body.classList.add("streaming");
    bubble.body.setAttribute("aria-busy", "true");

    var controller = new AbortController();
    state.controller = controller;
    setBusy(true);

    var partial = "";
    var system = el.system.value.trim();

    Archway.streamChat({
      model: model,
      messages: state.messages.slice(),
      system: system || undefined,
      maxTokens: readMaxTokens(),
      temperature: Number(el.temperature.value),
      signal: controller.signal
    }, function (fragment, full) {
      partial = full;
      bubble.body.textContent = full;
      scrollToEnd();
    }).then(function (res) {
      var answer = (res && typeof res.text === "string" && res.text) || partial;
      bubble.body.textContent = answer;
      state.messages.push({ role: "assistant", content: answer });
      Archway.renderReadout(el.readout, res.headers, { ms: res.ms });
    }).catch(function (err) {
      var aborted = err && err.name === "AbortError";

      // A half-finished answer is still context, and the roles stay alternating.
      // With nothing streamed there is no answer to keep, so the turn is undone
      // and the text handed back to the composer.
      if (partial) {
        state.messages.push({ role: "assistant", content: partial });
        if (!aborted) Archway.renderError(el.errors, err);
      } else {
        el.transcript.removeChild(bubble.wrap);
        el.transcript.removeChild(userBubble.wrap);
        state.messages.pop();
        el.prompt.value = text;
        sizePrompt();
        if (!aborted) Archway.renderError(el.errors, err);
      }
    }).finally(function () {
      bubble.body.classList.remove("streaming");
      bubble.body.removeAttribute("aria-busy");
      state.controller = null;
      setBusy(false);
      refreshTranscriptChrome();
      scrollToEnd();
      el.prompt.focus();
    });
  }

  function readMaxTokens() {
    var n = parseInt(el.maxTokens.value, 10);
    if (!isFinite(n) || n < 1) n = 800;
    var cap = parseInt(el.maxTokens.max, 10);
    if (isFinite(cap) && n > cap) n = cap;
    el.maxTokens.value = String(n);
    return n;
  }

  function stop() {
    if (state.controller) state.controller.abort();
  }

  function newChat() {
    if (state.busy) return;
    state.messages = [];
    Archway.clear(el.transcript);
    el.transcript.appendChild(el.emptyState);
    Archway.renderReadout(el.readout, null);
    Archway.clear(el.errors);
    stickToBottom = true;
    refreshTranscriptChrome();
    el.prompt.focus();
  }

  /* ------------------------------------------------------------ UI state */

  function setEnabled(on) {
    [el.model, el.maxTokens, el.temperature, el.system, el.systemToggle, el.prompt, el.newChat]
      .forEach(function (node) { node.disabled = !on; });
    el.send.disabled = !on || !el.prompt.value.trim();
    el.stop.disabled = true;
  }

  function setBusy(busy) {
    state.busy = busy;
    [el.model, el.maxTokens, el.temperature, el.system, el.systemToggle, el.newChat]
      .forEach(function (node) { node.disabled = busy || !state.ready; });
    // The composer stays live during a stream so the next question can be typed.
    el.prompt.disabled = !state.ready;
    el.send.disabled = busy || !state.ready || !el.prompt.value.trim();
    el.stop.disabled = !busy;
  }

  function sizePrompt() {
    el.prompt.style.height = "auto";
    el.prompt.style.height = Math.min(el.prompt.scrollHeight, 224) + "px";
  }

  /* --------------------------------------------------------------- events */

  el.composer.addEventListener("submit", function (ev) {
    ev.preventDefault();
    send();
  });

  el.prompt.addEventListener("keydown", function (ev) {
    // Shift+Enter is a newline; a live IME composition must not be interrupted.
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      send();
    }
  });

  el.prompt.addEventListener("input", function () {
    sizePrompt();
    el.send.disabled = state.busy || !state.ready || !el.prompt.value.trim();
  });

  el.stop.addEventListener("click", stop);
  el.newChat.addEventListener("click", newChat);
  el.model.addEventListener("change", describeModel);

  el.temperature.addEventListener("input", function () {
    el.tempValue.textContent = Number(el.temperature.value).toFixed(2);
  });

  el.systemToggle.addEventListener("click", function () {
    var open = el.systemPanel.classList.toggle("hidden") === false;
    el.systemToggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) el.system.focus();
  });

  // Escape aborts a stream from anywhere, including the composer — it is not a
  // key anyone types into a message.
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && state.busy) {
      ev.preventDefault();
      stop();
    }
  });

  el.tempValue.textContent = Number(el.temperature.value).toFixed(2);
  setEnabled(false);
  refreshTranscriptChrome();
})();
