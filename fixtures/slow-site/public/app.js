function insertLateBanner() {
  const note = document.createElement("div");
  note.id = "late-note";
  note.textContent = "Free shipping ends tonight";
  note.style.cssText =
    "background:#ffb703;padding:24px;font-size:22px;margin:0 0 16px;";
  const main = document.querySelector("main");
  if (main) main.insertBefore(note, main.firstChild);
}

setTimeout(insertLateBanner, 1200);

const catalog = document.getElementById("catalog");
if (catalog) {
  for (let index = 0; index < 20; index++) {
    const card = document.createElement("div");
    card.className = "card";
    card.textContent = `Product ${index + 1}`;
    catalog.appendChild(card);
  }
}

const buy = document.getElementById("buy");
if (buy) {
  buy.addEventListener("click", () => {
    const start = performance.now();
    while (performance.now() - start < 120) {
      // slow click handler to create INP work
    }
    buy.textContent = "Added";
  });
}
