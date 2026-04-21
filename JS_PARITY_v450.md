# JS parity: v4.5.0 patches for ui.html

These patches bring the Figma plugin's JavaScript preprocessor into parity
with the Python changes in this session.


## 1. GRM-06: compound modifier hyphenation

Add after the ACT-01 binary response check in the JS preprocessor.

```javascript
// --- GRM-06: Compound modifier hyphenation ---

const COMPOUND_MOD_UNITS = [
  'day', 'week', 'month', 'year',
  'hour', 'minute', 'second',
  'time',
  'step', 'page', 'word',
  'mile', 'foot', 'inch', 'pound',
  'dollar', 'percent',
  'factor', 'way',
];

const compoundUnitsAlt = COMPOUND_MOD_UNITS.map(u => `${u}s?`).join('|');

const COMPOUND_STOPWORDS = [
  'of', 'in', 'to', 'for', 'from', 'ago', 'later',
  'or', 'and', 'is', 'are', 'was', 'were', 'has', 'have',
  'remaining', 'left', 'total', 'each', 'per', 'every',
];
const stopwordLookahead = COMPOUND_STOPWORDS.map(w => `${w}\\b`).join('|');

const SPELLED_NUMBERS = [
  'one', 'two', 'three', 'four', 'five',
  'six', 'seven', 'eight', 'nine', 'ten',
];

// Numeric: "5 day streak" → violation
const unhyphenatedNumericRe = new RegExp(
  `\\b(\\d+)\\s+(${compoundUnitsAlt})\\s+(?!${stopwordLookahead})(\\w{2,})\\b`, 'i'
);
// Numeric pass: "5-day streak"
const hyphenatedNumericRe = new RegExp(
  `\\b\\d+-(${COMPOUND_MOD_UNITS.join('|')})\\s+\\w+\\b`, 'i'
);
// Spelled-out: "one time offer" → violation
const unhyphenatedSpelledRe = new RegExp(
  `\\b(${SPELLED_NUMBERS.join('|')})\\s+(${compoundUnitsAlt})\\s+(?!${stopwordLookahead})(\\w{2,})\\b`, 'i'
);
// Spelled-out pass: "one-time offer"
const hyphenatedSpelledRe = new RegExp(
  `\\b(${SPELLED_NUMBERS.join('|')})-(${COMPOUND_MOD_UNITS.join('|')})\\s+\\w+\\b`, 'i'
);

function checkGrm06(text) {
  // PASS: correctly hyphenated
  if (hyphenatedNumericRe.test(text) || hyphenatedSpelledRe.test(text)) {
    return { standardId: 'GRM-06', outcome: 'pass' };
  }

  // VIOLATION: unhyphenated numeric
  let match = text.match(unhyphenatedNumericRe);
  if (match) {
    const num = match[1];
    let unit = match[2];
    const singular = (unit.endsWith('s') && !unit.endsWith('ss'))
      ? unit.slice(0, -1) : unit;
    return {
      standardId: 'GRM-06',
      outcome: 'violation',
      issue: `Compound modifier '${num} ${unit}' needs a hyphen before the noun.`,
      suggestion: `Use '${num}-${singular}' with a hyphen and singular unit.`,
    };
  }

  // VIOLATION: unhyphenated spelled-out
  match = text.match(unhyphenatedSpelledRe);
  if (match) {
    const word = match[1];
    let unit = match[2];
    const singular = (unit.endsWith('s') && !unit.endsWith('ss'))
      ? unit.slice(0, -1) : unit;
    return {
      standardId: 'GRM-06',
      outcome: 'violation',
      issue: `Compound modifier '${word} ${unit}' needs a hyphen before the noun.`,
      suggestion: `Use '${word}-${singular}' with a hyphen and singular unit.`,
    };
  }

  return { standardId: 'GRM-06', outcome: 'defer' };
}
```

Register in the main preprocessor function:
```javascript
results.push(checkGrm06(text));
```


## 2. CON-02: safe-phrase allowlist

Add the safe phrases set and early return in the CON-02 check.

```javascript
const CON02_SAFE_PHRASES = new Set([
  'see all', 'view all', 'show all', 'browse all',
  'show more', 'load more', 'view more',
  'sign in', 'sign up', 'sign out', 'log in', 'log out',
  'add new', 'create new',
  'go back', 'go home',
  'opt in', 'opt out',
  'get started', 'try free',
]);
```

In `checkCon02SentenceCase`, add after the `words.length <= 1` early return:

```javascript
// Safe phrases: industry-standard patterns with intentional casing
const normalized = text.trim().toLowerCase();
if (CON02_SAFE_PHRASES.has(normalized)) {
  return { standardId: 'CON-02', outcome: 'pass' };
}
```


## 3. Celebration + trust_permission moment display

The JS moment detector in ui.html needs the two new moments added
to its detection chain. Follow the same priority order as Python:

1. Add celebration patterns BEFORE confirmation check
2. Add trust_permission patterns BEFORE decision_point check

The moment taxonomy label map also needs updating:
```javascript
const MOMENT_LABELS = {
  // ... existing entries ...
  'celebration': 'Celebration',
  'trust_permission': 'Trust & permission',
};
```

If the results card shows moment info, the new moments should display
with their descriptions from the taxonomy.
