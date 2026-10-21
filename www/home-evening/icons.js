// 所有界面图标保持相同线宽，使用代码原生 SVG 以支持清晰缩放。
const paths = {
  expand:'<path d="M15 3h6v6m0-6-7 7M9 21H3v-6m0 6 7-7"/>',
  spotlight:'<path d="M8 4h8l2 7H6ZM12 2v2M8 14l-3 5m7-5v7m4-7 3 5"/>',
  downlight:'<ellipse cx="12" cy="7" rx="8" ry="3"/><path d="M7 7h10M8 13l-2 6m6-6v8m4-8 2 6"/>',
  pendant:'<path d="M12 2v6M7 8h10l4 8H3ZM9 19a3 3 0 0 0 6 0"/>',
  ceilingLight:'<path d="M5 5h14l2 6H3ZM3 11c2 5 16 5 18 0M7 18l-1 2m6-2v3m5-3 1 2"/>',
  lightStrip:'<rect x="3" y="7" width="18" height="5" rx="2"/><path d="M6 9.5h12M6 16v2m6-2v4m6-4v2"/>',
  roomLiving:'<path d="M5 12V8a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v4M5 17H3v-5a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v5H5Zm0 0v3m14-3v3"/>',
  roomMaster:'<path d="M3 19V5m18 14V5M3 8h18M3 17h18M5 12V9h6v3m2 0V9h6v3M3 12h18v5"/>',
  roomSecondary:'<path d="M6 21V3h12v18M6 6h12M8 10V7h8v3M6 10h12v8H6m0 0h12"/>',
  roomStudy:'<path d="M3 4h7a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H3Zm18 0h-5a3 3 0 0 0-3 3v14a4 4 0 0 1 4-2h4ZM6 8h3m-3 4h3m8-4h1m-1 4h1"/>',
  roomChild:'<rect x="3" y="12" width="8" height="8" rx="2"/><rect x="13" y="12" width="8" height="8" rx="2"/><path d="m12 2 5 8H7Zm-6 14h2m8 0h2"/>',
  aircon:'<rect x="3" y="4" width="18" height="11" rx="2"/><path d="M4 11h16M7 18v3m5-3v3m5-3v3"/>',
  // 齿轮以中心旋转对称构造，轮廓宽高一致，避免小尺寸显示时显得扁窄。
  settings:'<path d="M19.576 8.862L21.781 9.921L21.781 14.079L19.576 15.138L20.387 17.446L17.446 20.387L15.138 19.576L14.079 21.781L9.921 21.781L8.862 19.576L6.554 20.387L3.613 17.446L4.424 15.138L2.219 14.079L2.219 9.921L4.424 8.862L3.613 6.554L6.554 3.613L8.862 4.424L9.921 2.219L14.079 2.219L15.138 4.424L17.446 3.613L20.387 6.554Z"/><circle cx="12" cy="12" r="3.3"/>',
  home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  leaf:'<path d="M20 3c1 12-4 18-11 16-8-4-1-14 11-16Z"/><path d="M4 21 16 9"/>',
  appliance:'<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M5 10h14M8 6v1m0 7v2"/>',
  bulb:'<path d="M8 15c-2-1-3-3-3-5a7 7 0 1 1 14 0c0 2-1 4-3 5v3H8Z"/><path d="M9 21h6M9 18h6"/>',
  snow:'<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 4l3 3 3-3M9 20l3-3 3 3M4 10l4-1-1-4M17 19l-1-4 4-1M4 14l4 1-1 4M17 5l-1 4 4 1"/>',
  heat:'<path d="M6 3c-5 6 5 8 0 15m6-15c-5 6 5 8 0 15m6-15c-5 6 5 8 0 15M3 22h18"/>',
  wind:'<path d="M3 7h12a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 17h6a3 3 0 1 1-3 3"/>',
  windLow:'<path d="M3 12h14a3 3 0 1 0-3-3"/>',
  windMedium:'<path d="M3 8h12a3 3 0 1 0-3-3M3 16h16a3 3 0 1 1-3 3"/>',
  windHigh:'<path d="M3 5h12a2 2 0 1 0-2-2M3 12h16a2 2 0 1 1-2 2M3 19h10a2 2 0 1 1-2 2"/>',
  leave:'<path d="M10 4H4v16h6m3-12 4 4-4 4M8 12h13"/>',
  moon:'<path d="M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12Z"/>',
  power:'<path d="M12 2v9M6 5a9 9 0 1 0 12 0"/>',
  off:'<path d="M4 4 20 20M12 2v7M6 5a9 9 0 1 0 12 0"/>',
  cube:'<path d="m12 2 9 5v10l-9 5-9-5V7Zm0 10L3 7m9 5 9-5m-9 5v10M7.5 4.5l9 5"/>',
  reset:'<path d="M3 10a9 9 0 0 1 15-6l3 3M21 3v4h-4M21 14a9 9 0 0 1-15 6l-3-3M3 21v-4h4"/>',
  plus:'<path d="M5 12h14M12 5v14"/>', minus:'<path d="M5 12h14"/>',
  close:'<path d="m5 5 14 14M5 19 19 5"/>', arrow:'<path d="m9 4 8 8-8 8"/>',
  fan:'<circle cx="12" cy="12" r="2"/><path d="M12 10C3-1 3 14 10 12m4 0c11-9-4-9-2-2m0 4c9 11 9-4 2-2M10 12C-1 21 14 21 12 14"/>',
  drop:'<path d="M12 2c-3 4-8 9-8 13a8 8 0 0 0 16 0c0-4-5-9-8-13Z"/>',
  temperature:'<path d="M9 14V5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0Z"/><path d="M12 8v9"/>',
  pause:'<path d="M8 4v16M16 4v16"/>', play:'<path d="m7 3 14 9-14 9Z"/>',
  washer:'<rect x="3" y="2" width="18" height="20" rx="2"/><circle cx="12" cy="14" r="5"/><path d="M6 5h3m6 0h3"/>',
  fridge:'<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 2v20M9 9v4m6-4v4"/>',
  drinker:'<path d="M6 4h12v16H6Zm0 4h12m-6 0v5h3m-5 7v2h8v-2"/>',
  check:'<path d="m4 12 5 5L20 6"/>',
  rain:'<path d="M6 14a5 5 0 0 1 0-10 7 7 0 0 1 13 3 4 4 0 0 1 0 7H6m1 3-1 3m7-3-1 3m7-3-1 3"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
  cloud:'<path d="M6 19a5 5 0 0 1-1-10 7 7 0 0 1 13-2 6 6 0 0 1 0 12Z"/>',
  partly:'<path d="M9 4V2M4 9H2m2-5 2 2m9-2-2 2"/><path d="M5 11a5 5 0 0 1 9-4M8 20a5 5 0 0 1 0-10 6 6 0 0 1 11 3 4 4 0 0 1 0 7Z"/>',
  nightPartly:'<path d="M11 3a5 5 0 0 0 7 6M11 3a7 7 0 0 0-6 9M8 21a5 5 0 0 1 0-10 6 6 0 0 1 11 3 4 4 0 0 1 0 7Z"/>',
  storm:'<path d="M6 15a5 5 0 0 1-1-10 7 7 0 0 1 13 3 4 4 0 0 1 0 7M12 12l-4 7h5l-2 4"/>',
  fog:'<path d="M6 11a4 4 0 0 1 0-8 6 6 0 0 1 11 3 3 3 0 0 1 1 5M3 15h18M5 19h14M8 23h8"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  calendar:'<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M7 2v4m10-4v4M3 10h18M7 14h2m4 0h2m-8 4h2"/>',
  eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  gauge:'<path d="M4 19a10 10 0 1 1 16 0M12 12l5-5M5 12h1m12 0h1M12 4v1"/><circle cx="12" cy="12" r="2"/>',
  sunrise:'<path d="M3 18h18M5 15a7 7 0 0 1 14 0M12 2v5m-2-2 2-3 2 3M3 9l2 2m14 0 2-2M2 22h20"/>',
  sunset:'<path d="M3 18h18M5 15a7 7 0 0 1 14 0M12 2v5m-2-2 2 2 2-2M3 9l2 2m14 0 2-2M2 22h20"/>',
  room:'<path d="M3 21V4h18v17M8 21V9h8v12M16 15h-2"/>',
};
/** 根据名称创建统一且不承载交互的 SVG 图标。 */
export function icon(name, className = '') {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.appliance}</svg>`;
}

/** 按已确认的灯具名称匹配轮廓，未知类型保留通用灯泡。 */
export function lightIcon(name) {
  if(name.includes('灯带'))return 'lightStrip';
  if(name.includes('射灯'))return 'spotlight';
  if(name.includes('筒灯'))return 'downlight';
  if(name.includes('吊灯'))return 'pendant';
  if(name.includes('吸顶灯')||name.includes('主灯'))return 'ceilingLight';
  return 'bulb';
}
