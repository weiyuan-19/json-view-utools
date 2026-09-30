# Repository Guidelines

## Project Structure & Module Organization

This is a uTools JSON editor built with Vite and CodeMirror. `index.html` and `src/app.js` provide the UI entry point; `src/styles.css` contains the interface styles. Keep focused editor features in the existing `src/` modules, such as `transform.js`, `diagnostics.js`, `search-panel.js`, and `lua-to-json.js`. `public/` holds the uTools manifest, preload script, and logo. Tests live in `test/` and use matching feature names (`src/diagnostics.js` → `test/diagnostics.test.js`). Vite writes the loadable plugin to `plugin/`; that generated directory is ignored by Git.

## Build, Test, and Development Commands

Use Node.js 20.19+ or 22.12+.

- `npm install` installs dependencies from `package-lock.json`.
- `npm run dev` watches source files and rebuilds `plugin/`. Load `plugin/plugin.json` in the uTools developer tools to run locally.
- `npm test` runs all `test/*.test.js` files with Node’s test runner.
- `npm run build` creates a production build in `plugin/`.
- `npm run check` runs tests and then the production build; run it before opening a pull request.

## Coding Style & Naming Conventions

Use ES modules, two-space indentation in JavaScript and CSS, semicolons, and double quotes in JavaScript, following nearby code. Name files with lowercase kebab case and functions and variables with camelCase. Keep exported helpers small and place feature-specific logic in its corresponding module. The editor formats JSON content with four-space indentation; do not confuse that output setting with source-code indentation. No formatter or linter is currently configured.

## Testing Guidelines

Tests use `node:test` and `node:assert/strict`. Add or update a `*.test.js` file for behavior changes, with descriptive `test("...", ...)` names. Cover valid input, malformed input, and text-preservation cases where relevant, especially for JSON transformations. There is no configured coverage threshold.

## Commit & Pull Request Guidelines

This repository has no commits yet, so no commit-message convention is established. Use short, imperative subjects that describe the change. Pull requests should explain the user-visible behavior, list verification commands, link a related issue when one exists, and include screenshots for interface changes. Do not commit generated `plugin/` output.

## Agent Notes

When `.codegraph/` exists, use CodeGraph to locate and understand code before text searches or file reads. Do not create an index when it is absent.
