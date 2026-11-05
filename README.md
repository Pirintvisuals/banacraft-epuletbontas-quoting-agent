# Banacraft - Bontás árbecslő (belső bontás, épületbontás)

A Hungarian chat widget for the Banacraft épületbontás site. The visitor answers a
short set of questions (clicking buttons **or** typing), leaves their details in
one form, and immediately sees an **itemised starting price** ("alapár … Ft-tól")
with the exclusions named. Banacraft gets the lead and the whole conversation by
e-mail, and conversations that stop halfway are e-mailed too.

One of three separate bots (`banacraft-kiurites-agent`, `banacraft-bontas-agent`,
`banacraft-palateto-agent`). They share the same engine; only `lib/flow.js`, the
`BOT` block at the top of `public/widget.js`, the colour variables at the top of
`public/style.css` and the logos differ.

## How it works

```
public/widget.js ──POST──► api/faq-agent.js (shared engine)
                               ├── lib/flow.js   questions, buttons, price model, company facts
                               ├── OpenAI/Gemini only for TYPED messages the engine can't map
                               ├── Resend        e-mail to Banacraft
                               └── Zoho Flow     CRM webhook (optional)
```

- **The backend owns the conversation.** It picks the next question, words it,
  shows its buttons and maps the click. A click never costs a model call.
- **The AI is only for typed messages** - a question of the visitor's own, or an
  answer in their own words ("a csempét a falról és a padlóról, meg a kádat"). It
  replies and tags which option the words meant; the engine validates the tag.
- **No AI key? Still works.** Every button path works; a typed message the engine
  can't read gets "please pick a button, or call us".

## The questions

Bontás típusa → helyszín → emelet / lift → mit kell elbontani (több is) → a
mennyisége tételenként (m², db, beton: m² és cm) → kezdés. The building type
does not matter. Load-bearing walls are not demolished (said in the scope hint).

## Keeping customers in the chat

- **Back** on every question and on the form; **resume** after a reload (kept in
  sessionStorage, gone when the tab closes).
- **A failed request** is retried once quietly; after that the customer's buttons
  or the form (with what they typed) come back.
- **"Inkább visszahívást kérek"** under the chat sends the owner a "VISSZAHÍVÁS"
  e-mail with the answers so far. It does not go to Zoho Flow: that webhook
  expects a priced quote.
- **Under the finished quote:** survey-time buttons and a tap-to-call button. A
  picked time e-mails the owner.
- **Typed answers** that are a button in other words (no accents, "igen", the
  start of one label) are read without a model call. Typed start dates are judged
  against today: "télen" is fine in October, "tavasszal" is not.
- **AI:** 8 s timeout, then the other provider if its key is set, then the buttons.
  A price in the model's reply is replaced before the customer sees it.
- **Analytics (PostHog):** `step_shown` and `question_answered` carry `field`, so
  drop-off shows per question. Also `back_clicked`, `callback_opened`,
  `callback_requested`, `form_submitted`, `form_error`, `survey_time_picked`,
  `call_cta_clicked`, `chat_resumed`.
- **Region:** `vercel.json` runs the function in `fra1` (Frankfurt), close to the
  customers.

## Pricing

- **Banacraft's own prices** (Róbert, 2026-10-30 and 2026-11-05), all in `P`
  at the top of `lib/flow.js`. The full list and the decisions behind it are in
  `banacraft-arak-2026-10-30.md` next to the three bot folders.
- **A floor, never a range.** A band button is priced at its lower edge and the
  assumption is printed; a typed number is priced as typed.
- **Every quantity question** has buttons AND a field for the exact number
  ("pontosan lehessen beírni a számokat").
- **Location first:** Budapest / Pest megye / Pest környéki megye / Távolabb.
  "Távolabb" skips straight to the start date and gets a call, not a price.
- **Start within 60 days** (Amint lehet / 30 / 60 napon belül); a typed later
  start is politely refused.
- **No price, a call instead** for the jobs listed below: the customer sees why
  and "kollégánk hamarosan hívja"; the owner gets a "Hívást kér" e-mail with the
  answers and, where there is a rate, Róbert's figure for the call. Zoho gets
  `quote_basis: "call"` and no amounts.
- **VAT:** magánszemély and társasház see gross, cég and intézmény see net + ÁFA.
- `npm test` clicks every scenario through and checks the exact total.
- **Interior, haulage included:** burkolat 5 900 Ft/m², tégla válaszfal 8 900 Ft/m²,
  vakolat (3–4 cm-ig) 5 900 Ft/m², gipszkarton profilokkal 4 900 Ft/m², betonvésés
  1 000 Ft/m²/cm, nyílászáró 9 900 Ft/db, bútor 9 900 Ft/db, falemez 3 900 Ft/m².
  Pest megye +10%, környező megye +20%, +10% per floor without a lift. No
  minimum job.
- **A call instead of a price:** whole houses and outbuildings (the owner's
  e-mail carries 50 000 / 35 000 / 18 000 Ft/m² as reference), panel válaszfal on
  its own, Távolabb.

## Run, test, deploy

```bash
npm install
npm start          # http://localhost:8894
npm test           # clicks through hundreds of random conversations + sample quotes
```

Locally, copy `.env.example` to `.env.local`. Without `RESEND_API_KEY` no e-mail
goes out; without an AI key typed messages fall back to the buttons.

## Deploy on Vercel

1. Vercel → **Add New… → Project** → import
   `Pirintvisuals/banacraft-epuletbontas-quoting-agent`.
2. **Framework Preset:** Other. Leave Root Directory, Build Command and Output
   Directory empty - there is no build; Vercel serves `public/` and turns
   `api/faq-agent.js` into the function.
3. **Environment Variables** (before the first deploy):

   | Name | Value |
   |---|---|
   | `AI_PROVIDER` | `gemini` or `openai` |
   | `GEMINI_API_KEY` or `OPENAI_API_KEY` | a key created just for Banacraft (not NM Bau's) |
   | `RESEND_API_KEY` | a Resend API key created just for Banacraft |
   | `LEAD_EMAIL_TO` | `info@banacraft.hu` |
   | `LEAD_EMAIL_FROM` | a sender on a **verified** Resend domain, e.g. `Banacraft <ajanlat@banacraft.hu>` once banacraft.hu is verified in Resend |
   | `ZOHO_FLOW_WEBHOOK_URL` | optional |
   | `OWNER_TEST_KEY` | optional - protects the self-test below |

   Without `LEAD_EMAIL_FROM` it falls back to Resend's test sender, which only
   delivers to the Resend account owner's own address - not to info@banacraft.hu.
4. **Deploy.** Then check:
   - `https://YOUR-PROJECT.vercel.app/` - the demo page with the widget
   - `https://YOUR-PROJECT.vercel.app/api/faq-agent?selftest=1` - sends a test
     e-mail and reports what Resend answered

Changing an environment variable later needs a redeploy to take effect.

## Embedding on the Banacraft site

```html
<script>
  window.BANACRAFT_CONFIG = {
    apiUrl: "https://YOUR-PROJECT.vercel.app/api/faq-agent",
    assetsUrl: "https://YOUR-PROJECT.vercel.app",
    launcher: false
  };
</script>
<script src="https://YOUR-PROJECT.vercel.app/widget.js" defer></script>
```

The site already has a floating "Azonnali árbecslés" button and several
"Árbecslés indítása" buttons, all marked `data-quote-agent`. The widget catches
those clicks before the site's placeholder toast, so they open the chat with no
other change - hence `launcher: false`.

## What Banacraft receives

- **Finished estimate:** contact details, customer type, every answer, the
  itemised price, exclusions, warnings (statikus, azbeszt) and the full chat.
- **No price, a call promised:** "Hívást kér: név, telefon - munka, település" -
  the answers, why there was no price, and the reference figure where there is one.
- **Stopped halfway:** the conversation so far (chat closed, page left, or 3 idle
  minutes; max 3 per conversation).
- **Zoho Flow:** same webhook contract as the NM Bau bot (`ZOHO_FLOW_WEBHOOK_URL`),
  with `quote_basis: "floor"`. The payload is logged as `[zoho payload]` with contact details masked.

## Editing

- **Prices:** `P` in `lib/flow.js`.
- **Questions, buttons, order:** `FIELDS` and `fieldOrder()` in `lib/flow.js`.
- **What the AI may say about Banacraft:** `KNOWLEDGE` in `lib/flow.js`.
- **Greeting, teaser texts:** `BOT` at the top of `public/widget.js`.
- **Colours:** the variables at the top of `public/style.css`.
