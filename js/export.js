// PEQ text, clipboard, downloads, session JSON.

export const PEQ_FILENAME = 'dms-sweep-peq.txt';
export const SESSION_FILENAME = 'dms-sweep-session.json';

function filterLines(bands, preamp) {
  const lines = [`Preamp: ${preamp.toFixed(1)} dB`];
  const on = bands.filter((b) => b && b.enabled !== false).sort((a, b) => a.fc - b.fc);
  on.forEach((b, i) => {
    lines.push(
      `Filter ${i + 1}: ON ${b.type} Fc ${Math.round(b.fc)} Hz ` +
        `Gain ${Number(b.gain).toFixed(1)} dB Q ${Number(b.q).toFixed(2)}`
    );
  });
  return lines;
}

// Generic parametric EQ text. Enabled bands only, sorted by fc, numbered from 1.
// With per-ear bands the text becomes two blocks under Equalizer APO's
// `Channel: L` / `Channel: R` selectors; each block holds the L+R bands plus that
// ear's own. Both blocks carry the same preamp so the L/R balance is untouched.
export function toPeqText(state) {
  const preamp = Number(state && state.preampDb) || 0;
  const bands = (Array.isArray(state && state.bands) ? state.bands : []).filter(Boolean);
  const perEar = bands.some((b) => b.channel === 'L' || b.channel === 'R');
  if (!perEar) return filterLines(bands, preamp).join('\n');
  const side = (ch) => bands.filter((b) => b.channel !== (ch === 'L' ? 'R' : 'L'));
  return [
    'Channel: L', ...filterLines(side('L'), preamp),
    '',
    'Channel: R', ...filterLines(side('R'), preamp),
  ].join('\n');
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    // Older browsers, or a context without clipboard permission: fall back to
    // a hidden textarea and the legacy copy command.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e2) {
      return false;
    }
  }
}

function saveBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(filename, text) {
  saveBlob(filename, new Blob([text], { type: 'text/plain;charset=utf-8' }));
}

export function downloadJson(filename, obj) {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
  saveBlob(filename, new Blob([text], { type: 'application/json;charset=utf-8' }));
}

// Everything except the transient playing flag.
export function sessionToJson(state) {
  const s = state || {};
  return JSON.stringify(
    {
      version: 1,
      freq: s.freq,
      levelDb: s.levelDb,
      eqOn: s.eqOn,
      preampDb: s.preampDb,
      preampAuto: s.preampAuto,
      bands: (s.bands || []).map((b) => ({
        id: b.id,
        type: b.type,
        fc: b.fc,
        gain: b.gain,
        q: b.q,
        enabled: b.enabled !== false,
        channel: b.channel || 'both',
      })),
      selectedId: s.selectedId ?? null,
      draft: s.draft,
      toneWidth: s.toneWidth,
      ear: s.ear,
      theme: s.theme,
    },
    null,
    2
  );
}

export function sessionFromJson(text) {
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Not a DMS Sweep session.');
  }
  if (!Array.isArray(data.bands)) throw new Error('Session has no bands.');
  for (const b of data.bands) {
    if (!b || typeof b !== 'object' || !Number.isFinite(Number(b.fc))) {
      throw new Error('Session has a malformed band.');
    }
  }
  return data;
}
