# Tracen Crossword Club

[简体中文](README.md) · **English** · [日本語](README.ja.md)

A multilingual crossword game with Umamusume character names as answers. The project uses native HTML, CSS and JavaScript, with JSON files for puzzles, the character dictionary and clue sources. Game logic is separate from DOM interaction.

The interface and clues support Simplified Chinese, English and Japanese. Answers can use English letters or katakana, independently of the interface language. The current catalog contains four collections, eight puzzles and a dictionary of 97 characters.

## Features

| Feature | Behavior |
| --- | --- |
| Puzzle selection | Select a collection, answer script and individual puzzle |
| Assisted mode | Fully correct words turn green and reveal all three character names; name lookups are unlimited |
| Answer assistance | Reveal up to three distinct answers per game; revisiting an answer is free. Reveals do not fill the board or pause the timer |
| Challenge mode | Hide correctness feedback until every answer is correct; allow three nonempty name searches per game, including searches with no matches |
| Early ending | End a Challenge game, stop the timer and reveal the full solution, separately from a successful completion |
| Name lookup | Search Chinese, English, kana, partial names and dictionary aliases; results show all three names |
| Input | Keyboard navigation, direction switching at crossings, whole-word paste and Japanese IME support |
| Settings | Interface-language and play-mode changes preserve the board, timer and used allowances; applying a different puzzle or answer script starts a new game |
| Cloud statistics | Starts, successful completions and average solve times by puzzle revision; separate all-Challenge results and multilingual display |

Timing starts when a game session is created and stops on success or confirmed early ending. Settings, search and answer dialogs do not pause it. Searches and answer reveals use separate allowances; switching modes does not restore either allowance.

## Development environment and commands

The project is verified with Node.js 24. It has no third-party npm dependencies and requires no dependency installation. Browsers need ES Modules, the Fetch API and native `<dialog>` support.

```sh
npm run dev
```

The development server runs at `http://localhost:5173/`. Open the app over HTTP so that modules and JSON data can load.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Serve the project root locally |
| `npm run check:data` | Check puzzles, the dictionary, paired puzzles and source consistency |
| `npm test` | Run game-logic and data regression tests with Node.js’s built-in test runner |
| `npm run build` | Validate data and regenerate the static `dist/` output |
| `npm run build:worker` | Generate puzzle revisions and solutions for the statistics Worker |
| `npm run preview` | Serve `dist/` locally after building |

Use `npm.cmd` instead of `npm` where needed in Windows PowerShell. `启动游戏.cmd` is a Windows shortcut for development preview. The server reads the `PORT` environment variable; development and output previews both default to port 5173, so use different ports when running them together.

## Code structure

```text
.
├── index.html                   # Page structure and dialogs
├── src/
│   ├── main.js                  # DOM rendering, input, settings and session orchestration
│   ├── game.js                  # State, evaluation, normalization, search and validation
│   ├── catalog.js               # Manifest and enabled-puzzle loading
│   ├── analytics.js             # Anonymous game reports, retry outbox and cache
│   ├── analytics-config.js      # Public API origin and production origin
│   ├── analytics-protocol.js    # Content revisions and solution conversion
│   ├── i18n.js                  # Interface strings and placeholder substitution
│   └── style.css                # Page, grid and responsive styles
├── data/
│   ├── characters.json          # Names in three languages, aliases and sources
│   ├── levels/                  # Manifest, grids, answers and multilingual clues
│   ├── epithets.json            # Epithet mapping and clue translations
│   └── cinderella-gray.json     # Story clues, character names and per-clue sources
├── schemas/                     # JSON Schemas
├── functions/api/               # Same-origin Pages API forwarding to the Worker
├── worker/                      # Statistics API, D1 configuration and migrations
├── wrangler.jsonc               # Pages output and STATS service binding
├── _routes.json                 # Invoke Pages Functions only for /api/*
├── scripts/                     # Local server, data checking and static build
├── tests/                       # Game, data, statistics and SQLite tests
├── docs/                        # Puzzle maintenance and source references
└── .vscode/settings.json         # Editor associations for JSON Schemas
```

## Runtime architecture

`catalog.js` reads the character dictionary and `data/levels/index.json`, loads enabled puzzles and validates their data through `game.js`. `main.js` passes the selected puzzle to `GameSession`, creates the grid, binds input handlers and renders clues.

`game.js` has no DOM access. `GameSession` owns letters, timing, play mode, lookup usage, revealed answers and termination state. The module also implements answer evaluation, search and text normalization. Its clock can be injected for deterministic timing tests.

The `finishReason` field distinguishes `solved` from `revealed`: the former means every answer is correct; the latter means an early ending with the solution exposed. `session.completed` means the session has ended and does not, on its own, indicate success.

The interface-language preference is stored under `tracen-ui-language` in `localStorage`. Board contents, timing and allowances remain in memory and are not restored after a reload. Each reported game gets a random ID; failed reports use a temporary local outbox. No accounts, device fingerprints or persistent visitor IDs are used.

Production requests use same-origin `/api/` routes. A Pages Function calls the independent Worker through its `STATS` service binding; the Worker accesses D1 through `DB`. Database triggers maintain aggregates and prevent duplicate counts. Early endings do not count as wins. Public endpoints expose aggregates only. Local and preview builds do not write production statistics by default; reporting failures never block play. See [deployment and maintenance](docs/统计服务部署与维护.md) (Chinese).

## Puzzle data and localization

Each puzzle is an independent JSON file. Current puzzles have 11 across and 11 down entries. English and katakana versions of the same puzzle share a character roster but use separate layouts; numbering, positions and directions may differ. Match entries through `characterId`.

| Collection | `difficulty` | English grid | Katakana grid |
| --- | --- | --- | --- |
| Starter | `beginner` | 24×24 | 19×20 |
| Advanced | `advanced` | 25×25 | 19×19 |
| Signature Epithets | `epithets` | 23×24 | 20×18 |
| Cinderella Gray | `cinderella` | 23×23 | 20×20 |

`difficulty` is a legacy field name for the puzzle collection, independent of Assisted/Challenge play mode. Language and data conventions are:

| Field | Convention |
| --- | --- |
| `title`, `description`, `clues` | Require `zh-CN`, `en` and `ja` strings |
| `answerLanguage` | `en` for English letters; `ja` for katakana |
| `grid.layout` | `#` for blocked cells; `.` for answer cells |
| `row`, `column` | Zero-based answer-start coordinates |
| `characterId` | Reference to a character ID in `characters.json` |
| `answer` | Canonical answer matching the normalized character name in the answer language |

English answers are uppercase with spaces and punctuation removed. Katakana retains small kana and the long-vowel mark, with one character per cell. Input normalization supports halfwidth kana, hiragana and combining voiced marks. Search aliases do not change canonical answers.

Interface strings live in `src/i18n.js`, clues in puzzle files and names in the character dictionary. Maintain these separately. A name translation change may also require updates to clue references and source records.

## Adding and maintaining puzzles

1. Add any missing characters, names in all three languages and search aliases to `data/characters.json`.
2. Use an existing puzzle and the [Level Schema](schemas/level.schema.json) to author a grid, answer coordinates, character references, and titles and clues in all three languages.
3. Register a unique ID and filename in `data/levels/index.json`. Manifest order controls menu order; `enabled: false` disables a puzzle.
4. Use `*-en` and `*-kana` ID suffixes for paired versions, keeping their collection and character roster consistent. Grids are explicitly maintained in JSON; the application validates and renders them.
5. Update thematic source records. Epithet and Cinderella Gray clues must stay synchronized with their respective source JSON files.
6. Run data checks, tests and the build, then confirm that puzzles and build output load correctly.

Adding a puzzle within an existing collection normally requires data changes only. Adding a new collection also requires updates to the `index.html` menu, translated collection labels, category validation in `game.js` and the level Schema.

Grid validation checks translations, character references, canonical answers, bounds, crossings, unlisted letter runs, cell coverage, numbering and connectivity. Build-time checks also verify paired character rosters and thematic source consistency. Disabled puzzles still participate in maintenance checks but are not loaded by the web app.

## Building and testing

```sh
npm run check:data
npm test
npm run build
npm run preview
```

The build uses Node.js file operations without transpiling or bundling JavaScript. It recreates `dist/` and copies `index.html`, `favicon.svg`, `src/` and `data/`. Modules and data use relative URLs and run in a static HTTP environment. Building does not automatically run tests; execute `npm test` separately.

Tests cover input normalization, answer evaluation, timing and state changes, search and reveal allowances, early ending, translation completeness, and regressions in puzzle categories, paired versions and character translations. Run data checks even for content-only puzzle changes.

## References

This is an unofficial fan project. Some character translations and Chinese/English epithet clues are project conventions or original translations. The name dictionary is not a complete, live official character database.

- [Puzzle data format and maintenance](docs/关卡数据格式.md) (Chinese)
- [Epithet sources and mapping](docs/二つ名来源与映射.md) (Chinese)
- [Cinderella Gray puzzles and per-clue sources](docs/芦毛灰姑娘题库与来源.md) (Chinese)

The latter two documents contain answers and story details.
