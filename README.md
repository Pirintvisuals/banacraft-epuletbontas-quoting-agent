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

**Belső bontás** - the detailed one, because *what exactly comes out* is what
moves the price:

1. Épület: panel / tégla lakás, családi ház, **többszintes ház**, iroda, ipari, egyéb
2. Házaknál: **hány szintes**, és melyik szinten lesz a bontás · lakásoknál: emelet + lift
3. Terület (m² sáv vagy szám)
4. **Mit kell elbontani** (több is): teljes belső csupasz falig · padlócsempe ·
   parketta/laminált/PVC · **falicsempe vésése** · vakolat · aljzat · válaszfal ·
   álmennyezet · **nyílászárók** · **vésés (horony, áttörés)** · fürdő berendezés ·
   konyhabútor · fa szerkezet · vezetékek
5. Minden bejelölt tételhez egy rövid "mennyit" kérdés (hány helyiség, hány fal,
   hány ablak/ajtó, mennyi vésés…)
6. Falazat anyaga (ha számít) → teherhordó fal / új nyílás → lakott-e →
   konténer helye → takarítás utána → kezdés

**Teljes épület / melléképület:** szerkezet → alapterület → szintek → pince →
tetőfedés (pala → azbeszt figyelmeztetés) → közművek → konténer helye → kezdés.

Then one form: név, telefon, település, e-mail (optional), **magánszemély / cég /
intézmény / társasház**, preferred survey time (optional).

**Kezdés** is always Amint lehet / 30 / 60 / 90 napon belül; a typed later start
is politely refused (Banacraft only takes jobs starting within 3 months).

Load-bearing walls and new openings are never priced: the bot says a structural
engineer (statikus) is needed and flags it for the survey.

## Pricing

- **A floor, never a range.** Band answers are priced at their lower edge, "Nem
  tudom" at a modest default, and the assumption is printed. The number can only
  go up at the survey.
- **Debris is counted, not guessed:** every line carries a m³-per-unit figure,
  and the total fills 8 m³ containers.
- **VAT:** magánszemély and társasház see gross, cég and intézmény see net + ÁFA.
- **All rates live in `P` at the top of `lib/flow.js`.** They are
  market-calibrated starting points, **not Banacraft's own price list** - replace
  them with Banacraft's numbers as soon as they're known. `npm test` prints sample
  quotes, so a bad edit shows immediately.

## Run, test, deploy

```bash
npm install
npm start          # http://localhost:8894
npm test           # clicks through hundreds of random conversations + sample quotes
```

Environment variables: see `.env.example`. Deploy: push to a GitHub repo and import
it in Vercel (no build step). `GET /api/faq-agent?selftest=1` sends a test e-mail.

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
- **Stopped halfway:** the conversation so far (chat closed, page left, or 3 idle
  minutes; max 3 per conversation).
- **Zoho Flow:** same webhook contract as the NM Bau bot (`ZOHO_FLOW_WEBHOOK_URL`),
  with `quote_basis: "floor"`. Remove the `[TEMP zoho payload]` log line once the
  mapping is verified.

## Editing

- **Prices:** `P` in `lib/flow.js`.
- **Questions, buttons, order:** `FIELDS` and `fieldOrder()` in `lib/flow.js`.
- **What the AI may say about Banacraft:** `KNOWLEDGE` in `lib/flow.js`.
- **Greeting, teaser texts:** `BOT` at the top of `public/widget.js`.
- **Colours:** the variables at the top of `public/style.css`.
