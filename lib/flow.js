// ============================================================================
//  BANACRAFT - BELSŐ BONTÁS, ÉPÜLETBONTÁS, TÖRMELÉK-ELSZÁLLÍTÁS
//
//  Everything this bot knows about its trade: the questions (in order), their
//  buttons, the price model, and the facts the AI may repeat. The shared engine
//  in api/faq-agent.js reads only what is exported here.
//
//  PRICES ARE BANACRAFT'S OWN (Róbert, 2026-10-30 and 2026-11-05). Interior
//  demolition is priced per item and quantity, every line including haulage,
//  whatever the building. Budapest prices; Pest megye +10%, the surrounding
//  counties +20%; +10% per floor without a lift; no minimum job.
//
//  Not priced, a call instead: whole buildings and outbuildings ("sok a
//  változó"), panel partition walls, and anything further out than the counties
//  around Pest. Load-bearing walls are not demolished at all.
//
//  "Pontosan lehessen beírni a számokat": every quantity has buttons with
//  typical amounts AND takes the exact number typed. A button is priced at its
//  LOWER edge, so the number can only go up at the survey. All amounts are NET
//  Ft; the engine adds VAT for private customers.
// ============================================================================

export const BOT = {
    id: "banacraft-bontas",
    service: "belső bontás, épületbontás és törmelék-elszállítás",
    phone: "+36 70 625 2014",
    email: "info@banacraft.hu",
    maxStartDays: 60,
};

// ---------------------------------------------------------------------------
//  PRICES (net Ft, haulage included) - edit here only
// ---------------------------------------------------------------------------
const P = {
    burkolat: 5900,  // hideg és meleg burkolat, Ft / m²
    tegla: 8900,     // tégla válaszfal, Ft / m² of wall
    vakolat: 5900,   // up to 3–4 cm, Ft / m²
    gipsz: 4900,     // plasterboard with its profiles, Ft / m²
    beton: 1000,     // Ft per m² per cm
    nyilaszaro: 9900, // average-size window or door, Ft / db
    butor: 9900,     // Ft / piece
    falemez: 3900,   // Ft / m²
    perFloorNoLift: 0.1,
    region: { bp: 1, pest: 1.1, kornyek: 1.2 },
    // Reference rates for the owner's call on whole buildings, Ft / m².
    building: { fa: 18000, tegla: 35000, haz: 50000 },
};

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------
const opt = (label, value, extra) => ({ label, value, ...extra });
const NT = (extra) => opt("Nem tudom", "nem_tudom", extra);
const list = (sel, field) => String(sel[field] || "").split(",").filter(Boolean);
const num = (n) => String(Math.round(n * 10) / 10).replace(".", ",");
const ft = (n) => Math.round(n).toLocaleString("hu-HU").replace(/\s/g, " ") + " Ft";

function optionOf(field, sel) {
    const f = FIELDS[field];
    const opts = typeof f.options === "function" ? f.options(sel) : f.options;
    return opts.find((o) => o.value === sel[field]) || null;
}
const labelOf = (field, sel) => (optionOf(field, sel) || {}).label || "";

// A band button is its lower edge, "Nem tudom" its default, a typed number itself.
function numberOf(sel, field) {
    const o = optionOf(field, sel);
    if (o && o.n != null) return o.n;
    const n = parseFloat(String(sel[field] || "").replace(",", "."));
    return n > 0 ? n : 0;
}

// ---------------------------------------------------------------------------
//  QUESTIONS
// ---------------------------------------------------------------------------
const WHOLE = ["epulet", "mellek"];

const M2 = (p) => [
    opt("10 m² alatt", `${p}_lt10`, { n: 5 }), opt("10–25 m²", `${p}_10_25`, { n: 10 }), opt("25–50 m²", `${p}_25_50`, { n: 25 }),
    opt("50–100 m²", `${p}_50_100`, { n: 50 }), opt("100 m² felett", `${p}_gt100`, { n: 100 }), NT({ n: 10 }),
];
const PIECES = (p) => [
    opt("1–3 darab", `${p}_1`, { n: 1 }), opt("4–6 darab", `${p}_4`, { n: 4 }), opt("7–10 darab", `${p}_7`, { n: 7 }),
    opt("10-nél több", `${p}_10`, { n: 10 }), NT({ n: 1 }),
];
const WALL_HINT = "Egy átlagos fal kb. 3,5 × 2,7 m, azaz kb. 10 m².";

// The demolition items, and the quantity question each one brings with it.
const ITEMS = {
    burkolat: { label: "Csempe, járólap, parketta, laminált (burkolat)", line: "Hideg és meleg burkolat bontása", unit: "m²" },
    tegla: { label: "Tégla válaszfal", line: "Tégla válaszfal bontása", unit: "m²" },
    panelfal: { label: "Panel válaszfal", unit: null },
    vakolat: { label: "Vakolat leverése (3–4 cm-ig)", line: "Vakolat leverése 3–4 cm-ig", unit: "m²" },
    gipsz: { label: "Gipszkarton fal vagy álmennyezet", line: "Gipszkarton bontása profilokkal együtt", unit: "m²" },
    beton: { label: "Betonaljzat, betonvésés", unit: "m²" },
    nyilaszaro: { label: "Ablakok, ajtók", line: "Nyílászárók kibontása", unit: "db" },
    butor: { label: "Bútorok (szekrény, konyhabútor)", line: "Bútorok bontása", unit: "db" },
    falemez: { label: "Falemez, lambéria", line: "Falemez, lambéria bontása", unit: "m²" },
};
const qty = (key, q, extra) => ({
    type: "number",
    unit: ITEMS[key].unit,
    short: ITEMS[key].line || ITEMS[key].label,
    q,
    options: ITEMS[key].unit === "db" ? PIECES(key) : M2(key),
    ...extra,
});

export const FIELDS = {
    projectType: {
        short: "Bontás típusa",
        q: "Milyen bontásról van szó?",
        options: [opt("Belső bontás, felújítás előtt", "belso"), opt("Teljes ház bontása", "epulet"), opt("Melléképület, garázs bontása", "mellek")],
    },
    region: {
        short: "Helyszín",
        q: "Hol lesz a bontás?",
        hint: "Pest környéki megye: Nógrád, Heves, Jász-Nagykun-Szolnok, Bács-Kiskun, Fejér, Komárom-Esztergom.",
        options: [opt("Budapest", "bp"), opt("Pest megye", "pest"), opt("Pest környéki megye", "kornyek"), opt("Távolabb", "tavol")],
    },

    // --- Belső bontás ---
    access: {
        short: "Emelet / lift",
        q: "Hányadik szinten lesz a bontás, és van-e lift?",
        hint: "A törmeléket le kell hordani; lift nélkül emeletenként 10% a felár.",
        options: [
            opt("Földszint, vagy van lift", "f0", { floors: 0 }), opt("1. emelet, lift nélkül", "f1", { floors: 1 }),
            opt("2. emelet, lift nélkül", "f2", { floors: 2 }), opt("3. emelet, lift nélkül", "f3", { floors: 3 }),
            opt("4. emelet vagy feljebb, lift nélkül", "f4", { floors: 4 }),
        ],
    },
    scope: {
        type: "multi",
        short: "Bontandó",
        q: "Mit kell elbontani?",
        hint: "Jelöljön be mindent, ami érintett. Teherhordó falat nem bontunk.",
        options: Object.entries(ITEMS).map(([value, it]) => opt(it.label, value)),
    },
    burkolatM2: qty("burkolat", "Hány m² burkolatot kell felszedni vagy leverni?", { hint: "Padló és fal együtt." }),
    teglaM2: qty("tegla", "Hány m² tégla válaszfalat kell elbontani?", { hint: WALL_HINT }),
    vakolatM2: qty("vakolat", "Hány m² falfelületről kell a vakolatot leverni?"),
    gipszM2: qty("gipsz", "Hány m² gipszkartont kell elbontani?", { hint: "Falak és álmennyezet együtt." }),
    betonM2: qty("beton", "Mekkora felületen kell a betont felbontani vagy vésni?"),
    betonCm: {
        type: "number",
        unit: "cm",
        short: "Beton vastagsága",
        q: "Milyen vastag a beton?",
        hint: "Egy átlagos aljzatbeton 5–8 cm.",
        options: [opt("5 cm-ig", "c_5", { n: 3 }), opt("5–8 cm", "c_8", { n: 5 }), opt("8–12 cm", "c_12", { n: 8 }), opt("12 cm felett", "c_gt12", { n: 12 }), NT({ n: 5 })],
    },
    nyilaszaroDb: qty("nyilaszaro", "Hány ablakot és ajtót kell kibontani összesen?", { hint: "Átlagos méretű nyílászárókkal számolunk." }),
    butorDb: qty("butor", "Hány bútort kell elbontani?", { hint: "Darabonként számolunk (pl. egy szekrény, egy konyhai elem)." }),
    falemezM2: qty("falemez", "Hány m² falemezt vagy lambériát kell elbontani?"),

    // --- Teljes ház / melléképület: details for the call ---
    structure: {
        short: "Szerkezet",
        q: "Miből épült a melléképület?",
        options: [opt("Fa szerkezet, egyszerű tetővel", "fa"), opt("Tégla", "tegla"), opt("Egyéb, vegyes", "egyeb")],
    },
    bArea: {
        type: "number",
        unit: "m²",
        short: "Alapterület",
        q: "Mekkora az épület alapterülete?",
        options: [opt("20 m² alatt", "b_lt20", { n: 12 }), opt("20–50 m²", "b_20_50", { n: 20 }), opt("50–100 m²", "b_50_100", { n: 50 }), opt("100–200 m²", "b_100_200", { n: 100 }), opt("200 m² felett", "b_gt200", { n: 200 }), NT({ n: 50 })],
    },

    timeline: {
        short: "Kezdés",
        q: "Mikorra szeretné, hogy elkezdjük?",
        hint: "Legfeljebb 60 napon belül induló munkákat vállalunk.",
        options: [opt("Amint lehet", "asap"), opt("30 napon belül", "d30"), opt("60 napon belül", "d60")],
    },
};

// Each ticked item asks how much of it there is.
const QTY_FIELDS = { burkolat: ["burkolatM2"], tegla: ["teglaM2"], vakolat: ["vakolatM2"], gipsz: ["gipszM2"], beton: ["betonM2", "betonCm"], nyilaszaro: ["nyilaszaroDb"], butor: ["butorDb"], falemez: ["falemezM2"] };

export function fieldOrder(sel) {
    const pt = sel.projectType;
    if (!pt) return ["projectType"];
    if (sel.region === "tavol") return ["projectType", "region", "timeline"];
    if (pt === "mellek") return ["projectType", "region", "structure", "bArea", "timeline"];
    if (pt === "epulet") return ["projectType", "region", "bArea", "timeline"];
    const out = ["projectType", "region", "access", "scope"];
    for (const s of list(sel, "scope")) out.push(...(QTY_FIELDS[s] || []));
    out.push("timeline");
    return out;
}

export function title(sel) {
    return labelOf("projectType", sel) || "Bontás";
}

// ---------------------------------------------------------------------------
//  QUOTE
// ---------------------------------------------------------------------------
const pricedItems = (sel) => list(sel, "scope").filter((s) => s !== "panelfal");

export function callReason(sel) {
    if (sel.region === "tavol") return "Távolabbi helyszínre a munka méretétől függően megyünk ki - ezt kollégánk telefonon egyezteti Önnel.";
    if (WHOLE.includes(sel.projectType)) return "Épületbontásnál sok minden befolyásolja az árat (szerkezet, alapozás, közművek, engedélyek), ezért ezt kollégánk személyesen árazza.";
    if (sel.scope && !pricedItems(sel).length) return "A panel válaszfal bontását egyedileg árazzuk.";
    return null;
}

// Róbert's reference rates applied to the answers, for the owner's call only.
export function ownerNotes(sel) {
    if (!WHOLE.includes(sel.projectType) || !sel.bArea) return [];
    const A = numberOf(sel, "bArea");
    const k = P.region[sel.region] ?? 1;
    const rate = sel.projectType === "epulet" ? P.building.haz : sel.structure === "fa" ? P.building.fa : sel.structure === "tegla" ? P.building.tegla : null;
    if (!rate) return [`Kb. ${num(A)} m² vegyes szerkezetű melléképület - nincs tarifa.`];
    return [`Kb. ${num(A)} m² × ${ft(rate)}${k > 1 ? ` × ${String(k).replace(".", ",")} (régió)` : ""} = ${ft(A * rate * k)} + ÁFA.`];
}

const REGION_TEXT = "Budapesten, Pest megyében és a környező megyékben dolgozunk; nagyobb munkára távolabb is kimegyünk.";

export function buildQuote(sel, { money }) {
    const region = sel.region || "bp";
    const k = P.region[region];
    const floors = (optionOf("access", sel) || {}).floors || 0;
    const s = list(sel, "scope");
    const regionNote = k > 1 ? ` (${region === "pest" ? "Pest megye +10%" : "környező megye +20%"})` : "";

    const items = [];
    const unknown = [];
    for (const key of pricedItems(sel)) {
        if (key === "beton") {
            const m2 = numberOf(sel, "betonM2"), cm = numberOf(sel, "betonCm");
            items.push({ label: `Beton bontása, vésése (kb. ${num(m2)} m², ${num(cm)} cm)${regionNote}`, amount: m2 * cm * P.beton * k });
            if (sel.betonM2 === "nem_tudom" || sel.betonCm === "nem_tudom") unknown.push("a beton mennyiségét");
            continue;
        }
        const field = QTY_FIELDS[key][0];
        const n = numberOf(sel, field);
        items.push({ label: `${ITEMS[key].line} (${ITEMS[key].unit === "db" ? `${num(n)} db` : `kb. ${num(n)} m²`})${regionNote}`, amount: n * P[key] * k });
        if (sel[field] === "nem_tudom") unknown.push(ITEMS[key].label.toLowerCase().replace(/\s*\(.*\)$/, ""));
    }
    if (floors) {
        const sum = items.reduce((t, i) => t + i.amount, 0);
        items.push({ label: `Lift nélküli lehordás (${floors} emelet × 10%)`, amount: sum * P.perFloorNoLift * floors });
    }

    const ex = [];
    ex.push("A becslés a megadott mennyiségekkel számol; a gombok a sáv alsó értékével. Nagyobb mennyiségnél arányosan több.");
    if (unknown.length) ex.push(`Nem tudta pontosan: ${unknown.join(", ")} - ezt a felmérésen mérjük le.`);
    if (s.includes("panelfal")) ex.push("Panel válaszfal bontása: egyedi ár, a felmérés után.");
    if (s.includes("vakolat")) ex.push("4 cm-nél vastagabb vakolatnál felár lehet.");
    ex.push("Teherhordó falat nem bontunk.");
    ex.push("Azbesztgyanús anyag (pl. régi PVC-padló ragasztója, csőszigetelés): felmérés után, külön tételként.");
    ex.push("Ha a konténer csak közterületen tud állni, közterület-foglalási engedély kell - ennek díja külön.");
    ex.push("A közművek (víz, gáz, villany) szolgáltatói leválasztása külön.");
    ex.push(REGION_TEXT);

    return {
        title: title(sel),
        items,
        includes: "a felsorolt bontási munkákat, a törmelék lehordását, elszállítását a lerakói díjjal, valamint a rendezett, seprűtiszta átadást tartalmazza",
        exclusions: ex,
        flags: [],
    };
}

// ---------------------------------------------------------------------------
//  SANITY SCENARIOS - test-flow.mjs clicks these through. min/max are the exact
//  expected total, worked out by hand from Róbert's rates. The engine adds 27%
//  VAT for private customers and rounds each line to 1 000 Ft.
// ---------------------------------------------------------------------------
export const TEST_SCENARIOS = [
    {
        // burkolat 25 × 5 900 = 147 500 → 187 000; tégla 10 × 8 900 = 89 000 → 113 000;
        // 4 × 9 900 = 39 600 → 50 000; 1 bútor 9 900 → 13 000; 2 floors 20% of 286 000 = 57 200 → 73 000
        name: "Budapesti lakás, 2. emelet lift nélkül: burkolat, tégla fal, nyílászárók, bútor",
        answers: {
            projectType: "Belső bontás, felújítás előtt", region: "Budapest", access: "2. emelet, lift nélkül",
            scope: ["Csempe, járólap, parketta, laminált (burkolat)", "Tégla válaszfal", "Ablakok, ajtók", "Bútorok (szekrény, konyhabútor)"],
            burkolatM2: "25–50 m²", teglaM2: "10–25 m²", nyilaszaroDb: "4–6 darab", butorDb: "1–3 darab", timeline: "30 napon belül",
        },
        min: 436000, max: 436000,
    },
    {
        // beton 25 m² × 5 cm × 1 000 × 1,1 = 137 500 → 175 000; vakolat 50 × 5 900 × 1,1 = 324 500 → 412 000
        name: "Pest megyei ház, földszint: betonaljzat és vakolat",
        answers: {
            projectType: "Belső bontás, felújítás előtt", region: "Pest megye", access: "Földszint, vagy van lift",
            scope: ["Vakolat leverése (3–4 cm-ig)", "Betonaljzat, betonvésés"],
            vakolatM2: "50–100 m²", betonM2: "25–50 m²", betonCm: "5–8 cm", timeline: "Amint lehet",
        },
        min: 587000, max: 587000,
    },
    {
        // company, net: typed 37 m² gipsz × 4 900 = 181 300 → 181 000; falemez 10 × 3 900 = 39 000
        name: "Iroda, cég: 37 m² gipszkarton (beírt szám) + falemez",
        answers: {
            projectType: "Belső bontás, felújítás előtt", region: "Budapest", access: "Földszint, vagy van lift",
            scope: ["Gipszkarton fal vagy álmennyezet", "Falemez, lambéria"], gipszM2: "37", falemezM2: "10–25 m²", timeline: "30 napon belül",
        },
        customer: "Cég",
        min: 220000, max: 220000,
    },
    {
        name: "Tégla melléképület (egyedi ajánlat)",
        answers: { projectType: "Melléképület, garázs bontása", region: "Budapest", structure: "Tégla", bArea: "20–50 m²", timeline: "30 napon belül" },
        call: true,
    },
    {
        name: "Csak panel válaszfal (egyedi ajánlat)",
        answers: { projectType: "Belső bontás, felújítás előtt", region: "Budapest", access: "Földszint, vagy van lift", scope: ["Panel válaszfal"], timeline: "30 napon belül" },
        call: true,
    },
];

// ---------------------------------------------------------------------------
//  WHAT THE AI MAY SAY ABOUT THE COMPANY (from the Banacraft épületbontás site)
// ---------------------------------------------------------------------------
export const KNOWLEDGE = `- Belső terek pontos bontása, azonnali kezdéssel, a törmelék elszállításával együtt. Teljes épületek és melléképületek bontását is vállaljuk kisgépekkel és konténerrel; ezeket helyszíni felmérés után, egyedileg árazzuk.
- Amit bontunk: hideg és meleg burkolatok (csempe, járólap, parketta, laminált), vakolat, tégla és gipszkarton válaszfalak, álmennyezetek, beton- és esztrichaljzatok, betonvésés, falemez és lambéria, nyílászárók, bútorok. A panel válaszfalat egyedileg árazzuk.
- Teherhordó falat nem bontunk.
- Irodáknak, lakásoknak, házaknak, üzlethelyiségeknek dolgozunk; az épület típusa nem számít.
- A bontási törmeléket elszállítjuk a kijelölt hulladékfeldolgozó üzembe - nem az ügyfél gondja lesz utólag.
- A teljes épületbontáshoz bontási engedély és leválasztott közművek kellenek; a leválasztásokat előre egyeztetjük.
- Ha a bontandó anyag azbesztet tartalmaz, azonosítjuk, elkülönítve kezeljük, szabályosan elszállítjuk és dokumentáljuk; ehhez saját engedélyünk van.
- Közterületen álló konténerhez közterület-foglalási engedély kell.
- Tiszta, rendezett területet adunk át, a következő munkafázishoz készen.
- Pontos munkavégzés a megbeszéltek szerint; előre tisztázott, írásos ajánlat, utólagos meglepetések nélkül; számlát adunk.
- Felelősségbiztosítással dolgozunk, a munkára garanciát vállalunk.
- Budapesten, Pest megyében és a környező megyékben dolgozunk; nagyobb munkára távolabb is kimegyünk.
- Ingyenes, kötelezettség nélküli helyszíni felmérés; a végleges ajánlatot a felmérés után adjuk.`;
