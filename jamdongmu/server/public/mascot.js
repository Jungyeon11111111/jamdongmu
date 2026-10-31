// 잠동무 마스코트 "몽글이" — 수면모자를 쓴 몽글몽글한 마시멜로
// state: "awake"(눈 깜빡) | "sleepy"(졸린 눈) | "asleep"(잠듦 + zzz) | "happy"(웃는 눈 + 하트)
window.mongle = function mongle(state = "awake") {
  const eyes = {
    awake: `<g class="mg-eyes"><circle cx="48" cy="72" r="3.6"/><circle cx="72" cy="72" r="3.6"/>
              <circle cx="49.2" cy="70.8" r="1.1" fill="#fff"/><circle cx="73.2" cy="70.8" r="1.1" fill="#fff"/></g>`,
    sleepy: `<g class="mg-eyes-line"><path d="M43.5 72.5 q4.5 -3 9 0"/><path d="M67.5 72.5 q4.5 -3 9 0"/></g>`,
    asleep: `<g class="mg-eyes-line"><path d="M43.5 71 q4.5 4 9 0"/><path d="M67.5 71 q4.5 4 9 0"/></g>`,
    happy: `<g class="mg-eyes-line"><path d="M43.5 73 q4.5 -6 9 0"/><path d="M67.5 73 q4.5 -6 9 0"/></g>`,
  }[state] || "";
  const mouth = state === "asleep"
    ? `<ellipse cx="60" cy="81" rx="2.2" ry="2.6" class="mg-mouth-o"/>`
    : state === "happy"
      ? `<path d="M55 79 q5 6 10 0" class="mg-line"/>`
      : `<path d="M56.5 80 q1.75 2 3.5 0 q1.75 2 3.5 0" class="mg-line"/>`;
  const extra = state === "asleep"
    ? `<g class="mg-zzz"><text x="10" y="44">z</text><text x="2" y="30" style="font-size:9px">z</text></g>`
    : state === "happy"
      ? `<path class="mg-heart" d="M16 42 c-3 -4 -9 -1 -6 4 l6 6 l6 -6 c3 -5 -3 -8 -6 -4z"/>`
      : "";
  return `<svg class="mongle mg-${state}" viewBox="0 0 120 120" role="img" aria-label="몽글이">
    <ellipse cx="60" cy="108" rx="34" ry="5" class="mg-shadow"/>
    <g class="mg-body-g">
      <ellipse cx="23" cy="88" rx="7" ry="5.5" class="mg-body mg-arm" transform="rotate(-25 23 88)"/>
      <ellipse cx="97" cy="88" rx="7" ry="5.5" class="mg-body mg-arm" transform="rotate(25 97 88)"/>
      <path class="mg-body" d="M60 40 C86 40 98 58 98 78 C98 96 82 106 60 106 C38 106 22 96 22 78 C22 58 34 40 60 40Z"/>
      <ellipse cx="40" cy="80" rx="6" ry="3.6" class="mg-cheek"/>
      <ellipse cx="80" cy="80" rx="6" ry="3.6" class="mg-cheek"/>
      ${eyes}${mouth}
      <path class="mg-cap" d="M30 56 C30 32 52 20 74 24 C90 27 102 40 105 57 C100 54 94 53 89 55 C82 45 70 40 60 40 C46 40 34 46 30 56Z"/>
      <path class="mg-band" d="M29 58 C38 46 52 41 62 41 C74 41 84 45 90 51 L88 57 C82 51 72 48 61 48 C50 48 39 53 32 62Z"/>
      <circle cx="104" cy="58" r="6" class="mg-pom"/>
    </g>
    ${extra}
  </svg>`;
};
