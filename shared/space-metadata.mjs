/**
 * Models occasionally write a literal control character inside a JSON string
 * (for example, a tab copied from a prompt). JSON.parse rejects the whole file
 * in that case, which made an otherwise complete Space fall back to its slug.
 * Escape only control characters that occur inside strings; whitespace between
 * JSON tokens is left untouched.
 */
export function repairJsonStringControls(input) {
  let output = '';
  let inString = false;
  let escaped = false;

  for (const character of input) {
    const code = character.charCodeAt(0);

    if (!inString) {
      output += character;
      if (character === '"') inString = true;
      continue;
    }

    if (escaped) {
      if (code < 0x20) {
        output += controlEscape(character).slice(1);
      } else {
        output += character;
      }
      escaped = false;
      continue;
    }

    if (character === '\\') {
      output += character;
      escaped = true;
    } else if (character === '"') {
      output += character;
      inString = false;
    } else if (code < 0x20) {
      output += controlEscape(character);
    } else {
      output += character;
    }
  }

  return output;
}

function controlEscape(character) {
  switch (character) {
    case '\b': return '\\b';
    case '\f': return '\\f';
    case '\n': return '\\n';
    case '\r': return '\\r';
    case '\t': return '\\t';
    default: return `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`;
  }
}

export function parseSpaceMetadata(input) {
  try {
    return JSON.parse(input);
  } catch {
    return JSON.parse(repairJsonStringControls(input));
  }
}
