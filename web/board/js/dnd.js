// Organizator – drag & drop for cards and lists with pointer events.
// Mouse: drag after moving 5 px. Touch: press and hold (~250 ms), then drag; a quick swipe still scrolls.

const NO_DRAG = "input, textarea, select, a, .composer, .card-done, .list-menu-btn, [contenteditable]";

export function attachDnd(listsEl, { onCardDrop, onListDrop, onStart, onEnd }) {
  let pending = null;
  let drag = null;
  let suppressClickUntil = 0;

  // While dragging, a touch must not scroll the page (needs a non-passive listener registered up front).
  listsEl.addEventListener("touchmove", (e) => { if (drag) e.preventDefault(); }, { passive: false });
  listsEl.addEventListener("contextmenu", (e) => { if (pending || drag) e.preventDefault(); });
  listsEl.addEventListener("click", (e) => {
    if (Date.now() < suppressClickUntil) { e.stopPropagation(); e.preventDefault(); }
  }, true);

  listsEl.addEventListener("pointerdown", (e) => {
    if (drag || pending || (e.pointerType === "mouse" && e.button !== 0)) return;
    if (e.target.closest(NO_DRAG)) return;
    const card = e.target.closest(".card");
    const head = !card && e.target.closest(".list-head");
    if (!card && !head) return;
    if (head && head.querySelector("input")) return; // title is being edited
    pending = {
      type: card ? "card" : "list",
      src: card || head.closest(".list"),
      x: e.clientX,
      y: e.clientY,
      id: e.pointerId,
      touch: e.pointerType !== "mouse",
    };
    if (pending.touch) pending.timer = setTimeout(() => begin(pending.x, pending.y), 260);
    addEventListener("pointermove", onMove, { passive: false });
    addEventListener("pointerup", onUp);
    addEventListener("pointercancel", onCancel);
  });

  function stopListening() {
    removeEventListener("pointermove", onMove);
    removeEventListener("pointerup", onUp);
    removeEventListener("pointercancel", onCancel);
  }

  function onMove(e) {
    if (pending && e.pointerId === pending.id && !drag) {
      const dist = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
      if (pending.touch) {
        if (dist > 10) cancelPending();
      } else if (dist > 5) {
        begin(e.clientX, e.clientY);
      }
      return;
    }
    if (drag && e.pointerId === drag.id) {
      e.preventDefault();
      drag.x = e.clientX;
      drag.y = e.clientY;
      moveGhost();
      place();
    }
  }

  function onUp(e) {
    if (drag && e.pointerId === drag.id) return drop();
    cancelPending();
  }

  function onCancel() {
    if (drag) return abort();
    cancelPending();
  }

  function cancelPending() {
    if (pending) clearTimeout(pending.timer);
    pending = null;
    if (!drag) stopListening();
  }

  function begin(x, y) {
    if (!pending) return;
    const { type, src, id } = pending;
    clearTimeout(pending.timer);
    pending = null;
    const rect = src.getBoundingClientRect();
    const ghost = src.cloneNode(true);
    ghost.classList.add("drag-ghost", type === "list" ? "list-ghost" : "card-ghost");
    ghost.removeAttribute("data-card");
    ghost.removeAttribute("data-list");
    Object.assign(ghost.style, { width: rect.width + "px", height: rect.height + "px" });
    (listsEl.parentElement ?? document.body).append(ghost); // inherits the board's colour variables
    const ph = document.createElement("div");
    ph.className = type === "card" ? "card-ph" : "list-ph";
    ph.style.height = rect.height + "px";
    if (type === "list") ph.style.width = rect.width + "px";
    src.before(ph);
    src.classList.add("drag-src");
    drag = { type, src, ghost, ph, id, x, y, dx: x - rect.left, dy: y - rect.top, raf: 0, cards: null };
    document.body.classList.add("dragging");
    listsEl.classList.add("dragging");
    navigator.vibrate?.(8);
    getSelection?.()?.removeAllRanges?.();
    onStart?.();
    moveGhost();
    drag.raf = requestAnimationFrame(autoScroll);
  }

  function moveGhost() {
    const { ghost, x, y, dx, dy, type } = drag;
    ghost.style.transform = `translate3d(${x - dx}px, ${y - dy}px, 0) rotate(${type === "card" ? 2.5 : 1.5}deg)`;
  }

  function place() {
    if (drag.type === "card") placeCard(); else placeList();
  }

  function placeCard() {
    const { x, y, ph, src } = drag;
    let target = null, best = Infinity;
    for (const l of listsEl.querySelectorAll(":scope > .list")) {
      if (l === src) continue;
      const r = l.getBoundingClientRect();
      const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      if (d < best) { best = d; target = l; }
    }
    if (!target) return;
    const cards = target.querySelector(".cards");
    drag.cards = cards;
    let before = null;
    for (const c of cards.children) {
      if (c === src || c === ph || !c.classList.contains("card") || c.hidden) continue;
      const r = c.getBoundingClientRect();
      if (y < r.top + r.height / 2) { before = c; break; }
    }
    if (before) {
      if (ph.nextElementSibling !== before) cards.insertBefore(ph, before);
    } else if (ph.parentNode !== cards || ph.nextElementSibling) {
      cards.append(ph);
    }
  }

  function placeList() {
    const { x, ph, src } = drag;
    let before = null;
    for (const l of listsEl.querySelectorAll(":scope > .list")) {
      if (l === src) continue;
      const r = l.getBoundingClientRect();
      if (x < r.left + r.width / 2) { before = l; break; }
    }
    const ref = before ?? listsEl.querySelector(":scope > .add-list");
    if (ph.nextElementSibling !== ref) listsEl.insertBefore(ph, ref);
  }

  function autoScroll() {
    if (!drag) return;
    const speed = (d) => Math.min(22, Math.ceil(d / 3));
    const edge = 64;
    const r = listsEl.getBoundingClientRect();
    let moved = false;
    if (drag.x < r.left + edge) { listsEl.scrollLeft -= speed(r.left + edge - drag.x); moved = true; }
    else if (drag.x > r.right - edge) { listsEl.scrollLeft += speed(drag.x - (r.right - edge)); moved = true; }
    if (drag.type === "card" && drag.cards) {
      const c = drag.cards.getBoundingClientRect();
      const e2 = Math.min(56, c.height / 4);
      if (drag.y < c.top + e2 && drag.cards.scrollTop > 0) { drag.cards.scrollTop -= speed(c.top + e2 - drag.y); moved = true; }
      else if (drag.y > c.bottom - e2) { drag.cards.scrollTop += speed(drag.y - (c.bottom - e2)); moved = true; }
    }
    if (moved) place();
    drag.raf = requestAnimationFrame(autoScroll);
  }

  function finish() {
    const d = drag;
    cancelAnimationFrame(d.raf);
    d.ghost.remove();
    d.src.classList.remove("drag-src");
    document.body.classList.remove("dragging");
    listsEl.classList.remove("dragging");
    drag = null;
    stopListening();
    suppressClickUntil = Date.now() + 350;
    return d;
  }

  function drop() {
    const d = drag;
    let result = null;
    if (d.type === "card" && d.ph.parentNode?.dataset.cards) {
      let next = d.ph.nextElementSibling;
      while (next && (next === d.src || !next.classList.contains("card"))) next = next.nextElementSibling;
      result = { cardId: d.src.dataset.card, listId: d.ph.parentNode.dataset.cards, beforeId: next?.dataset.card ?? null };
    } else if (d.type === "list") {
      let next = d.ph.nextElementSibling;
      while (next && (next === d.src || !next.classList.contains("list"))) next = next.nextElementSibling;
      result = { listId: d.src.dataset.list, beforeId: next?.dataset.list ?? null };
    }
    d.ph.remove();
    finish();
    if (result?.cardId) onCardDrop(result.cardId, result.listId, result.beforeId);
    else if (result?.listId) onListDrop(result.listId, result.beforeId);
    onEnd?.();
  }

  function abort() {
    drag.ph.remove();
    finish();
    onEnd?.();
  }

  return {
    get active() { return !!drag; },
    cancel() { if (drag) abort(); cancelPending(); },
  };
}
