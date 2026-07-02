# Lexigo

Lexigo is an instant, in-browser dictionary for Firefox.
Whenever you come across an unfamiliar word online, simply double-click it to see its definitions, pronunciation, and an
option to learn more, without having to leave the page.

## Installation

[**Get Lexigo on Firefox Add-ons**](https://addons.mozilla.org/en-US/firefox/addon/lexigo/)

Alternatively, build it from source ([Development](#development)) and load the packaged zip, or run straight from this
repository ([GitHub](https://github.com/jortvanleenen/lexigo)) with `npm run dev`.

## Features

- **Instant lookups**: double-click any word to get a popup with up to five definitions, grouped by part of speech,
  with example sentences where available.
- **Pronunciation**: phonetic transcription plus a speaker icon that plays a recorded pronunciation, falling back to
  your browser's text-to-speech when no recording exists.
- **Nested lookups**: double-click a word _inside_ a popup to look that up too.
- **Trigger key**: optionally require holding Ctrl, Alt, or Shift (Command on macOS) while double-clicking, so popups
  only appear when you want them.
- **Word history**: optionally store every word you look up, view the count in the options page, and export it as CSV.
- **Learn more**: every popup links to a full web search for the word.
- **Dark mode**: the popup and options page follow your system color scheme.

## Usage

1. Double-click a word on any page (holding your configured trigger key, if set).
2. Click the speaker icon to hear the word, or "Learn more »" for a full search.
3. Click anywhere outside the popup, or its × button, to dismiss it.

Settings live under the extension's options page (Add-ons Manager → Lexigo → Preferences): language, trigger key, and
word history (including CSV download and clearing).

## How it works

Definitions come from the free [Dictionary API](https://dictionaryapi.dev/), with a DuckDuckGo fallback for words it
doesn't know. Lookups are sent only to those services and only when you trigger them; the extension collects no data
(word history is stored locally in your browser and never leaves it).

## Development

Prerequisites: Node.js and Firefox.

```bash
npm install        # install dev tooling (ESLint, Prettier, web-ext)
npm run dev        # launch Firefox with the extension, auto-reloading on save
npm run build      # package the extension into web-ext-artifacts/
```

Quality checks:

```bash
npm run lint       # ESLint with auto-fix (lint:check to only report)
npm run format     # Prettier write (format:check to only report)
npm run lint:ext   # addons-linter, the same validation AMO runs on submission
```

## Credits

Original work by meetDeveloper ([GitHub Repository](https://github.com/meetDeveloper/Dictionary-Anywhere)).

## License

GPLv3 license. See LICENSE file for details.
