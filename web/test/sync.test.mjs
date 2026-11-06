// Port of VaultKit SyncTests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sync, MemoryRemote, MANIFEST_PATH } from "../js/core/sync.js";
import { utf8, fromUtf8, folderPath } from "../js/core/files.js";

function setup() {
  let n = 0;
  const env = {
    snap: {
      folders: [{ id: "p", name: "Horror Game", parentId: null }, { id: "s", name: "Scripts", parentId: "p" }],
      items: [
        { id: "e", kind: "script", title: "Enemy", content: "class Enemy {}\n", folderId: "s", status: "experimental", createdAt: 1, modifiedAt: 1, summary: "", category: "", tags: [], isFavorite: false, unityVersion: "", components: [], dependencies: [], projectName: "" },
        { id: "i", kind: "note", title: "Idea", content: "Spider legs", tags: ["idea"], folderId: "p", createdAt: 2, modifiedAt: 2, summary: "", category: "", isFavorite: false, status: "" },
      ],
    },
    remote: new MemoryRemote(),
    synced: null,
    newId: () => `new-${++n}`,
  };
  env.folderFor = (p) => {
    let parent = null;
    for (const name of p) {
      let f = env.snap.folders.find((x) => x.name === name && x.parentId === parent);
      if (!f) { f = { id: env.newId(), name, parentId: parent }; env.snap.folders.push(f); }
      parent = f.id;
    }
    return parent;
  };
  env.run = async () => {
    const out = await sync(env.remote, env.snap, env.synced, { newId: env.newId });
    for (const u of out.updated) { const k = env.snap.items.findIndex((x) => x.id === u.id); env.snap.items[k] = u; }
    for (const c of out.created) env.snap.items.push({ ...c.item, folderId: env.folderFor(c.folderPath) });
    for (const m of out.moved) { const it = env.snap.items.find((x) => x.id === m.itemId); it.folderId = env.folderFor(m.folderPath); if (m.title) it.title = m.title; }
    env.snap.items = env.snap.items.filter((x) => !out.trashed.includes(x.id));
    env.synced = new Set(Object.keys(out.manifest.entries));
    return out;
  };
  return env;
}
const files = (r) => [...r.files.keys()].filter((k) => k !== MANIFEST_PATH).sort();

test("initial push & idempotence", async () => {
  const e = setup();
  const o = await e.run();
  assert.deepEqual(files(e.remote), ["Horror Game/Idea.md", "Horror Game/Scripts/Enemy.cs"]);
  assert.equal(fromUtf8(e.remote.files.get("Horror Game/Scripts/Enemy.cs")), "class Enemy {}\n");
  assert.equal(o.pushed.length, 2);
  const o2 = await e.run();
  assert.equal(o2.pushed.length + o2.updated.length + o2.created.length, 0);
});

test("pull keeps metadata; conflict keeps both", async () => {
  const e = setup();
  await e.run();
  e.remote.files.set("Horror Game/Scripts/Enemy.cs", utf8("class Enemy { int hp; }\n"));
  const o = await e.run();
  assert.equal(o.updated.length, 1);
  const en = e.snap.items.find((x) => x.title === "Enemy");
  assert.equal(en.content, "class Enemy { int hp; }\n");
  assert.equal(en.status, "experimental");
  assert.equal((await e.run()).pushed.length, 0);
  e.remote.files.set("Horror Game/Scripts/Enemy.cs", utf8("PC\n"));
  en.content = "PHONE\n";
  const c = await e.run();
  assert.equal(c.conflicts.length, 1);
  assert.equal(fromUtf8(e.remote.files.get("Horror Game/Scripts/Enemy.cs")), "PHONE\n");
  assert.ok(e.snap.items.some((x) => x.content === "PC\n"));
  await e.run();
  assert.ok([...e.remote.files.values()].some((d) => fromUtf8(d) === "PC\n"));
});

test("new remote files, deletes, renames, moves", async () => {
  const e = setup();
  await e.run();
  e.remote.files.set("Monster Game/Combat System/Damage.cs", utf8("class Damage {}"));
  e.remote.files.set("Monster Game/readme.png", new Uint8Array([1, 2]));
  const o = await e.run();
  assert.equal(o.created.length, 1);
  const dmg = e.snap.items.find((x) => x.title === "Damage");
  assert.deepEqual(folderPath(e.snap.folders, dmg.folderId), ["Monster Game", "Combat System"]);
  assert.equal((await e.run()).created.length, 0);
  e.remote.files.delete("Horror Game/Idea.md");
  assert.equal((await e.run()).trashed.length, 1);
  e.snap.folders.find((f) => f.id === "s").name = "Gameplay";
  await e.run();
  assert.ok(e.remote.files.has("Horror Game/Gameplay/Enemy.cs"));
  const data = e.remote.files.get("Horror Game/Gameplay/Enemy.cs");
  e.remote.files.delete("Horror Game/Gameplay/Enemy.cs");
  e.remote.files.set("Horror Game/AI/Enemy.cs", data);
  const mv = await e.run();
  assert.equal(mv.moved.length, 1);
  assert.deepEqual(folderPath(e.snap.folders, e.snap.items.find((x) => x.title === "Enemy").folderId), ["Horror Game", "AI"]);
  e.snap.items = e.snap.items.filter((x) => x.title !== "Enemy");
  const d = await e.run();
  assert.deepEqual(d.deletedRemote, ["Horror Game/AI/Enemy.cs"]);
});

test("fresh install restores instead of deleting", async () => {
  const e = setup();
  await e.run();
  const before = files(e.remote);
  e.snap = { folders: [], items: [] };
  e.synced = null;
  const o = await e.run();
  assert.deepEqual(o.deletedRemote, []);
  assert.deepEqual(files(e.remote), before);
  assert.equal(e.snap.items.length, 2);
  const en = e.snap.items.find((x) => x.title === "Enemy");
  assert.equal(en.status, "experimental");
  assert.equal(en.id, "e");
  assert.deepEqual(folderPath(e.snap.folders, en.folderId), ["Horror Game", "Scripts"]);
});
