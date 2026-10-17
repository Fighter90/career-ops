// Prints a new disposable, fictional data root for inbox-undo.browser.test.mjs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-inbox-undo-"));
fs.mkdirSync(path.join(root, "data"));
fs.writeFileSync(path.join(root, ".inbox-undo-fixture"), "fictional-only\n");
fs.writeFileSync(path.join(root, "data/pipeline.md"), `# Fictional inbox

## Pending
- [ ] https://example.com/fixture-alpha | Fixture Alpha | Engineer | Toronto
- [ ] https://example.com/fixture-beta | Fixture Beta | Designer | Montreal
`);
// The existing endpoint loads this dependency from the data root. Copy only
// the self-contained core lock, never a user's configuration or tracker.
fs.copyFileSync(fileURLToPath(new URL("../../../pipeline-lock.mjs", import.meta.url)), path.join(root, "pipeline-lock.mjs"));
fs.writeFileSync(path.join(root, "cv.md"), "# Fictional browser fixture\n\nNot a real candidate.\n");
console.log(root);
