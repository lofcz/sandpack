import * as fs from "fs";
import * as path from "path";

/**
 * The greppable half of the G1/T1 invariant (UI_AS_APPS_SPEC §2 — "The layering
 * model & the hard boundary"; §6.2 in the pre-2026-06 numbering): every app
 * iframe must be born in `iframe-factory.ts` so it is guaranteed opaque-origin.
 * `assertOpaqueOrigin` enforces this at runtime; this test enforces it
 * statically, so a new client that hand-rolls `document.createElement("iframe")`
 * fails CI until it routes through the factory (or is explicitly, justifiably
 * added to the exemption below).
 *
 * Exempt:
 *  - `iframe-factory.ts` — the one allowed creation site.
 *  - `node/index.ts`     — the nodebox/emulator client is a different execution
 *                          model that may require same-origin; intentionally not
 *                          routed through the opaque-origin factory.
 */
const EXEMPT = new Set(["iframe-factory.ts", path.join("node", "index.ts")]);

// Matches a real `…createElement("iframe")` / `'iframe'` call.
const RAW_IFRAME = /\.createElement\(\s*['"]iframe['"]\s*\)/;

/** A line that is purely a comment shouldn't count (doc strings mention the
 *  forbidden pattern by name). */
function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".d.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

describe("no raw app iframe outside the factory (G1/T1 greppable check)", () => {
  const clientsDir = __dirname;
  const files = listSourceFiles(clientsDir);

  it("finds the client source tree (guards against a broken scan path)", () => {
    // Sanity: the scan must actually see the runtime + static clients, else a
    // path regression would make the whole check vacuously pass.
    const rels = files.map((f) => path.relative(clientsDir, f));
    expect(rels).toEqual(
      expect.arrayContaining([
        "iframe-factory.ts",
        path.join("runtime", "index.ts"),
        path.join("static", "index.ts"),
      ]),
    );
  });

  it("only the factory and the exempt nodebox client create raw iframes", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(clientsDir, file);
      if (EXEMPT.has(rel)) continue;
      const lines = fs.readFileSync(file, "utf-8").split("\n");
      lines.forEach((line, i) => {
        if (!isCommentLine(line) && RAW_IFRAME.test(line)) {
          offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
