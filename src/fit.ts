/**
 * Long texts (German, ...) and small screens: controls must fit instead of being pushed out of the screen or clipped.
 * Same ideas as other apps use (iOS "shrink text to fit", segmented control -> pop-up menu when it is too wide):
 *  1. A row of segmented buttons (.group) that does not fit gets a smaller font (.tight), then tighter spacing (.dense), and as a last
 *     resort it is shown as a drop-down list (a <select> placed after it that drives the buttons).
 *  2. A single-line button whose text spills out of it gets a slightly smaller font (not below 78 % of the normal size).
 * Everything is measured on the real screen, so it works for every language, font and screen width; it runs again when the language,
 * the window size or the content changes.
 */
const GROUPS = ".group:not(.pair)";
const MIN_SCALE = 0.78;

const visible = (el: HTMLElement) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

function overflows(g: HTMLElement): boolean {
  const r = g.getBoundingClientRect();
  const pr = (g.parentElement ?? document.body).getBoundingClientRect();
  const limit = Math.min(window.innerWidth, pr.right) + 1;
  return g.scrollWidth > g.clientWidth + 1 || r.right > limit + 1 || r.left < -1;
}

function mirror(g: HTMLElement): HTMLSelectElement {
  let sel = g.nextElementSibling as HTMLSelectElement | null;
  if (!sel || !sel.classList.contains("seg-select")) {
    sel = document.createElement("select");
    sel.className = "seg-select";
    const owner = g;
    sel.addEventListener("change", () => (owner.querySelectorAll(":scope > button")[sel!.selectedIndex] as HTMLElement | undefined)?.click());
    g.after(sel);
  }
  const bs = Array.from(g.querySelectorAll<HTMLElement>(":scope > button"));
  const labels = bs.map((b) => (b.textContent ?? "").trim() || b.getAttribute("title") || "");
  if (sel.options.length !== labels.length || labels.some((l, i) => sel!.options[i].text !== l)) {
    sel.replaceChildren(...labels.map((l) => Object.assign(document.createElement("option"), { textContent: l })));
  }
  const on = bs.findIndex((b) => b.classList.contains("on"));
  if (on >= 0) sel.selectedIndex = on;
  return sel;
}

function fitGroup(g: HTMLElement) {
  g.classList.remove("tight", "dense", "as-select");
  if (!visible(g) || g.querySelectorAll(":scope > button").length < 2 || !overflows(g)) return;
  g.classList.add("tight");
  if (!overflows(g)) return;
  g.classList.add("dense");
  if (!overflows(g)) return;
  if (g.querySelectorAll(":scope > button").length >= 3 && g.querySelector(":scope > button:not(:has(svg:only-child))")) {
    g.classList.remove("tight", "dense");
    g.classList.add("as-select");
    mirror(g);
  }
}

function fitButton(b: HTMLElement) {
  if (b.dataset.fit) {
    b.style.fontSize = "";
    delete b.dataset.fit;
  }
  if (!visible(b) || b.scrollWidth <= b.clientWidth + 1 || getComputedStyle(b).whiteSpace !== "nowrap") return;
  const base = parseFloat(getComputedStyle(b).fontSize) || 16;
  for (let size = base - 0.5; size >= base * MIN_SCALE; size -= 0.5) {
    b.style.fontSize = `${size}px`;
    b.dataset.fit = "1";
    if (b.scrollWidth <= b.clientWidth + 1) return;
  }
}

export function startFitting() {
  let frame = 0;
  const run = () => {
    frame = 0;
    observer.disconnect(); // what we change here must not trigger us again
    for (const g of Array.from(document.querySelectorAll<HTMLElement>(GROUPS))) fitGroup(g);
    for (const b of Array.from(document.querySelectorAll<HTMLElement>("button"))) if (!b.closest("svg, .pdfwrap, .scorewrap")) fitButton(b);
    // keep a drop-down in step with the buttons it stands for
    for (const g of Array.from(document.querySelectorAll<HTMLElement>(".group.as-select"))) mirror(g);
    observe();
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(run);
  };
  const observer = new MutationObserver(schedule);
  const observe = () => observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["hidden", "class"] });
  observe();
  window.addEventListener("resize", schedule);
  window.addEventListener("orientationchange", schedule);
  window.addEventListener("pianist-lang", schedule);
  void document.fonts?.ready.then(schedule);
  schedule();
}
