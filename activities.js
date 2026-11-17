// Registrul activităților. O activitate nouă = o intrare nouă aici (hub-ul trainerului o arată singur ca placă).

const ICONS = {
  cards: '<rect x="4" y="7" width="11" height="14" rx="2"/><path d="M9 4h9a2 2 0 012 2v11"/>',
  chat: '<path d="M4 5h11a1 1 0 011 1v6a1 1 0 01-1 1H9l-4 3v-3H4a1 1 0 01-1-1V6a1 1 0 011-1z"/><path d="M19 9h1a1 1 0 011 1v6a1 1 0 01-1 1h-1v3l-3-3h-4"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.8"/>',
  puzzle: '<path d="M10 4a2 2 0 114 0v1h4a1 1 0 011 1v4h-1a2 2 0 100 4h1v4a1 1 0 01-1 1h-4v-1a2 2 0 10-4 0v1H6a1 1 0 01-1-1v-4h1a2 2 0 100-4H5V6a1 1 0 011-1h4V4z"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  play: '<path d="M8 5v14l11-7z"/>',
};

// pictogramă SVG (linii), pentru plăcile generate din registru
export const icon = (name, size = 24) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;

// Activitățile pe care trainerul le lansează (hub-ul trainerului, trainer.html).
export const ACTIVITIES = [
  {
    id: "cards",
    title: "Jocuri cu cărți",
    chips: ["Standard", "Selecție", "Colourblind"],
    text: "Sesiuni pe grupe, cu cărți de discuție și cronometru.",
    href: "admin.html",
    icon: "cards",
    badge: "Cărți",
  },
  {
    id: "communication",
    title: "Jocuri de comunicare",
    chips: ["Desenează după instrucțiuni", "Reconstruiește modelul", "Ce ai înțeles?"],
    text: "Exerciții de comunicare, pe telefoanele participanților.",
    href: "communication-admin.html",
    icon: "chat",
    badge: "Comunicare",
  },
  {
    id: "recap",
    title: "Recapitulare",
    chips: ["Două echipe"],
    text: "După orice activitate, echipele își aruncă întrebări.",
    href: "recap-admin.html",
    icon: "target",
    badge: "Recapitulare",
  },
  {
    id: "puzzles",
    title: "Jocuri de gândire critică",
    chips: ["Connections", "Decision Lab"],
    text: "Administrezi categoriile și scenariile jocurilor individuale, fără cont, pe care participanții le joacă singuri.",
    href: "puzzle-admin.html",
    icon: "puzzle",
    badge: "Puzzle",
  },
];

// Jocuri individuale, fără cont (cardul „Jocuri de training” de pe pagina inițială).
// Gol până există astfel de jocuri în aplicație: cât timp e gol, cardul nu apare.
// O intrare: { id, name, text, href, icon }
export const PLAY_GAMES = [
  {
    id: "puzzles",
    name: "Jocuri de gândire critică",
    text: "Connections și Decision Lab: joci singur, fără cont.",
    href: "puzzles.html",
    icon: "puzzle",
  },
];

// Cum se numește activitatea găsită după cod (când un cod se potrivește cu mai multe)
export const CODE_LABELS = {
  cards: "Jocuri cu cărți (grupă)",
  colourblind: "Colourblind",
  communication: "Nodul comunicării",
  recap: "Recapitulare",
};
