# Content type → standards mapping (v2)

Updated with review decisions:

- VT-01 through VT-04 confirmed excluded from buttons
- VT-01 stays for confirmations, with a content type note that passive voice is acceptable
- CON-02 (sentence case) expanded to all content types
- Short/long copy overlap left as-is for now — needs novel test cases to validate

## Content types

| Code | Description | Example |
|---|---|---|
| `button_cta` | Button labels, CTAs (≤5 words with action words) | "Create account", "Save changes" |
| `error_message` | Error and failure states (≤15 words with error keywords) | "Your payment didn't go through." |
| `confirmation` | Success and completion messages (≤20 words) | "Your changes are saved." |
| `tooltip_microcopy` | Tooltips, hints, helper text (≤30 words, has ?) | "What does this setting do?" |
| `ui_label` | Labels, headings, nav items (≤8 words) | "Account settings", "Billing" |
| `short_ui_copy` | General UI text (≤40 words) | "You can upload files up to 25 MB." |
| `long_form_copy` | Help content, onboarding flows, documentation | Multi-paragraph help articles |

## Final mapping

✓ = checked | ✓* = checked with content type note | — = excluded

### Clarity

| ID | Rule (short) | button | error | confirm | tooltip | label | short | long |
|---|---|---|---|---|---|---|---|---|
| CLR-01 | Plain language | — | ✓ | — | ✓ | — | ✓ | ✓ |
| CLR-02 | Lead with key info | — | ✓ | — | ✓ | — | ✓ | ✓ |
| CLR-03 | Short sentences | — | — | — | ✓ | — | ✓ | ✓ |
| CLR-04 | One idea per sentence | — | — | — | ✓ | — | ✓ | ✓ |
| CLR-05 | No confusing double negatives | — | ✓ | ✓ | ✓ | — | ✓ | ✓ |

### Voice and tone

| ID | Rule (short) | button | error | confirm | tooltip | label | short | long |
|---|---|---|---|---|---|---|---|---|
| VT-01 | Active voice | — | ✓ | ✓* | ✓ | — | ✓ | ✓ |
| VT-02 | Address user as "you" | — | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| VT-03 | Conversational, not casual | — | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| VT-04 | Confident, no hedging | — | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| VT-05 | Empathy in errors | — | ✓ | — | — | — | — | — |

### Consistency

| ID | Rule (short) | button | error | confirm | tooltip | label | short | long |
|---|---|---|---|---|---|---|---|---|
| CON-01 | Consistent terminology | — | — | — | — | — | ✓ | ✓ |
| CON-02 | Sentence case | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| CON-03 | Spell out month in dates | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| CON-04 | Same word for same action | — | — | — | — | — | ✓ | ✓ |
| CON-05 | Capitalize product names | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

### Accessibility

| ID | Rule (short) | button | error | confirm | tooltip | label | short | long |
|---|---|---|---|---|---|---|---|---|
| ACC-01 | Descriptive link text | ✓ | — | — | — | — | ✓ | ✓ |
| ACC-02 | Don't rely on color alone | — | — | — | — | — | ✓ | ✓ |
| ACC-03 | Descriptive alt text | — | — | — | — | — | — | ✓ |
| ACC-04 | No directional language | — | — | — | ✓ | — | ✓ | ✓ |
| ACC-07 | Clear form labels | — | — | — | — | ✓ | ✓ | — |

### Action-oriented writing

| ID | Rule (short) | button | error | confirm | tooltip | label | short | long |
|---|---|---|---|---|---|---|---|---|
| ACT-01 | Start CTAs with a verb | ✓ | — | — | — | ✓ | — | — |
| ACT-02 | Specific verbs over vague | ✓ | — | — | — | ✓ | — | — |
| ACT-03 | Lead with what user can do | — | ✓ | — | — | — | ✓ | ✓ |
| ACT-04 | Clear next step | — | ✓ | ✓ | — | — | ✓ | ✓ |

### Content structure

| ID | Rule (short) | button | error | confirm | tooltip | label | short | long |
|---|---|---|---|---|---|---|---|---|
| STR-01 | Headings for scannability | — | — | — | — | — | — | ✓ |
| STR-02 | Short paragraphs | — | — | — | — | — | ✓ | ✓ |
| STR-03 | Parallel structure in lists | — | — | — | — | — | ✓ | ✓ |
| STR-04 | Front-load key info | — | — | — | ✓ | — | ✓ | — |
| STR-05 | Group related info | — | — | — | — | — | — | ✓ |

### Grammar and mechanics

| ID | Rule (short) | button | error | confirm | tooltip | label | short | long |
|---|---|---|---|---|---|---|---|---|
| GRM-01 | Oxford comma | — | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| GRM-02 | Expand acronyms on first use | — | — | — | — | — | ✓ | ✓ |
| GRM-03 | Exclamation points sparingly | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| GRM-04 | No ampersands | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| GRM-05 | Use numerals | — | ✓ | ✓ | ✓ | — | ✓ | ✓ |

### Inclusive language

| ID | Rule (short) | button | error | confirm | tooltip | label | short | long |
|---|---|---|---|---|---|---|---|---|
| INC-01 | Singular "they" | — | — | — | — | — | ✓ | ✓ |
| INC-02 | Gender in forms | — | — | — | — | ✓ | ✓ | — |

### Translation readiness

| ID | Rule (short) | button | error | confirm | tooltip | label | short | long |
|---|---|---|---|---|---|---|---|---|
| TRN-01 | Avoid ambiguous words | — | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| TRN-02 | Avoid unnecessary -ing | — | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| TRN-03 | Repeat subjects in compounds | — | — | — | — | — | ✓ | ✓ |
| TRN-04 | No idioms or slang | — | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| TRN-05 | Keep function words | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| TRN-06 | ISO currency, metric units | — | — | — | ✓ | ✓ | ✓ | ✓ |
| TRN-07 | Consistent terms | — | — | — | — | — | ✓ | ✓ |

## Standards per content type

| Content type | Standards checked | Reduction from 44 |
|---|---|---|
| button_cta | 8 | 82% fewer |
| error_message | 22 | 50% fewer |
| confirmation | 20 | 55% fewer |
| tooltip_microcopy | 22 | 50% fewer |
| ui_label | 14 | 68% fewer |
| short_ui_copy | 33 | 25% fewer |
| long_form_copy | 33 | 25% fewer |

## Content type notes

Standards marked ✓* have context-specific evaluation notes. These are injected into the validation pass prompt to guide the LLM's focused yes/no judgment.

### Schema

```json
{
  "id": "VT-01",
  "rule": "Use active voice when giving instructions...",
  "relevant_content_types": [
    "error_message", "confirmation", "tooltip_microcopy",
    "short_ui_copy", "long_form_copy"
  ],
  "content_type_notes": {
    "confirmation": "Passive voice is acceptable in confirmations and system status messages. Only flag if the passive construction is unnecessarily complex or names the actor awkwardly (e.g., 'Changes have been saved by the system')."
  }
}
```

### Current notes

| Standard | Content type | Note |
|---|---|---|
| VT-01 | confirmation | Passive voice is acceptable. Only flag if the passive construction is unnecessarily complex or names the actor awkwardly. |

More notes will be added as eval data reveals other content-type-specific false positive patterns. Each note is data — it lives in the standards library, not in code.

## Durability considerations

### Required fields for new standards

Every standard in the library should require:

- `id`, `rule`, `correct`, `incorrect` (existing)
- `rule_type`, `checkable_from` (existing)
- `relevant_content_types` (new, required)
- `content_type_notes` (new, optional)

The eval suite should flag any standard missing `relevant_content_types`.

### Extensible content types

The 7 current types are hardcoded in `detect_content_type`. For standards packs (GOV.UK, Google, Microsoft), the taxonomy should be defined in the standards library or pack file, not in the classifier code. A GOV.UK pack might add:

```json
{
  "content_types": [
    { "id": "service_pattern", "description": "Transactional service page copy" },
    { "id": "guidance_page", "description": "Guidance and policy content" }
  ]
}
```

The classifier then knows what types to look for based on what's loaded.

### Multi-snippet consistency checking

CON-01, CON-04, and TRN-07 can only detect violations across multiple pieces of copy. Currently limited by single-string input. Future paths:

- Figma plugin: check all selected layers as a set
- CLI batch mode: pass a file of strings, run consistency rules across the batch
- Standards library: tag these standards with `"requires_multi_snippet": true` so the engine knows to defer them in single-string mode
