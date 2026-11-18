// Animated illustrations for the Undercover locations: one small SVG scene per location (viewBox 120×80).
// Animations use SVG <animate>/<animateTransform>, which run on iOS and Android browsers without any library.
// Keys match the location names in locations.js.

const A = (attr, values, dur, extra = '') =>
  `<animate attributeName="${attr}" values="${values}" dur="${dur}" repeatCount="indefinite" ${extra}/>`;
const T = (type, values, dur, extra = '') =>
  `<animateTransform attributeName="transform" type="${type}" values="${values}" dur="${dur}" repeatCount="indefinite" ${extra}/>`;
const sky = (top, bottom, id) =>
  `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>` +
  `<rect width="120" height="80" fill="url(#${id})"/>`;
const steam = (x, y, color = '#fff') => [0, 1, 2].map(k =>
  `<path d="M${x + k * 5} ${y} q-3 -5 0 -10 q3 -5 0 -10" stroke="${color}" stroke-width="1.6" fill="none" stroke-linecap="round" opacity="0">` +
  A('opacity', '0;0.8;0', '2.4s', `begin="${k * 0.8}s"`) + T('translate', '0 0;0 -6', '2.4s', `begin="${k * 0.8}s"`) + '</path>').join('');

export const PICTURES = {
  Airport: sky('#7ec8f2', '#d9f0ff', 'sAir') +
    `<rect y="62" width="120" height="18" fill="#6b7a86"/>` +
    `<g fill="#fff" opacity=".8">${[8, 30, 52, 74, 96].map(x => `<rect x="${x}" y="70" width="12" height="2"/>`).join('')}</g>` +
    `<rect x="94" y="30" width="8" height="32" fill="#cfd8dc"/><rect x="89" y="22" width="18" height="10" rx="2" fill="#90a4ae"/><rect x="91" y="24" width="14" height="5" fill="#b3e5fc"/>` +
    `<g>${T('translate', '-50 18;140 -12', '5s')}<path d="M0 0 h34 q6 0 6 3 q0 3 -6 3 h-34 z" fill="#fff"/><path d="M12 3 l-6 9 h5 l10 -9 z M14 3 l-4 -8 h4 l8 8 z" fill="#e53935"/><path d="M0 0 l-4 -7 h5 l5 7 z" fill="#e53935"/>` +
    `<g fill="#4fc3f7">${[16, 20, 24, 28].map(x => `<rect x="${x}" y="1" width="2.4" height="2" rx=".5"/>`).join('')}</g></g>`,

  Bakery: sky('#ffe0b2', '#ffcc80', 'sBak') +
    `<rect x="10" y="20" width="100" height="60" fill="#8d6e63"/>` +
    `<path d="M8 20 h104 v8 q-6.5 6 -13 0 q-6.5 6 -13 0 q-6.5 6 -13 0 q-6.5 6 -13 0 q-6.5 6 -13 0 q-6.5 6 -13 0 q-6.5 6 -13 0 q-6.5 6 -13 0 z" fill="#ef5350"/>` +
    `<path d="M21 20 v8 M47 20 v8 M73 20 v8 M99 20 v8" stroke="#fff" stroke-width="6" opacity=".5"/>` +
    `<rect x="20" y="40" width="80" height="30" rx="3" fill="#fff3e0"/>` +
    `<ellipse cx="45" cy="60" rx="16" ry="7" fill="#d7a35b"/><path d="M36 57 l4 6 M44 56 l4 6 M52 57 l4 6" stroke="#a1662f" stroke-width="1.5"/>` +
    `<ellipse cx="78" cy="62" rx="9" ry="5" fill="#c68642"/><circle cx="78" cy="57" r="5" fill="#f8bbd0"/><circle cx="78" cy="52" r="1.6" fill="#e53935"/>` +
    steam(40, 50),

  'Bowling alley': sky('#311b92', '#4527a0', 'sBow') +
    `<path d="M40 30 h40 l30 50 h-100 z" fill="#d7a86e"/><path d="M48 30 l-20 50 M72 30 l20 50" stroke="#a1662f" stroke-width="1"/>` +
    `<g fill="#fff" stroke="#e53935" stroke-width=".8">${[[60, 30], [56, 27], [64, 27], [52, 24], [60, 24], [68, 24]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="2.2" ry="4"/>`).join('')}</g>` +
    `<g><circle r="7" fill="#1e88e5"><animate attributeName="cy" values="76;34;34" keyTimes="0;0.7;1" dur="2.6s" repeatCount="indefinite"/>` +
    `<animate attributeName="r" values="8;3.5;3.5" keyTimes="0;0.7;1" dur="2.6s" repeatCount="indefinite"/><animate attributeName="cx" values="60;60" dur="2.6s" repeatCount="indefinite"/></circle></g>` +
    `<g fill="#ffeb3b">${[15, 35, 85, 105].map((x, k) => `<circle cx="${x}" cy="10" r="2">${A('opacity', '1;.2;1', '1s', `begin="${k * 0.25}s"`)}</circle>`).join('')}</g>`,

  Campsite: sky('#0d1b3e', '#283e6b', 'sCamp') +
    `<g fill="#fff">${[[10, 8], [30, 14], [55, 6], [80, 12], [104, 7], [95, 22]].map(([x, y], k) => `<circle cx="${x}" cy="${y}" r="1">${A('opacity', '1;.2;1', '2s', `begin="${k * 0.3}s"`)}</circle>`).join('')}</g>` +
    `<circle cx="100" cy="16" r="6" fill="#fff9c4"/>` +
    `<path d="M0 60 l20 -18 l15 10 l18 -20 l22 22 l20 -12 l25 18 v20 h-120 z" fill="#1b3a2b"/><rect y="62" width="120" height="18" fill="#2e5d3a"/>` +
    `<path d="M14 66 l18 -26 l18 26 z" fill="#ff8f00"/><path d="M32 40 l-5 26 h10 z" fill="#e65100"/>` +
    `<path d="M70 70 l14 -4 M72 66 l12 4" stroke="#6d4c41" stroke-width="2.5" stroke-linecap="round"/>` +
    `<path d="M77 66 q-6 -8 0 -16 q6 8 0 16 z" fill="#ff7043">${T('scale', '1 1;1 1.15;1 .95;1 1', '.6s', 'additive="sum"')}</path>` +
    `<path d="M77 66 q-3 -5 0 -10 q3 5 0 10 z" fill="#ffeb3b">${A('opacity', '1;.6;1', '.4s')}</path>`,

  Cinema: sky('#1a1a1a', '#2b2b2b', 'sCin') +
    `<rect x="14" y="8" width="92" height="40" fill="#e0e0e0">${A('fill', '#e0e0e0;#fffde7;#cfd8dc;#e0e0e0', '1.2s')}</rect>` +
    `<path d="M14 8 h10 v40 h-10 z M96 8 h10 v40 h-10 z" fill="#b71c1c"/>` +
    `<path d="M60 4 L14 8 v40 L60 4 z M60 4 L106 8 v40 z" fill="#fff" opacity=".07"/>` +
    `<circle cx="38" cy="28" r="7" fill="#90a4ae"><animate attributeName="cx" values="30;90;30" dur="4s" repeatCount="indefinite"/></circle>` +
    `<g fill="#4a148c">${[0, 1, 2, 3, 4, 5].map(k => `<rect x="${6 + k * 19}" y="60" width="16" height="12" rx="3"/>`).join('')}</g>` +
    `<g fill="#111">${[14, 48, 82].map(x => `<circle cx="${x}" cy="58" r="5"/><rect x="${x - 6}" y="61" width="12" height="10" rx="3"/>`).join('')}</g>`,

  'Concert hall': sky('#3e2723', '#5d4037', 'sCon') +
    `<path d="M0 0 h18 q-4 40 0 80 h-18 z M120 0 h-18 q4 40 0 80 h18 z" fill="#c62828"/>` +
    `<rect y="62" width="120" height="18" fill="#8d6e63"/>` +
    `<path d="M60 0 L40 62 h40 z" fill="#fff59d" opacity=".25">${A('opacity', '.15;.35;.15', '3s')}</path>` +
    `<rect x="54" y="40" width="12" height="22" rx="2" fill="#212121"/><circle cx="60" cy="35" r="5" fill="#ffcc80"/>` +
    `<path d="M66 44 l10 -8" stroke="#212121" stroke-width="1.5">${T('rotate', '0 66 44;-15 66 44;0 66 44', '1s')}</path>` +
    `<g fill="#fff">${[[30, 'M0 0 v-8 h6 v3 h-4 v5'], [88, 'M0 0 v-8']].map(([x, d], k) =>
      `<g>${T('translate', `${x} 50;${x + (k ? 6 : -6)} 20`, '3s', `begin="${k * 1.5}s"`)}<circle r="2.5"/><path d="M2.3 0 v-9" stroke="#fff" stroke-width="1.2"/>${A('opacity', '1;0', '3s', `begin="${k * 1.5}s"`)}</g>`).join('')}</g>`,

  Ferry: sky('#81d4fa', '#e1f5fe', 'sFer') +
    `<circle cx="20" cy="16" r="7" fill="#fff176"/>` +
    `<g>${T('translate', '0 0;0 2;0 0', '3s')}` +
    `<path d="M24 50 h76 l-8 14 h-62 z" fill="#fafafa" stroke="#37474f" stroke-width="1"/><rect x="24" y="56" width="72" height="3" fill="#1565c0"/>` +
    `<rect x="38" y="36" width="44" height="14" fill="#eceff1" stroke="#37474f" stroke-width="1"/><g fill="#4fc3f7">${[42, 52, 62, 72].map(x => `<rect x="${x}" y="40" width="6" height="5"/>`).join('')}</g>` +
    `<rect x="64" y="26" width="7" height="10" fill="#e53935"/>${steam(65, 24, '#cfd8dc')}</g>` +
    `<path d="M-20 64 q7.5 -4 15 0 t15 0 t15 0 t15 0 t15 0 t15 0 t15 0 t15 0 t15 0 v16 h-140 z" fill="#0288d1">${T('translate', '0 0;15 0', '2s')}</path>` +
    `<path d="M-20 70 q7.5 -4 15 0 t15 0 t15 0 t15 0 t15 0 t15 0 t15 0 t15 0 t15 0 v10 h-140 z" fill="#01579b">${T('translate', '15 0;0 0', '2.5s')}</path>`,

  'Fire station': sky('#90caf9', '#e3f2fd', 'sFir') +
    `<rect x="10" y="18" width="100" height="62" fill="#b71c1c"/><path d="M6 20 l54 -14 l54 14 z" fill="#7f0000"/>` +
    `<rect x="44" y="22" width="32" height="7" fill="#fff"/><text x="60" y="27.5" font-size="5" text-anchor="middle" font-family="sans-serif" font-weight="700" fill="#b71c1c">FIRE</text>` +
    `<rect x="18" y="36" width="84" height="44" fill="#424242"/>` +
    `<g>${T('translate', '0 0;0 0;-2 0;0 0', '1.4s')}<rect x="26" y="54" width="62" height="18" rx="2" fill="#e53935"/><rect x="70" y="48" width="18" height="12" rx="2" fill="#e53935"/><rect x="74" y="50" width="11" height="6" fill="#b3e5fc"/>` +
    `<path d="M28 52 h40 M28 50 h40" stroke="#bdbdbd" stroke-width="1.2"/><circle cx="38" cy="74" r="5" fill="#212121"/><circle cx="78" cy="74" r="5" fill="#212121"/>` +
    `<rect x="74" y="45" width="6" height="3" rx="1" fill="#2196f3">${A('fill', '#2196f3;#f44336;#2196f3', '.6s')}</rect></g>`,

  'Football stadium': sky('#64b5f6', '#bbdefb', 'sFoo') +
    `<path d="M0 30 h120 v8 h-120 z" fill="#455a64"/><g fill="#ffca28">${Array.from({ length: 24 }, (_, k) => `<circle cx="${3 + k * 5}" cy="33" r="1.6">${A('cy', '33;31;33', '.8s', `begin="${(k % 4) * 0.2}s"`)}</circle>`).join('')}</g>` +
    `<rect y="38" width="120" height="42" fill="#43a047"/><g fill="#388e3c">${[0, 2, 4].map(k => `<rect x="${k * 24}" y="38" width="12" height="42"/>`).join('')}<rect x="120" y="38" width="0" height="0"/></g>` +
    `<path d="M88 46 h26 v22 h-26" fill="none" stroke="#fff" stroke-width="1.5"/><path d="M92 50 h22 v14 h-22 z" fill="#fff" opacity=".15"/>` +
    `<circle cx="60" cy="58" r="10" fill="none" stroke="#fff" stroke-width="1"/>` +
    `<g>${T('translate', '30 66;55 48;80 60;100 56;30 66', '3s')}<circle r="3.5" fill="#fff" stroke="#212121" stroke-width=".8"/><path d="M-1.5 -1 l1.5 -1.2 l1.5 1.2 l-.6 1.6 h-1.8 z" fill="#212121"/></g>`,

  Gym: sky('#eceff1', '#cfd8dc', 'sGym') +
    `<rect y="64" width="120" height="16" fill="#37474f"/><rect x="0" y="10" width="120" height="3" fill="#b0bec5"/>` +
    `<rect x="8" y="18" width="30" height="40" fill="#b3e5fc" stroke="#90a4ae"/><path d="M23 18 v40" stroke="#90a4ae"/>` +
    `<g>${T('translate', '0 0;0 -16;0 0', '1.6s')}` +
    `<rect x="40" y="34" width="56" height="3" rx="1.5" fill="#9e9e9e"/><rect x="38" y="26" width="7" height="19" rx="2" fill="#e53935"/><rect x="91" y="26" width="7" height="19" rx="2" fill="#e53935"/>` +
    `<rect x="32" y="29" width="5" height="13" rx="2" fill="#1e88e5"/><rect x="99" y="29" width="5" height="13" rx="2" fill="#1e88e5"/></g>` +
    `<rect x="54" y="58" width="28" height="6" rx="2" fill="#263238"/>`,

  'Hair salon': sky('#fce4ec', '#f8bbd0', 'sHai') +
    `<rect x="12" y="10" width="36" height="46" rx="18" fill="#e1f5fe" stroke="#f06292" stroke-width="2.5"/><path d="M22 20 l10 -6 M24 28 l16 -10" stroke="#fff" stroke-width="2"/>` +
    `<rect y="66" width="120" height="14" fill="#f48fb1"/><rect x="20" y="56" width="20" height="10" rx="3" fill="#ad1457"/>` +
    `<g transform="translate(84 40)"><circle cx="-10" cy="12" r="5" fill="none" stroke="#424242" stroke-width="2.5"/><circle cx="10" cy="12" r="5" fill="none" stroke="#424242" stroke-width="2.5"/>` +
    `<path d="M-7 8 L4 -18" stroke="#9e9e9e" stroke-width="3" stroke-linecap="round">${T('rotate', '0 0 4;12 0 4;0 0 4', '.8s')}</path>` +
    `<path d="M7 8 L-4 -18" stroke="#bdbdbd" stroke-width="3" stroke-linecap="round">${T('rotate', '0 0 4;-12 0 4;0 0 4', '.8s')}</path><circle cx="0" cy="4" r="1.6" fill="#424242"/></g>` +
    `<g fill="#6d4c41">${[0, 1, 2].map(k => `<path d="M${76 + k * 6} 50 q2 4 0 8" stroke="#6d4c41" stroke-width="1.4" fill="none" opacity="0">${A('opacity', '0;1;0', '1.6s', `begin="${k * 0.5}s"`)}${T('translate', '0 0;0 12', '1.6s', `begin="${k * 0.5}s"`)}</path>`).join('')}</g>`,

  Library: sky('#efebe9', '#d7ccc8', 'sLib') +
    `<rect x="6" y="6" width="108" height="68" fill="#6d4c41"/>` +
    [16, 38, 60].map((y, r) => `<rect x="10" y="${y + 18}" width="100" height="3" fill="#4e342e"/>` +
      Array.from({ length: 14 }, (_, k) => {
        const colors = ['#c62828', '#1565c0', '#2e7d32', '#f9a825', '#6a1b9a', '#00838f', '#ef6c00'];
        const h = 14 + ((k * 7 + r * 3) % 5);
        return `<rect x="${12 + k * 7}" y="${y + 18 - h}" width="6" height="${h}" fill="${colors[(k + r) % 7]}"/>`;
      }).join('')).join('') +
    `<g>${T('translate', '0 0;0 0;0 -8;0 -8;0 0', '3s')}<rect x="61" y="40" width="6" height="16" fill="#ffd54f" stroke="#ff8f00" stroke-width=".8"/></g>`,

  Lighthouse: sky('#1a237e', '#3949ab', 'sLig') +
    `<g opacity=".35">${T('rotate', '0 60 22;360 60 22', '4s')}<path d="M60 22 L130 8 L130 36 z" fill="#fff59d"/><path d="M60 22 L-10 8 L-10 36 z" fill="#fff59d"/></g>` +
    `<path d="M50 70 l4 -44 h12 l4 44 z" fill="#fafafa"/><path d="M52 50 h16 l-.8 -8 h-14.4 z M51 64 h18 l-.6 -6 h-16.8 z" fill="#e53935"/>` +
    `<rect x="53" y="18" width="14" height="8" fill="#fff59d">${A('fill', '#fff59d;#fffde7;#fff59d', '1s')}</rect><path d="M51 18 l9 -7 l9 7 z" fill="#c62828"/>` +
    `<path d="M30 72 q15 -8 30 -6 q20 2 40 6 v8 h-70 z" fill="#5d4037"/>` +
    `<path d="M-20 74 q7.5 -3 15 0 t15 0 t15 0 t15 0 t15 0 t15 0 t15 0 t15 0 t15 0 v6 h-140 z" fill="#1565c0">${T('translate', '0 0;15 0', '2s')}</path>`,

  'Mountain cabin': sky('#90caf9', '#e3f2fd', 'sMou') +
    `<path d="M0 50 l28 -34 l20 22 l22 -28 l30 36 l20 -14 v48 h-120 z" fill="#78909c"/><path d="M28 16 l-8 10 l8 -3 l8 4 z M70 10 l-9 11 l9 -4 l9 5 z" fill="#fff"/>` +
    `<rect y="58" width="120" height="22" fill="#fafafa"/>` +
    `<rect x="42" y="44" width="36" height="22" fill="#8d6e63"/><path d="M38 46 l22 -16 l22 16 z" fill="#5d4037"/><path d="M44 50 h32 M44 55 h32 M44 60 h32" stroke="#6d4c41" stroke-width=".8"/>` +
    `<rect x="54" y="52" width="9" height="8" fill="#ffe082">${A('fill', '#ffe082;#ffca28;#ffe082', '2s')}</rect><path d="M58.5 52 v8 M54 56 h9" stroke="#6d4c41" stroke-width="1"/>` +
    `<rect x="68" y="30" width="5" height="10" fill="#4e342e"/>${steam(68, 28, '#eceff1')}` +
    `<g fill="#fff">${[[10, 0], [30, 1.2], [90, .6], [105, 1.8], [20, 2.4], [80, 3]].map(([x, b]) => `<circle cx="${x}" r="1.3"><animate attributeName="cy" values="-4;84" dur="4s" begin="${b}s" repeatCount="indefinite"/></circle>`).join('')}</g>`,

  Museum: sky('#fff8e1', '#ffecb3', 'sMus') +
    `<path d="M14 26 l46 -18 l46 18 z" fill="#bdbdbd"/><rect x="14" y="26" width="92" height="5" fill="#9e9e9e"/>` +
    `<g fill="#e0e0e0">${[20, 40, 72, 92].map(x => `<rect x="${x}" y="31" width="8" height="37"/>`).join('')}</g>` +
    `<rect x="10" y="68" width="100" height="5" fill="#9e9e9e"/><rect x="6" y="73" width="108" height="7" fill="#757575"/>` +
    `<rect x="48" y="38" width="24" height="18" fill="#6d4c41"/><rect x="50.5" y="40.5" width="19" height="13" fill="#81d4fa"/><circle cx="56" cy="45" r="2.5" fill="#fff176"/><path d="M50.5 53.5 l7 -6 l5 4 l3 -2 l4 4 z" fill="#558b2f"/>` +
    `<path d="M60 8 v-6" stroke="#616161" stroke-width="1"/><path d="M60 2 h10 l-2 3 l2 3 h-10 z" fill="#e53935">${T('skewY', '0;8;0;-6;0', '1.5s')}</path>`,

  'Night club': sky('#120024', '#2a0045', 'sNig') +
    `<path d="M60 0 v10" stroke="#9e9e9e"/><circle cx="60" cy="18" r="9" fill="#cfd8dc"/>` +
    `<g>${T('translate', '0 0;3 0;0 0', '1s')}<g fill="#fff">${[[56, 14], [62, 12], [58, 20], [64, 18], [54, 22]].map(([x, y], k) => `<rect x="${x}" y="${y}" width="2.6" height="2.6">${A('opacity', '1;.2;1', '.8s', `begin="${k * 0.15}s"`)}</rect>`).join('')}</g></g>` +
    `<path d="M60 18 L20 80 h22 z" fill="#e040fb" opacity=".3">${A('opacity', '.1;.45;.1', '1.2s')}</path>` +
    `<path d="M60 18 L100 80 h-22 z" fill="#00e5ff" opacity=".3">${A('opacity', '.45;.1;.45', '1.2s')}</path>` +
    `<path d="M60 18 L50 80 h20 z" fill="#ffea00" opacity=".2">${A('opacity', '.1;.35;.1', '.8s')}</path>` +
    `<g fill="#000">${[22, 46, 74, 98].map((x, k) => `<g>${T('translate', '0 0;0 -3;0 0', '.5s', `begin="${k * 0.12}s"`)}<circle cx="${x}" cy="62" r="4"/><rect x="${x - 5}" y="66" width="10" height="14" rx="3"/></g>`).join('')}</g>`,

  Office: sky('#e8eaf6', '#c5cae9', 'sOff') +
    `<rect x="78" y="8" width="34" height="26" fill="#b3e5fc" stroke="#7986cb" stroke-width="2"/><path d="M95 8 v26 M78 21 h34" stroke="#7986cb" stroke-width="1.5"/>` +
    `<rect y="58" width="120" height="22" fill="#8d6e63"/><rect x="0" y="54" width="120" height="5" fill="#a1887f"/>` +
    `<rect x="26" y="20" width="44" height="30" rx="2" fill="#263238"/><rect x="29" y="23" width="38" height="24" fill="#1e88e5"/>` +
    `<g fill="#bbdefb">${[26, 31, 36].map((y, k) => `<rect x="32" y="${y}" width="${[24, 18, 28][k]}" height="2"/>`).join('')}</g>` +
    `<rect x="32" y="41" width="2" height="4" fill="#fff">${A('opacity', '1;1;0;0', '1s', 'calcMode="discrete"')}</rect>` +
    `<rect x="44" y="50" width="8" height="5" fill="#455a64"/><rect x="34" y="55" width="28" height="2" fill="#455a64"/>` +
    `<rect x="86" y="46" width="10" height="9" rx="1.5" fill="#fafafa"/><path d="M96 48 q4 0 4 3 q0 3 -4 3" stroke="#fafafa" stroke-width="1.5" fill="none"/>${steam(86, 44, '#9fa8da')}`,

  'Recording studio': sky('#263238', '#37474f', 'sRec') +
    `<g fill="#455a64">${Array.from({ length: 12 }, (_, k) => `<rect x="${k * 10 + 1}" y="2" width="8" height="8" rx="1"/>`).join('')}</g>` +
    `<path d="M34 76 h20 M44 76 v-26" stroke="#9e9e9e" stroke-width="2"/><rect x="38" y="24" width="12" height="22" rx="6" fill="#bdbdbd"/>` +
    `<g stroke="#757575" stroke-width=".8">${[28, 32, 36, 40].map(y => `<path d="M38 ${y} h12"/>`).join('')}</g><path d="M36 38 q0 10 8 10 q8 0 8 -10" stroke="#9e9e9e" stroke-width="1.5" fill="none"/>` +
    `<g fill="#00e676">${Array.from({ length: 7 }, (_, k) => `<rect x="${64 + k * 7}" width="4.5" rx="1"><animate attributeName="height" values="6;${18 + (k % 3) * 8};10;${12 + (k % 2) * 14};6" dur="${0.9 + (k % 3) * 0.2}s" repeatCount="indefinite"/><animate attributeName="y" values="${60 - 6};${60 - 18 - (k % 3) * 8};${60 - 10};${60 - 12 - (k % 2) * 14};${60 - 6}" dur="${0.9 + (k % 3) * 0.2}s" repeatCount="indefinite"/></rect>`).join('')}</g>` +
    `<rect x="62" y="62" width="52" height="3" fill="#546e7a"/><circle cx="104" cy="16" r="3" fill="#f44336">${A('opacity', '1;.3;1', '1s')}</circle>`,

  'Ski resort': sky('#4fc3f7', '#e1f5fe', 'sSki') +
    `<path d="M0 80 L0 40 L120 6 V80 Z" fill="#fafafa"/><path d="M0 40 L120 6" stroke="#cfd8dc" stroke-width="1"/>` +
    `<path d="M4 30 L116 2" stroke="#424242" stroke-width="1"/>` +
    `<g>${T('translate', '0 0;100 -25', '6s')}<path d="M10 28 v6" stroke="#424242" stroke-width="1"/><rect x="6" y="34" width="9" height="5" rx="1" fill="#e53935"/></g>` +
    `<g>${T('translate', '100 40;10 68', '3s')}<path d="M-6 6 l12 -3" stroke="#1565c0" stroke-width="1.5"/><rect x="-2" y="-6" width="5" height="8" rx="2" fill="#ff7043"/><circle cx=".5" cy="-8.5" r="2.4" fill="#ffcc80"/><path d="M-3 -4 l-4 6 M4 -4 l4 5" stroke="#424242" stroke-width=".8"/></g>` +
    `<g fill="#2e7d32">${[[96, 60], [106, 54], [20, 70]].map(([x, y]) => `<path d="M${x} ${y} l5 -12 l5 12 z"/>`).join('')}</g>`,

  'Theme park': sky('#ffcc80', '#fff3e0', 'sThe') +
    `<g>${T('rotate', '0 60 36;360 60 36', '12s')}<circle cx="60" cy="36" r="26" fill="none" stroke="#e53935" stroke-width="2"/>` +
    Array.from({ length: 8 }, (_, k) => { const a = k * Math.PI / 4; return `<path d="M60 36 L${(60 + 26 * Math.cos(a)).toFixed(1)} ${(36 + 26 * Math.sin(a)).toFixed(1)}" stroke="#ef9a9a" stroke-width="1"/>`; }).join('') + `</g>` +
    Array.from({ length: 8 }, (_, k) => {
      const colors = ['#1e88e5', '#43a047', '#fdd835', '#8e24aa'];
      const pts = Array.from({ length: 9 }, (_, s) => { const a = (k / 8 + s / 8) * 2 * Math.PI; return `${(26 * Math.cos(a)).toFixed(1)} ${(26 * Math.sin(a)).toFixed(1)}`; }).join(';');
      return `<g transform="translate(60 36)"><g>${T('translate', pts, '12s')}<rect x="-3.5" y="0" width="7" height="6" rx="1.5" fill="${colors[k % 4]}"/></g></g>`;
    }).join('') +
    `<path d="M52 76 L60 36 L68 76" stroke="#6d4c41" stroke-width="2.5" fill="none"/><rect y="76" width="120" height="4" fill="#8d6e63"/>` +
    `<g>${T('translate', '0 0;0 -4;0 0', '2s')}<path d="M100 26 q-6 -12 0 -12 q6 0 0 12" fill="#ec407a"/><path d="M100 26 v14" stroke="#9e9e9e" stroke-width=".6"/></g>`,

  Wedding: sky('#fff', '#fce4ec', 'sWed') +
    `<rect x="40" y="56" width="40" height="18" rx="2" fill="#fff8e1" stroke="#f8bbd0"/><rect x="46" y="42" width="28" height="14" rx="2" fill="#fff8e1" stroke="#f8bbd0"/><rect x="52" y="30" width="16" height="12" rx="2" fill="#fff8e1" stroke="#f8bbd0"/>` +
    `<path d="M40 62 q5 4 10 0 t10 0 t10 0 t10 0 M46 48 q4 3 7 0 t7 0 t7 0 t7 0" stroke="#f48fb1" stroke-width="1.2" fill="none"/>` +
    `<circle cx="57" cy="26" r="3" fill="none" stroke="#ffc107" stroke-width="1.6"/><circle cx="63" cy="26" r="3" fill="none" stroke="#ffc107" stroke-width="1.6"/>` +
    `<rect y="74" width="120" height="6" fill="#f8bbd0"/>` +
    `<g fill="#e91e63">${[[20, 0], [96, 1], [30, 2], [88, 3]].map(([x, b]) => `<g>${T('translate', `${x} 70;${x + 4} 10`, '4s', `begin="${b}s"`)}<path d="M0 0 c-4 -4 -4 -8 0 -6 c4 -2 4 2 0 6 z">${A('opacity', '1;0', '4s', `begin="${b}s"`)}</path></g>`).join('')}</g>`,

  Zoo: sky('#c5e1a5', '#f1f8e9', 'sZoo') +
    `<rect y="60" width="120" height="20" fill="#9ccc65"/>` +
    `<g>${T('rotate', '-4 56 70;4 56 70;-4 56 70', '3s')}<path d="M50 70 L52 30 h8 L62 70 z" fill="#ffca28"/><path d="M50 30 q2 -10 12 -8 q6 2 4 8 z" fill="#ffca28"/>` +
    `<g fill="#8d6e63">${[[54, 40], [57, 50], [54, 58], [58, 34], [56, 64]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.8"/>`).join('')}</g>` +
    `<circle cx="61" cy="26" r="1" fill="#212121"/><path d="M53 22 v-4 M57 21 v-4" stroke="#8d6e63" stroke-width="1.2"/></g>` +
    `<path d="M0 52 h120 M0 60 h120" stroke="#6d4c41" stroke-width="1.5"/><g stroke="#6d4c41" stroke-width="2">${Array.from({ length: 9 }, (_, k) => `<path d="M${6 + k * 14} 48 v24"/>`).join('')}</g>` +
    `<circle cx="96" cy="20" r="10" fill="#558b2f"/><circle cx="104" cy="26" r="8" fill="#689f38"/><rect x="98" y="28" width="3" height="32" fill="#6d4c41"/>`,

  Farm: sky('#81d4fa', '#e1f5fe', 'sFar') +
    `<rect y="58" width="120" height="22" fill="#8bc34a"/>` +
    `<rect x="12" y="34" width="38" height="28" fill="#c62828"/><path d="M8 36 l23 -16 l23 16 z" fill="#8e0000"/><rect x="24" y="46" width="14" height="16" fill="#fff"/><path d="M24 46 l14 16 M38 46 l-14 16" stroke="#c62828" stroke-width="1.2"/>` +
    `<path d="M88 62 l3 -32 h4 l3 32 z" fill="#eceff1"/><g>${T('rotate', '0 93 30;360 93 30', '4s')}` +
    [0, 90, 180, 270].map(a => `<rect x="91.5" y="12" width="3" height="18" fill="#bdbdbd" transform="rotate(${a} 93 30)"/>`).join('') + `</g><circle cx="93" cy="30" r="2" fill="#757575"/>` +
    `<g>${T('translate', '0 0;-14 0;0 0', '6s')}<ellipse cx="70" cy="66" rx="7" ry="4" fill="#fafafa"/><circle cx="64" cy="64" r="2.5" fill="#fafafa"/><circle cx="72" cy="65" r="1.6" fill="#212121"/><path d="M66 69 v3 M74 69 v3" stroke="#fafafa" stroke-width="1.4"/></g>`,

  'Fish market': sky('#b3e5fc', '#e1f5fe', 'sFis') +
    `<path d="M10 30 h100 v6 q-6 5 -12.5 0 q-6 5 -12.5 0 q-6 5 -12.5 0 q-6 5 -12.5 0 q-6 5 -12.5 0 q-6 5 -12.5 0 q-6 5 -12.5 0 q-6 5 -12.5 0 z" fill="#0277bd"/>` +
    `<path d="M14 30 v40 M106 30 v40" stroke="#5d4037" stroke-width="2.5"/><rect x="10" y="56" width="100" height="16" fill="#8d6e63"/><rect x="14" y="50" width="92" height="8" fill="#e1f5fe"/>` +
    `<g fill="#90a4ae">${[24, 44, 64, 84].map(x => `<path d="M${x} 53 q8 -5 14 0 q-6 5 -14 0 z M${x + 14} 53 l4 -3 v6 z"/>`).join('')}</g>` +
    `<g>${T('translate', '0 0;0 -22;0 0', '1.4s')}<path d="M54 48 q8 -5 14 0 q-6 5 -14 0 z M68 48 l4 -3 v6 z" fill="#ff8a65">${T('rotate', '0 61 48;-25 61 48;0 61 48', '1.4s', 'additive="sum"')}</path></g>` +
    `<g>${T('translate', '-20 14;140 6', '7s')}<path d="M0 0 q4 -4 8 0 q4 -4 8 0" stroke="#fff" stroke-width="1.8" fill="none">${T('scale', '1 1;1 .4;1 1', '.5s', 'additive="sum"')}</path></g>`,
};

// The whole <svg> element for a location (or a plain placeholder if a picture is missing).
export function pictureSVG(name, cls = 'pic') {
  const inner = PICTURES[name] || '<rect width="120" height="80" fill="#3d3150"/>';
  return `<svg class="${cls}" viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${name}">${inner}</svg>`;
}
