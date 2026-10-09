// History panel (one row per undo step; click to jump back or forward) and the
// drag handle between the editor's tool panel and History. Adapted from
// Photocairn's history.js.

/**
 * steps() -> [{ label, sub?, state: "past" | "current" | "future" }], oldest first.
 * goTo(i) jumps to step i.
 */
export function historyPanel(steps, goTo) {
  const el = document.createElement("div");
  el.className = "history-panel";
  el.innerHTML = '<div class="dock-head"><h2>History</h2></div><ol class="history" aria-label="History, oldest first"></ol>';
  const list = el.querySelector("ol");
  let shown = "";
  list.addEventListener("click", (e) => { const b = e.target.closest("button[data-i]"); if (b) goTo(+b.dataset.i); });

  function render() {
    const s = steps(), sig = JSON.stringify(s);
    if (sig === shown) return;
    shown = sig;
    list.replaceChildren(...s.map((it, i) => {
      const li = document.createElement("li"), b = document.createElement("button");
      b.type = "button"; b.dataset.i = i; b.className = `hrow ${it.state}`;
      if (it.state === "current") b.setAttribute("aria-current", "step");
      b.title = it.state === "current" ? "Current state" : it.state === "past" ? "Go back to this step" : "Redo up to this step";
      const l = document.createElement("span"); l.className = "hlabel"; l.textContent = it.label; b.append(l);
      if (it.sub) { const sub = document.createElement("span"); sub.className = "hsub"; sub.textContent = it.sub; b.append(sub); }
      li.append(b); return li;
    }));
    reveal();
  }
  // Keep the current step in view without scrolling the page.
  function reveal() {
    const cur = list.querySelector(".current");
    if (!cur || !list.clientHeight) return;
    const top = cur.offsetTop - list.offsetTop, bottom = top + cur.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }
  new ResizeObserver(reveal).observe(list);
  return { el, render };
}

const STORE = "fc-side-sizes";

/**
 * A drag handle between two stacked sections: `top` takes the remaining
 * space, `bottom` gets a saved pixel height. Double-click resets it; arrow
 * keys move it. Minimum heights come from the sections' CSS min-height.
 */
export function splitter(top, bottom, names = ["Tool options", "History"]) {
  const handle = document.createElement("div");
  handle.className = "split"; handle.tabIndex = 0;
  handle.setAttribute("role", "separator"); handle.setAttribute("aria-orientation", "horizontal");
  handle.setAttribute("aria-label", `Resize ${names[0]} and ${names[1]}`);
  handle.title = "Drag to resize, double-click to reset";
  let size = +(localStorage.getItem(STORE) || 0);
  const minOf = (el) => parseFloat(getComputedStyle(el).minHeight) || 0;
  const apply = () => { bottom.style.height = size ? `${size}px` : ""; describe(); };
  const describe = () => requestAnimationFrame(() => {
    const a = top.getBoundingClientRect().height, b = bottom.getBoundingClientRect().height;
    if (a + b) handle.setAttribute("aria-valuenow", Math.round((a / (a + b)) * 100));
  });
  const set = (h) => {
    const total = top.getBoundingClientRect().height + bottom.getBoundingClientRect().height;
    size = Math.round(Math.max(minOf(bottom), Math.min(h, total - minOf(top))));
    localStorage.setItem(STORE, size); apply();
  };
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault(); handle.setPointerCapture(e.pointerId); handle.classList.add("dragging");
    const y0 = e.clientY, h0 = bottom.getBoundingClientRect().height;
    const move = (ev) => set(h0 - (ev.clientY - y0));
    const up = () => { handle.classList.remove("dragging"); handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", up); handle.removeEventListener("pointercancel", up); };
    handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", up); handle.addEventListener("pointercancel", up);
  });
  handle.addEventListener("dblclick", () => { size = 0; localStorage.removeItem(STORE); apply(); });
  handle.addEventListener("keydown", (e) => {
    const d = { ArrowUp: 16, ArrowDown: -16 }[e.key];
    if (!d) return;
    e.preventDefault(); e.stopPropagation(); set(bottom.getBoundingClientRect().height + d);
  });
  apply();
  return handle;
}
