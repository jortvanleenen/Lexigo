const DEFAULT_LANGUAGE = "en";
const DEFAULT_TRIGGER_KEY = "none";
let LANGUAGE = DEFAULT_LANGUAGE;
let TRIGGER_KEY = DEFAULT_TRIGGER_KEY;

let POPUP_ID = 0;
const POPUP_LINKS = new Map();

const { computePosition, offset, flip, shift, arrow, autoUpdate } =
  globalThis.FloatingUIDOM;

// Marker attribute identifying popup hosts created by this extension
const POPUP_HOST_ATTR = "data-lexigo-popup";

// Remove popups orphaned by a previous content-script context
for (const el of document.querySelectorAll(
  `[${POPUP_HOST_ATTR}="${browser.runtime.id}"]`,
)) {
  el.remove();
}

let POPUP_ASSETS = null;

/**
 * Load the popup template and stylesheet, memoized. A failed load resets the
 * memo so the next lookup retries instead of leaving the extension inert.
 *
 * @returns {Promise<{template: HTMLTemplateElement, css: string}>}
 */
function loadPopupAssets() {
  POPUP_ASSETS ??= Promise.all([
    fetch(browser.runtime.getURL("content/popup.html")).then((r) => r.text()),
    fetch(browser.runtime.getURL("content/popup.css")).then((r) => r.text()),
  ])
    .then(([html, css]) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const template = document.createElement("template");
      template.content.append(...doc.body.children);
      return { template, css };
    })
    .catch((error) => {
      POPUP_ASSETS = null;
      console.error("Lexigo: failed to load popup assets", error);
      throw error;
    });
  return POPUP_ASSETS;
}

loadPopupAssets().catch(() => {});

/**
 * Register a popup element in the tree of popups.
 *
 * @param el {HTMLElement} The popup div to register.
 * @param parentId {string} The id of the parent popup, else '' for root popup.
 * @returns {string} The id assigned to this popup.
 */
function registerPopup(el, parentId = "") {
  const id = String(++POPUP_ID);
  el.dataset.id = id;
  el.dataset.parent = parentId;
  POPUP_LINKS.set(id, { el, parentId, children: new Set(), cleanup: null });
  if (parentId) {
    POPUP_LINKS.get(parentId)?.children.add(id);
  }
  return id;
}

/**
 * Unlink a popup from its parent in the tree of popups.
 *
 * @param id {string} The id of the popup to unlink.
 */
function unlinkFromParent(id) {
  const node = POPUP_LINKS.get(id);
  if (!node) {
    return;
  }
  if (node.parentId) {
    POPUP_LINKS.get(node.parentId)?.children.delete(id);
  }
}

/**
 * Prune a subtree of popups, optionally including the root of the subtree.
 *
 * @param id {string} The id of the root of the subtree to prune.
 * @param includeSelf {boolean} Whether to include the root of the subtree.
 */
function pruneSubtree(id, includeSelf = false) {
  const node = POPUP_LINKS.get(id);
  if (!node) {
    return;
  }

  for (const childId of Array.from(node.children)) {
    pruneSubtree(childId, true);
  }

  if (includeSelf) {
    unlinkFromParent(id);
    node.cleanup?.();
    node.el.remove();
    POPUP_LINKS.delete(id);
  } else {
    node.children.clear();
  }
}

/**
 * Check if an event originated from within a popup.
 *
 * @param e {Event} The event to check.
 * @returns {*|null} The popup element if found, else null.
 */
function eventFromPopup(e) {
  const path = e.composedPath ? e.composedPath() : [];
  return (
    path.find(
      (n) =>
        n instanceof HTMLElement &&
        n.dataset?.id &&
        POPUP_LINKS.get(n.dataset.id)?.el === n,
    ) || null
  );
}

/**
 * Remove all popups from the document.
 */
function removeAllPopups() {
  for (const id of Array.from(POPUP_LINKS.keys())) {
    pruneSubtree(id, true);
  }
}

document.addEventListener("click", (e) => {
  if (!eventFromPopup(e)) {
    removeAllPopups();
  }
});

globalThis.addEventListener("pagehide", removeAllPopups);

/**
 * Retrieve the meaning of a word by sending a message to the background script.
 *
 * @param info {Object} The selection info containing the word and its position.
 * @returns {Promise<any>} A promise that resolves with the meaning data.
 */
function retrieveMeaning(info) {
  return browser.runtime.sendMessage({
    word: info.word,
    lang: LANGUAGE,
    time: Date.now(),
  });
}

/**
 * Handle the case where no meaning is found for the selected word.
 *
 * @param popupDiv {Object} The popup to update.
 */
function noMeaningFound(popupDiv) {
  popupDiv.heading.textContent = "Sorry";
  popupDiv.status.textContent = "No definition was found.";
  popupDiv.moreInfo.hidden = false;
}

/**
 * Open a modal popup with the definition of the selected word.
 *
 * @param event {Event} The event that triggered the popup.
 */
function openModal(event) {
  const info = getSelectionInfo(event);
  if (!info) {
    return;
  }

  const fromPopup = eventFromPopup(event);
  if (fromPopup) {
    pruneSubtree(fromPopup.dataset.id);
  }
  const parentId = fromPopup ? fromPopup.dataset.id : "";

  loadPopupAssets()
    .then((assets) => {
      const createdDiv = createDiv(info, parentId, assets);
      retrieveMeaning(info)
        .then((response) => {
          if (!response?.content) {
            return noMeaningFound(createdDiv);
          }
          appendToDiv(createdDiv, response.content);
        })
        .catch(() => noMeaningFound(createdDiv));
    })
    .catch(() => {});
}

document.addEventListener("dblclick", (e) => {
  if (
    TRIGGER_KEY === "none" ||
    (typeof e[`${TRIGGER_KEY}Key`] === "boolean" && e[`${TRIGGER_KEY}Key`])
  ) {
    openModal(e);
  }
});

/**
 * Get information about the current text selection.
 *
 * @param event {Event} The event that triggered the selection.
 * @returns The selection info or null if no valid selection.
 */
function getSelectionInfo(event) {
  const selection = globalThis.getSelection?.();
  if (!selection || selection.isCollapsed || !selection.rangeCount) {
    return null;
  }

  const word = selection.toString().trim();
  if (word.length <= 1) {
    return null;
  }

  // Clone the range so the popup stays anchored to the selected text even
  // after the page selection itself is cleared.
  const range = selection.getRangeAt(0).cloneRange();
  const clientX = event?.clientX ?? 0;
  const clientY = event?.clientY ?? 0;

  return { word, range, clientX, clientY };
}

/**
 * Build a Floating UI virtual element anchored to the selection rectangle,
 * falling back to the mouse position for selections without a box.
 *
 * @param info {Object} The selection info.
 * @returns {Object} A virtual element usable as a Floating UI reference.
 */
function createAnchor(info) {
  return {
    getBoundingClientRect() {
      const rect = info.range.getBoundingClientRect();
      if (rect.width || rect.height) {
        return rect;
      }
      return {
        width: 0,
        height: 0,
        x: info.clientX,
        y: info.clientY,
        top: info.clientY,
        bottom: info.clientY,
        left: info.clientX,
        right: info.clientX,
      };
    },
    contextElement: info.range.startContainer?.parentElement ?? undefined,
  };
}

function createDiv(info, parentId, assets) {
  const hostDiv = document.createElement("div");
  hostDiv.setAttribute(POPUP_HOST_ATTR, browser.runtime.id);
  hostDiv.style.position = "fixed";
  hostDiv.style.top = "0";
  hostDiv.style.left = "0";
  hostDiv.style.width = "max-content";
  hostDiv.style.zIndex = "2147483647";

  const thisId = registerPopup(hostDiv, parentId);
  const shadow = hostDiv.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = assets.css;
  shadow.appendChild(style);
  shadow.appendChild(assets.template.content.cloneNode(true));

  const headingEl = shadow.querySelector(".heading");
  const pronunciationEl = shadow.querySelector(".pronunciation");
  const statusEl = shadow.querySelector(".status");
  const definitionsEl = shadow.querySelector(".definitions");
  const moreInfoEl = shadow.querySelector(".learn-more");
  const audioEl = shadow.querySelector(".audio");
  const closeBtn = shadow.querySelector(".close-btn");
  const arrowEl = shadow.querySelector(".lexigo-arrow");

  const ddgLang = LANGUAGE === "en" ? "us-en" : LANGUAGE;
  moreInfoEl.href = `https://noai.duckduckgo.com/search?kl=${ddgLang}&q=define+${encodeURIComponent(info.word)}`;

  closeBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    pruneSubtree(thisId, true);
  });

  document.body.appendChild(hostDiv);

  const anchor = createAnchor(info);
  const updatePosition = () => {
    computePosition(anchor, hostDiv, {
      strategy: "fixed",
      placement: "bottom",
      middleware: [
        offset(10),
        flip(),
        shift({ padding: 8 }),
        arrow({ element: arrowEl, padding: 12 }),
      ],
    }).then(({ x, y, placement, middlewareData }) => {
      hostDiv.style.left = `${x}px`;
      hostDiv.style.top = `${y}px`;

      const side = placement.split("-")[0];
      const staticSide = {
        top: "bottom",
        bottom: "top",
        left: "right",
        right: "left",
      }[side];
      const arrowData = middlewareData.arrow || {};
      Object.assign(arrowEl.style, {
        left: arrowData.x == null ? "" : `${arrowData.x}px`,
        top: arrowData.y == null ? "" : `${arrowData.y}px`,
        right: "",
        bottom: "",
        [staticSide]: "-6px",
      });
    });
  };

  POPUP_LINKS.get(thisId).cleanup = autoUpdate(anchor, hostDiv, updatePosition);

  return {
    heading: headingEl,
    pronunciation: pronunciationEl,
    status: statusEl,
    definitions: definitionsEl,
    moreInfo: moreInfoEl,
    audio: audioEl,
  };
}

/**
 * Play the pronunciation of a word: recorded audio when available, otherwise
 * the browser's built-in text-to-speech.
 *
 * @param word {string} The word to pronounce.
 * @param audioSrc {?string} URL of a recorded pronunciation, if any.
 */
function playPronunciation(word, audioSrc) {
  const speak = () => {
    if (!globalThis.speechSynthesis) {
      return;
    }
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = LANGUAGE;
    speechSynthesis.speak(utterance);
  };

  if (audioSrc) {
    new Audio(audioSrc).play().catch(speak);
  } else {
    speak();
  }
}

function appendToDiv(createdDiv, content) {
  createdDiv.heading.textContent = content.word;
  createdDiv.pronunciation.textContent = content.phoneticText || "";

  createdDiv.status.remove();
  for (const meaning of content.meanings) {
    const item = document.createElement("li");
    if (meaning.partOfSpeech) {
      const pos = document.createElement("span");
      pos.className = "pos";
      pos.textContent = meaning.partOfSpeech;
      item.appendChild(pos);
    }
    item.appendChild(document.createTextNode(meaning.definition));
    if (meaning.example) {
      const example = document.createElement("span");
      example.className = "example";
      example.textContent = meaning.example;
      item.appendChild(example);
    }
    createdDiv.definitions.appendChild(item);
  }
  createdDiv.definitions.hidden = false;
  createdDiv.moreInfo.hidden = false;

  createdDiv.audio.hidden = false;
  createdDiv.audio.addEventListener("click", () => {
    playPronunciation(content.word, content.audioSrc);
  });
}

/**
 * Apply user settings from storage to this script's state.
 *
 * @param results {Object} The storage contents.
 */
function applySettings(results) {
  const {
    language = DEFAULT_LANGUAGE,
    interaction = { dblClick: { key: DEFAULT_TRIGGER_KEY } },
  } = results;

  LANGUAGE = language;
  TRIGGER_KEY = interaction.dblClick?.key ?? DEFAULT_TRIGGER_KEY;
}

browser.storage.local.get().then(applySettings);

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }
  const updated = {};
  if (changes.language) {
    updated.language = changes.language.newValue;
  }
  if (changes.interaction) {
    updated.interaction = changes.interaction.newValue;
  }
  if (Object.keys(updated).length) {
    applySettings({
      language: LANGUAGE,
      interaction: { dblClick: { key: TRIGGER_KEY } },
      ...updated,
    });
  }
});
