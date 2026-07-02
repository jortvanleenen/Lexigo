const DEFAULT_HISTORY_SETTING = { enabled: true };
const MAX_DEFINITIONS = 5;

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { word, lang } = request || {};
  const term = (word || "").trim();
  if (!term) {
    sendResponse({ content: null });
    return true;
  }

  const langNorm = (lang || "en").toLowerCase();

  const primary = () => {
    if (!langNorm.startsWith("en")) return Promise.resolve(null);
    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term)}`;
    return fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.resolve(null)))
      .then((json) => parseDictionaryApiResponse(json, term))
      .catch(() => null);
  };

  const fallback = () => {
    console.log("Falling back to DDG lookup");
    const url = `https://noai.duckduckgo.com/?t=h_&q=define+${encodeURIComponent(term)}&ia=web`;
    return fetch(url)
      .then((r) => r.text())
      .then((html) => {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const module = doc.querySelector(".module.ia-module--definitions");
        if (!module) return null;

        const title = module.querySelector(".module__title");
        const wordText = title ? title.childNodes[0].textContent.trim() : term;

        const meanings = [];
        const defEls = module.querySelectorAll(
          ".module--definitions__definition",
        );
        for (const defEl of defEls) {
          const def = defEl.textContent.trim();
          if (!def) continue;
          meanings.push({
            partOfSpeech: "",
            definition: capitalize(def),
            example: null,
          });
          if (meanings.length >= MAX_DEFINITIONS) break;
        }
        if (!meanings.length) return null;

        return {
          word: wordText,
          phoneticText: null,
          audioSrc: null,
          meanings,
        };
      })
      .catch(() => null);
  };

  primary()
    .then((content) => content ?? fallback())
    .then((content) => {
      sendResponse({ content });

      if (content) {
        browser.storage.local.get().then((results) => {
          const history = results.history || DEFAULT_HISTORY_SETTING;
          if (history.enabled) return saveWord(content);
        });
      }
    })
    .catch(() => sendResponse({ content: null }));

  return true;
});

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Collect up to MAX_DEFINITIONS definitions across all entries of a
 * dictionaryapi.dev response, preserving part of speech and example.
 */
function collectMeanings(entries) {
  return entries
    .flatMap((entry) =>
      (entry.meanings ?? []).flatMap((meaning) =>
        (meaning.definitions ?? [])
          .filter((definition) => definition.definition)
          .map((definition) => ({
            partOfSpeech: meaning.partOfSpeech || "",
            definition: capitalize(definition.definition),
            example: definition.example || null,
          })),
      ),
    )
    .slice(0, MAX_DEFINITIONS);
}

/**
 * Find the first phonetic transcription and audio recording in the entries
 * of a dictionaryapi.dev response.
 */
function findPhonetics(entries) {
  let phoneticText = null;
  let audioSrc = null;
  for (const entry of entries) {
    const phon = (entry.phonetics || []).find((p) => p.audio || p.text) || {};
    phoneticText ||= phon.text || entry.phonetic || null;
    audioSrc ||= phon.audio || null;
    if (phoneticText && audioSrc) {
      break;
    }
  }
  return { phoneticText, audioSrc };
}

/**
 * Convert a dictionaryapi.dev response into the popup content shape,
 * or null if it contains no usable definitions.
 */
function parseDictionaryApiResponse(json, term) {
  if (!Array.isArray(json) || !json.length) {
    return null;
  }

  const meanings = collectMeanings(json);
  if (!meanings.length) {
    return null;
  }

  return {
    word: json[0].word || term,
    ...findPhonetics(json),
    meanings,
  };
}

function saveWord(content) {
  return browser.storage.local.get("definitions").then((results) => {
    const definitions = results.definitions || {};
    definitions[content.word] = content.meanings
      .map((m) => (m.partOfSpeech ? `(${m.partOfSpeech}) ` : "") + m.definition)
      .join("\n");
    return browser.storage.local.set({ definitions });
  });
}
