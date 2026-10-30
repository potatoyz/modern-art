import { CATEGORIES, cardById } from './catalog.js';

// Original, resolution-independent illustrations. No downloaded assets or runtime image service.
export function artwork(id = '0-0') {
  const card = cardById(id) || cardById('0-0'), c = CATEGORIES[card.category], v = card.serial;
  const backgrounds = ['#f2d49f','#ecc5d6','#b8d7e6','#eedb9d','#c9dec7'];
  const sunX = 50 + (v % 4) * 42;
  let shapes = '';
  if (card.category === 0) shapes = `
    <path d="M0 188 Q120 175 240 194V300H0Z" fill="#7b9ea9"/>
    <path d="M0 231L240 213M0 255L240 237M42 188L70 300M120 185L154 300M196 192L226 300" stroke="#a5c0c6" stroke-width="3"/>
    <ellipse cx="146" cy="232" rx="68" ry="17" fill="#477e86" opacity=".25"/>
    <path d="M136 126Q117 157 122 203Q137 225 169 206Q177 167 159 126Z" fill="#f9f3e2" stroke="#cfb788" stroke-width="3"/>
    <path d="M146 134Q141 67 111 48M148 134Q176 81 191 65M147 116L150 45" fill="none" stroke="#4a8564" stroke-width="5"/>
    <path d="M144 104Q109 105 114 78Q145 81 144 104M154 98Q187 109 189 86Q164 79 154 98" fill="#74a477"/>
    <g fill="${v % 2 ? '#d87987' : '#df8b5c'}"><circle cx="110" cy="48" r="19"/><circle cx="151" cy="44" r="18"/><circle cx="189" cy="63" r="20"/></g>
    <g fill="#efd378"><circle cx="110" cy="48" r="7"/><circle cx="151" cy="44" r="7"/><circle cx="189" cy="63" r="7"/></g>
    <ellipse cx="71" cy="232" rx="44" ry="12" fill="#faf0d6"/><circle cx="64" cy="212" r="22" fill="#edac51"/><circle cx="88" cy="224" r="17" fill="#d98548"/>
    <path d="M63 191Q53 175 76 181" fill="#648958"/>
    <path d="M125 148Q128 139 132 143V198" stroke="white" stroke-width="4" fill="none" opacity=".6"/>`;
  if (card.category === 1) shapes = `
    <path d="M0 90Q140 60 240 130V300H0" fill="#d3b3cb"/>
    <path d="M25 300Q24 206 117 199Q216 205 219 300" fill="${v % 2 ? '#6e9685' : '#698aa0'}"/>
    <path d="M99 182V218Q121 239 144 216V178" fill="#d99d81"/>
    <ellipse cx="121" cy="126" rx="63" ry="77" fill="#f0bf9c"/>
    <path d="M59 120Q37 50 89 43Q141 10 181 68L186 115Q160 83 141 73Q112 114 59 120" fill="#4c4144"/>
    <ellipse cx="112" cy="49" rx="77" ry="30" transform="rotate(-13 112 49)" fill="${v % 2 ? '#b66b73' : '#716487'}"/>
    <path d="M107 21L108 10" stroke="#4c4144" stroke-width="8" stroke-linecap="round"/>
    <g fill="#51434a"><ellipse cx="95" cy="130" rx="4" ry="6"/><ellipse cx="147" cy="130" rx="4" ry="6"/></g>
    <path d="M121 130L114 152L128 154M109 174Q123 184 139 169" stroke="#a9645e" stroke-width="3" fill="none" stroke-linecap="round"/>
    <g fill="#e6a08d"><ellipse cx="81" cy="151" rx="11" ry="6"/><ellipse cx="159" cy="151" rx="11" ry="6"/></g>
    <path d="M75 234L99 256L120 231L141 256L165 234" stroke="#f1d4aa" stroke-width="10" fill="none"/><circle cx="120" cy="276" r="5" fill="#efc46d"/>`;
  if (card.category === 2) shapes = `
    <circle cx="${sunX}" cy="62" r="26" fill="#fff1c3"/>
    <path d="M-25 187L70 70L145 185L198 108L270 211Z" fill="#8397ad"/>
    <path d="M41 106L70 70L102 119L76 109L65 122Z" fill="#f2eee3"/>
    <path d="M-20 192Q82 129 140 186T270 164V300H-20" fill="#709798"/>
    <path d="M0 227Q93 183 240 217V300H0" fill="#7ba7b4"/>
    <path d="M25 249L85 249M136 230L214 230M105 274L195 274" stroke="#c1d8d8" stroke-width="4" stroke-linecap="round"/>
    <path d="M170 221L170 180L198 219Z" fill="#fff4dc"/><path d="M151 222H202L190 232H163Z" fill="#ae7867"/>
    <path d="M0 261L29 211L59 272Z" fill="#487c79"/>`;
  if (card.category === 3) shapes = `
    <circle cx="${sunX}" cy="65" r="30" fill="#eaa365"/>
    <path d="M0 137Q60 118 123 139T240 132V300H0" fill="#8cb9b7"/>
    <path d="M0 207Q102 148 240 203V300H0" fill="#f8e5b7"/>
    <path d="M-10 187Q120 146 250 177" stroke="#d1e4d8" stroke-width="7" fill="none"/>
    <path d="M63 258Q70 151 88 88" stroke="#b78b5c" stroke-width="12" fill="none"/>
    <path d="M88 89Q31 37 12 97Q51 71 88 89M88 89Q87 23 136 39Q110 61 88 89M88 89Q148 52 167 109Q129 82 88 89M88 89Q104 135 137 145Q137 102 88 89M88 89Q49 88 32 139Q73 116 88 89" fill="#608e6c"/>
    <path d="M152 248Q159 210 202 228L206 262Z" fill="#d98c6e"/><path d="M153 248L203 244" stroke="#f6cb98" stroke-width="5"/>
    <g fill="#bb9b70"><ellipse cx="111" cy="264" rx="3" ry="6"/><ellipse cx="122" cy="277" rx="3" ry="6"/></g>`;
  if (card.category === 4) shapes = `
    <path d="M0 167Q113 108 240 164V300H0" fill="#98b68a"/>
    <path d="M95 300L115 201H145L177 300" fill="#e6cea5"/>
    <path d="M55 154H191V236H55Z" fill="#f0d9ad"/><path d="M39 156L122 92L210 156Z" fill="#bb7268"/>
    <path d="M53 145L123 91L196 144" stroke="#935d5c" stroke-width="5" fill="none"/>
    <path d="M111 236V183Q127 167 141 183V236Z" fill="#779b96"/>
    <g fill="#738c8d" stroke="#fff0d1" stroke-width="5"><path d="M68 176H96V205H68Z"/><path d="M158 176H184V205H158Z"/></g>
    <path d="M29 244L32 143M214 254L213 160" stroke="#8e8060" stroke-width="9"/>
    <g fill="#6d9878"><circle cx="29" cy="135" r="34"/><circle cx="16" cy="157" r="28"/><circle cx="216" cy="151" r="35"/><circle cx="233" cy="174" r="25"/></g>
    <path d="M173 250L180 250M64 262L71 262M196 279L204 279" stroke="#e9dc9d" stroke-width="7" stroke-linecap="round"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 300" width="240" height="300"><rect width="240" height="300" fill="${backgrounds[c.id]}"/>${shapes}<path d="M18 18H222V282H18Z" fill="none" stroke="#fffdf7" stroke-opacity=".25" stroke-width="2"/><path d="M198 278q8 -12 10 0q5 -8 11 -3" fill="none" stroke="#59545b" stroke-width="2" opacity=".55"/></svg>`;
}
export const artData = id => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(artwork(id))}`;
export function avatar(index = 0) {
  const colors = ['#7cae96','#859fc3','#c68fa8','#dba86c','#d78d79'];
  return `<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="22" fill="${colors[index % 5]}"/><path d="M10 64Q12 43 32 43Q52 43 55 64" fill="#f3e9d1"/><ellipse cx="32" cy="28" rx="18" ry="21" fill="#efc4a2"/><path d="M14 26Q7 10 26 7Q47 1 52 24Q40 20 36 15Q28 28 14 26" fill="#59505a"/><circle cx="26" cy="29" r="2" fill="#514650"/><circle cx="39" cy="29" r="2" fill="#514650"/><path d="M28 39Q33 43 38 38" stroke="#a96765" stroke-width="2" fill="none"/></svg>`;
}
