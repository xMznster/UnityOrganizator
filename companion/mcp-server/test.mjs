// Tests for the MCP server: run with `node --test companion/mcp-server/test.mjs`
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer, parseFrontMatter, outline, slug } from "./server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function makeVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"));
  const w = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  w("Horror Game/Scripts/Enemy AI/SpiderLegAnimator.cs", `using UnityEngine;

public class SpiderLegAnimator : MonoBehaviour
{
    [SerializeField] private Transform[] legTargets;

    private void Update()
    {
        if (Physics.Raycast(transform.position, Vector3.down, out RaycastHit hit)) { }
    }

    public void Step(int leg) { }
}
`);
  w("Horror Game/Ideas/Spinnen.md", `---
title: "Spinnen-Gegner"
kind: note
tags: ["idea", "spider"]
summary: "Prozedurale Beine"
---

Leg Animation mit IK.`);
  w("Horror Game/Prompts/Refactor Prompt.md", `---
title: "Refactor MonoBehaviour"
kind: prompt
---

Refactor this MonoBehaviour into smaller components.`);
  w(".vault/manifest.json", JSON.stringify({ entries: { "A": { path: "Horror Game/Scripts/Enemy AI/SpiderLegAnimator.cs", remoteBlob: "x", appBlob: "x", kind: "script", meta: { status: "tested", summary: "IK legs", tags: ["ik"] } } } }));
  w("INDEX.md", "# index");
  return dir;
}

test("front matter parsing", () => {
  const { meta, body } = parseFrontMatter('---\ntitle: "A \\"q\\""\ntags: ["x", "y"]\n---\n\nHello');
  assert.equal(meta.title, 'A "q"');
  assert.deepEqual(meta.tags, ["x", "y"]);
  assert.equal(body, "Hello");
});

test("search finds scripts, notes and prompts across camelCase", () => {
  const s = createServer(makeVault(), { reload: false });
  const out = s.callTool("vault_search", { query: "spider leg animation" }).content[0].text;
  assert.match(out, /SpiderLegAnimator\.cs/);
  assert.match(out, /Spinnen\.md/);
  const scripts = s.callTool("vault_search", { query: "spider", kind: "script" }).content[0].text;
  assert.doesNotMatch(scripts, /Spinnen\.md/);
});

test("get returns exact source with manifest metadata", () => {
  const dir = makeVault();
  const s = createServer(dir, { reload: false });
  const out = s.callTool("vault_get", { path: "Horror Game/Scripts/Enemy AI/SpiderLegAnimator.cs" }).content[0].text;
  assert.match(out, /status: tested/);
  assert.ok(out.includes(fs.readFileSync(path.join(dir, "Horror Game/Scripts/Enemy AI/SpiderLegAnimator.cs"), "utf8")));
});

test("tree, list and outline", () => {
  const s = createServer(makeVault(), { reload: false });
  assert.match(s.callTool("vault_project_tree").content[0].text, /Horror Game\/ \(3\)/);
  assert.match(s.callTool("vault_list", { folder: "Horror Game/Scripts" }).content[0].text, /SpiderLegAnimator/);
  const o = outline(s.vault.items.find((i) => i.kind === "script").content);
  assert.deepEqual(o.map((e) => e.name), ["SpiderLegAnimator", "Update", "Step"]);
});

test("prompts are exposed as MCP prompts", () => {
  const s = createServer(makeVault(), { reload: false });
  const list = s.handle({ jsonrpc: "2.0", id: 1, method: "prompts/list" }).result.prompts;
  assert.equal(list.length, 1);
  assert.equal(list[0].name, slug("Refactor MonoBehaviour"));
  const got = s.handle({ jsonrpc: "2.0", id: 2, method: "prompts/get", params: { name: list[0].name, arguments: { context: "Player.cs" } } }).result;
  assert.match(got.messages[0].content.text, /smaller components\.\n\nPlayer\.cs$/);
});

test("stdio protocol round trip", async () => {
  const dir = makeVault();
  const child = spawn(process.execPath, [path.join(here, "server.mjs"), dir], { stdio: ["pipe", "pipe", "pipe"] });
  const responses = [];
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { responses.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); }
  });
  const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "vault_search", arguments: { query: "raycast" } } });
  send({ jsonrpc: "2.0", id: 4, method: "resources/list" });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), 5000);
    const iv = setInterval(() => { if (responses.length >= 4) { clearTimeout(t); clearInterval(iv); resolve(); } }, 20);
  });
  child.kill();
  assert.equal(responses[0].result.serverInfo.name, "unity-developer-vault");
  assert.equal(responses[1].result.tools.length, 5);
  assert.match(responses[2].result.content[0].text, /SpiderLegAnimator\.cs \(line 9\)/);
  assert.equal(responses[3].result.resources.length, 3);
});
