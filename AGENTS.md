# Instructions for coding agents

Read `docs/BUILD-GUIDE.md` first and follow it exactly, then the documents it lists, in order.
(The root `README.md` is the project's README for graders, not the build guide.) In short:

- The frontend (`app/public/`, `app/shared/`) and the tests (`tests/`) are finished. **Never edit
  them.** The frontend files are added from the frontend zip, unchanged, by the task that owns them
  (table in `docs/BUILD-GUIDE.md`, "The frontend files: who adds what"); commit only your task's. Don't overwrite the repo's `README.md` or `.gitignore`.
- The backend code files already exist as **stubs** (`auth/src/server.js`, `app/src/*.js`) with
  `// TODO (task #N)` markers. Fill in the TODOs for your task only; keep every file, export,
  class and method name; remove the placeholder code a TODO replaces.
- Build the backend exactly as specified: the same files, names, routes, message formats,
  constants and algorithms. Do not add, rename, simplify or "improve" anything, and do not add
  dependencies beyond the ones listed in `docs/DEPLOY.md`.
- Where a document gives pseudocode, implement that algorithm with those constants.
- If something seems ambiguous, read the client code in `app/public/js/` to see what it expects,
  and choose the reading that matches the frontend. Don't invent new behaviour.
- Done = `docker compose up --build` works on a fresh clone and `cd tests && npm install && node e2e.js`
  ends with `all passed`.
