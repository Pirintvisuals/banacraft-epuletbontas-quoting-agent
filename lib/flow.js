// ============================================================================
//  BANACRAFT - BELSŐ BONTÁS, ÉPÜLETBONTÁS, TÖRMELÉK-ELSZÁLLÍTÁS
//
//  Everything this bot knows about its trade: the questions (in order), their
//  buttons, the price model, and the facts the AI may repeat. The shared engine
//  in api/faq-agent.js reads only what is exported here.
//
//  The interior flow is deliberately detailed: "what exactly comes out" is what
//  moves a demolition price, so every ticked item gets its own short follow-up
//  (how much of it), and the scope list names the jobs people actually ask for -
//  tile chiselling, window and door removal, cable chases.
//
//  PRICING PRINCIPLE - a floor, never a range. Every band answer is priced at
//  its LOWER edge and "Nem tudom" at a modest default, so the number the
//  customer sees can only go UP at the survey, and the assumption behind it is
//  printed next to it. All amounts are NET Ft; the engine adds VAT for private
//  customers.
//
//  THE RATES ARE MARKET-CALIBRATED STARTING POINTS, NOT BANACRAFT'S OWN PRICE
//  LIST (2026 Budapest bontási munkadíjak, konténerárak). Replace the numbers in
//  `P` with Banacraft's real rates as soon as they are known.
// ============================================================================

export const BOT = {
    id: "banacraft-bontas",
    service: "belső bontás, épületbontás és törmelék-elszállítás",
    phone: "+36 70 625 2014",
    email: "info@banacraft.hu",
};

// ---------------------------------------------------------------------------
//  PRICES (net Ft) - edit here only
// ---------------------------------------------------------------------------
const P = {
    // Labour per unit (m², db or fm - see the quote lines below).
    rate: {
        teljes: 14000,     // Ft / m² floor: floors, wall tiles, plaster where loose, ceilings, fittings, pipework
        padlocsempe: 3200, // Ft / m²
        padlo: 1400,       // Ft / m² - parquet, laminate, PVC, carpet
        falicsempe: 3500,  // Ft / m² of wall
        vakolat: 3000,     // Ft / m² of wall
        aljzat: 6500,      // Ft / m², up to 8 cm
        valaszfal: 6000,   // Ft / m² of wall, 10 cm brick
        mennyezet: 2200,   // Ft / m²
        fa: 2000,          // Ft / m²
        nyilaszaro: 8000,  // Ft / db
        veses: 2800,       // Ft / fm, brick
        attores: 45000,    // Ft / opening, once the structural engineer has signed it off
        furdo: 45000,      // per bathroom: bath, WC, basin, fittings
        konyha: 35000,     // per kitchen
        gepeszet: 1200,    // Ft / m² floor
    },
    // m³ of debris per unit of the same lines - what fills the containers.
    debris: {
        teljes: 0.22, padlocsempe: 0.03, padlo: 0.02, falicsempe: 0.025, vakolat: 0.03, aljzat: 0.07,
        valaszfal: 0.12, mennyezet: 0.03, fa: 0.03, nyilaszaro: 0.3, veses: 0.005, attores: 0.3,
        furdo: 1.5, konyha: 2.5, gepeszet: 0.01,
    },
    container: { m3: 8, price: 78000 }, // 8 m³ skip incl. transport and landfill fee
    extent: { e1: 0.3, e2: 0.65, e3: 1 }, // share of the area, for floors and screed
    wallTile: { t1: 18, t2: 30, t3: 48 }, // m² of wall tiles by room count (lower edge)
    wallSurface: 2.5,                     // wall m² per floor m² in a typical flat
    plaster: { p1: 0.15, p2: 0.4, p3: 1 },
    wallCount: { w1: 1, w2: 2, w4: 4 },   // lower edge of the band
    wallM2: 9.5,                          // one partition: ~3.5 m × 2.7 m
    ceilingShare: 0.4,
    woodShare: 0.2, woodMin: 10,
    openings: { o1: 1, o4: 4, o7: 7, o10: 10 },
    chase: { c1: 10, c2: 20, c3: 60 },    // fm
    material: { tegla: 1, gk: 0.45, beton: 1.6, vegyes: 1.2, nem_tudom: 1 },
    access: { fsz: 1, l13: 1.05, n13: 1.15, l4: 1.1, n4: 1.3, h_fsz: 1, h_em: 1.1, h_tobb: 1.12 },
    occupancy: { ures: [1, 0], butor: [1.06, 25000], lakott: [1.12, 40000] }, // [labour ×, dust protection Ft]
    cleaning: 1100,   // after-build deep clean, Ft / m²
    minJob: 60000,

    // Whole buildings, Ft / m² of floor area (all storeys), demolition + haulage.
    building: { tegla: 26000, valyog: 21000, beton: 38000, fa: 15000, vegyes: 30000, nem_tudom: 26000 },
    levels: { b1: 1, b15: 1.5, b2: 2, b3: 3 },
    basement: 15000,  // Ft / m² of footprint
    buildingLabourShare: 0.55,
    mellekFactor: 0.9,
    minBuilding: 900000,
    minMellek: 250000,
};

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------
const opt = (label, value, extra) => ({ label, value, ...extra });
const NT = (extra) => opt("Nem tudom", "nem_tudom", extra);
const list = (sel, field) => String(sel[field] || "").split(",").filter(Boolean);
const num = (n) => String(Math.round(n * 10) / 10).replace(".", ",");
const r1 = (n) => Math.max(1, Math.round(n));

function optionOf(field, sel) {
    const f = FIELDS[field];
    const opts = typeof f.options === "function" ? f.options(sel) : f.options;
    return opts.find((o) => o.value === sel[field]) || null;
}
const labelOf = (field, sel) => (optionOf(field, sel) || {}).label || "";

function areaOf(sel, field) {
    const o = optionOf(field, sel);
    if (o && o.area != null) return o.area;
    const n = parseFloat(String(sel[field] || "").replace(",", "."));
    return n > 0 ? n : 0;
}

function topUp(items, min) {
    const sum = items.reduce((s, i) => s + i.amount, 0);
    if (sum < min) items.push({ label: "Kiegészítés a minimális díjig (kiszállás, munkadíj)", amount: min - sum });
    return items;
}

// ---------------------------------------------------------------------------
//  QUESTIONS
// ---------------------------------------------------------------------------
const HOUSE = ["haz", "tobbszint"];
const WHOLE = ["epulet", "mellek"];

const TIMELINE = {
    short: "Kezdés",
    q: "Mikorra szeretné, hogy elkezdjük?",
    hint: "Legfeljebb 3 hónapon belül induló munkákat vállalunk.",
    options: [opt("Amint lehet", "asap"), opt("30 napon belül", "d30"), opt("60 napon belül", "d60"), opt("90 napon belül", "d90")],
};

const ACCESS_FLAT = [opt("Földszint", "fsz"), opt("1–3. emelet, lifttel", "l13"), opt("1–3. emelet, lift nélkül", "n13"), opt("4. emelet vagy feljebb, lifttel", "l4"), opt("4. emelet vagy feljebb, lift nélkül", "n4")];
const ACCESS_HOUSE = [opt("Csak a földszinten", "h_fsz"), opt("Csak az emeleten vagy a tetőtérben", "h_em"), opt("Több szinten is", "h_tobb")];
const EXTENT = [opt("Egy-két helyiségben", "e1"), opt("A terület nagyobb részén", "e2"), opt("Az egész területen", "e3")];

const AREA_INTERIOR = [opt("20 m² alatt", "i_lt20", { area: 12 }), opt("20–50 m²", "i_20_50", { area: 20 }), opt("50–80 m²", "i_50_80", { area: 50 }), opt("80–120 m²", "i_80_120", { area: 80 }), opt("120–200 m²", "i_120_200", { area: 120 }), opt("200 m² felett", "i_gt200", { area: 200 }), NT({ area: 30 })];
const AREA_BUILDING = [opt("60 m² alatt", "b_lt60", { area: 45 }), opt("60–100 m²", "b_60_100", { area: 60 }), opt("100–150 m²", "b_100_150", { area: 100 }), opt("150–250 m²", "b_150_250", { area: 150 }), opt("250 m² felett", "b_gt250", { area: 250 }), NT({ area: 80 })];
const AREA_SHED = [opt("20 m² alatt", "m_lt20", { area: 12 }), opt("20–40 m²", "m_20_40", { area: 20 }), opt("40–80 m²", "m_40_80", { area: 40 }), opt("80 m² felett", "m_gt80", { area: 80 }), NT({ area: 20 })];

const LOAD_BEARING_NOTE = "Ehhez **statikus szakvélemény** kell - a helyszíni felmérésen tisztázzuk, és külön árazzuk.";

export const FIELDS = {
    projectType: {
        short: "Bontás típusa",
        q: "Milyen bontásról van szó?",
        options: [opt("Belső bontás, felújítás előtt", "belso"), opt("Teljes épület bontása", "epulet"), opt("Melléképület, garázs bontása", "mellek")],
    },

    // --- Belső bontás ---
    building: {
        short: "Épület",
        q: "Milyen épületben lesz a bontás?",
        options: [
            opt("Panellakás", "panel"), opt("Téglalakás", "tegla"), opt("Családi ház", "haz"), opt("Többszintes ház", "tobbszint"),
            opt("Iroda, üzlethelyiség", "iroda"), opt("Ipari épület, csarnok", "ipari"), opt("Egyéb", "egyeb"),
        ],
    },
    levels: {
        short: "Szintek",
        q: "Hány szintes az épület?",
        options: [opt("Földszintes", "l1"), opt("Két szintes (földszint + emelet vagy tetőtér)", "l2"), opt("Három vagy több szintes", "l3")],
    },
    access: {
        short: "Emelet / szint",
        q: (sel) => HOUSE.includes(sel.building) ? "Melyik szinten lesz a bontás?" : "Hányadik emeleten van, és van-e lift?",
        hint: "A törmeléket le kell hordani, ezért számít.",
        options: (sel) => HOUSE.includes(sel.building) ? ACCESS_HOUSE : ACCESS_FLAT,
        values: [...ACCESS_FLAT, ...ACCESS_HOUSE].map((o) => o.value),
    },
    area: {
        type: "area",
        short: "Terület",
        q: "Mekkora területen lesz a bontás?",
        hint: "Az érintett helyiségek alapterülete összesen - elég nagyjából, konkrét számot is írhat.",
        options: AREA_INTERIOR,
    },
    scope: {
        type: "multi",
        short: "Bontandó",
        q: "Pontosan mit kell elbontani?",
        hint: "Jelöljön be mindent, ami érintett.",
        options: [
            opt("Teljes belső bontás, csupasz falig", "teljes"),
            opt("Padlócsempe, járólap", "padlocsempe"),
            opt("Parketta, laminált, PVC, szőnyeg", "padlo"),
            opt("Falicsempe vésése", "falicsempe"),
            opt("Vakolat leverése", "vakolat"),
            opt("Aljzatbeton, esztrich", "aljzat"),
            opt("Válaszfal", "valaszfal"),
            opt("Álmennyezet, gipszkarton mennyezet", "mennyezet"),
            opt("Nyílászárók (ablak, ajtó)", "nyilaszaro"),
            opt("Vésés (vezetékhorony, áttörés)", "veses"),
            opt("Fürdőszoba berendezés", "furdo"),
            opt("Konyhabútor", "konyha"),
            opt("Fa szerkezet, lambéria", "fa"),
            opt("Víz-, villany-, fűtésvezetékek", "gepeszet"),
        ],
        after: (sel) => list(sel, "scope").includes("teljes")
            ? "A teljes belső bontás a burkolatokat, a laza vakolatot, a mennyezeteket, a berendezéseket és a vezetékeket is magában foglalja."
            : null,
    },
    floorExtent: {
        short: "Padlóburkolat",
        q: "Mekkora részen kell a padlóburkolatot felszedni?",
        options: EXTENT,
    },
    wallTileRooms: {
        short: "Falicsempe",
        q: "Hány helyiségben kell falicsempét leverni?",
        options: [opt("1 helyiségben (pl. fürdő)", "t1"), opt("2 helyiségben (pl. fürdő és konyha)", "t2"), opt("3 vagy több helyiségben", "t3")],
    },
    plasterExtent: {
        short: "Vakolat",
        q: "Mekkora felületről kell a vakolatot leverni?",
        options: [opt("Néhány falról", "p1"), opt("Egy-két helyiség falairól", "p2"), opt("Az egész terület falairól", "p3")],
    },
    screedExtent: {
        short: "Aljzat",
        q: "Mekkora részen kell az aljzatbetont felbontani?",
        hint: "8 cm vastagságig számolunk.",
        options: EXTENT,
    },
    wallCount: {
        short: "Válaszfalak",
        q: "Hány válaszfalat kell elbontani?",
        hint: "Egy átlagos fal kb. 3,5 méter hosszú.",
        options: [opt("1 falat", "w1"), opt("2–3 falat", "w2"), opt("4 vagy több falat", "w4")],
    },
    openings: {
        short: "Nyílászárók",
        q: "Hány ablakot és ajtót kell kibontani összesen?",
        options: [opt("1–3 darabot", "o1"), opt("4–6 darabot", "o4"), opt("7–10 darabot", "o7"), opt("10-nél többet", "o10")],
    },
    chase: {
        short: "Vésés",
        q: "Milyen vésésre van szükség?",
        options: [
            opt("Néhány méter (pár új dugalj, kapcsoló)", "c1"),
            opt("Egy helyiség vezetékei (kb. 20–40 fm)", "c2"),
            opt("Egész lakás vagy ház vezetékei (60 fm felett)", "c3"),
            opt("Fal vagy födém áttörése, új nyílás", "c4"),
        ],
        after: (sel) => sel.chase === "c4" ? LOAD_BEARING_NOTE : null,
    },
    wallMaterial: {
        short: "Falazat",
        q: "Miből vannak a bontandó falak?",
        hint: (sel) => sel.building === "panel" ? "Panelházban a falak jellemzően betonból vannak." : null,
        options: [opt("Tégla", "tegla"), opt("Gipszkarton", "gk"), opt("Beton, vasbeton", "beton"), opt("Vegyes", "vegyes"), NT()],
    },
    loadBearing: {
        short: "Teherhordó fal",
        q: "Érint-e a bontás teherhordó falat, vagy kell-e új nyílást vágni?",
        options: [opt("Nem", "nem"), opt("Igen", "igen"), NT()],
        after: (sel) => sel.loadBearing && sel.loadBearing !== "nem" ? LOAD_BEARING_NOTE : null,
    },
    occupancy: {
        short: "Állapot a munka alatt",
        q: "Milyen állapotban lesz az ingatlan a bontás alatt?",
        options: [opt("Teljesen üres", "ures"), opt("Bútorozott, de nem lakják", "butor"), opt("Lakott", "lakott")],
    },
    container: {
        short: "Konténer helye",
        q: (sel) => WHOLE.includes(sel.projectType) ? "Hol tud megállni a konténer és a munkagép?" : "Hol tud megállni a konténer vagy a teherautó?",
        options: [opt("A ház előtt vagy az udvarban", "udvar"), opt("Csak közterületen (az utcán)", "kozter"), NT()],
    },
    cleaning: {
        short: "Takarítás",
        q: "Kér takarítást a bontás után?",
        hint: "A rendezett, seprűtiszta átadás minden munkánk része.",
        options: [opt("Nem, elég a seprűtiszta átadás", "nem"), opt("Igen, építés utáni nagytakarítást kérek", "igen")],
    },

    // --- Teljes épület / melléképület ---
    structure: {
        short: "Szerkezet",
        q: "Miből épült az épület?",
        options: [opt("Tégla", "tegla"), opt("Vályog", "valyog"), opt("Beton, vasbeton, panel", "beton"), opt("Fa vagy könnyűszerkezet", "fa"), opt("Vegyes", "vegyes"), NT()],
    },
    bArea: {
        type: "area",
        short: "Alapterület",
        q: "Mekkora az épület alapterülete?",
        hint: "Elég nagyjából - konkrét számot is írhat.",
        options: (sel) => sel.projectType === "mellek" ? AREA_SHED : AREA_BUILDING,
        values: [...new Set([...AREA_BUILDING, ...AREA_SHED].map((o) => o.value))],
    },
    bLevels: {
        short: "Szintek",
        q: "Hány szintes az épület?",
        options: [opt("Földszintes", "b1"), opt("Földszint és beépített tetőtér", "b15"), opt("Emeletes", "b2"), opt("Kettőnél több szint", "b3")],
    },
    basement: {
        short: "Pince",
        q: "Van-e pince, amit szintén el kell bontani?",
        options: [opt("Nincs pince", "nincs"), opt("Van, azt is bontani kell", "igen"), opt("Van, de marad", "marad")],
    },
    roofType: {
        short: "Tetőfedés",
        q: "Mi van most a tetőn?",
        options: [opt("Cserép", "cserep"), opt("Lemez", "lemez"), opt("Pala (hullámpala vagy síkpala)", "pala"), opt("Bitumenes lemez, zsindely", "bitumen"), NT()],
        after: (sel) => sel.roofType === "pala"
            ? "A régi pala azbesztet tartalmazhat - ennek a szabályos, engedélyes bontását is vállaljuk, külön tételként."
            : null,
    },
    utilities: {
        short: "Közművek",
        q: "Le vannak már kötve a közművek (víz, gáz, villany)?",
        options: [opt("Igen, le vannak kötve", "igen"), opt("Még nincsenek", "nem"), NT()],
    },

    timeline: TIMELINE,
};

export function fieldOrder(sel) {
    const pt = sel.projectType;
    if (!pt) return ["projectType"];
    if (WHOLE.includes(pt)) {
        return ["projectType", "structure", "bArea", ...(pt === "epulet" ? ["bLevels", "basement"] : []), "roofType", "utilities", "container", "timeline"];
    }
    const out = ["projectType", "building"];
    if (HOUSE.includes(sel.building)) {
        out.push("levels");
        if (sel.levels && sel.levels !== "l1") out.push("access");
    } else if (sel.building && sel.building !== "ipari") {
        out.push("access");
    }
    out.push("area", "scope");
    const s = list(sel, "scope");
    const full = s.includes("teljes");
    if (!full && (s.includes("padlocsempe") || s.includes("padlo"))) out.push("floorExtent");
    if (!full && s.includes("falicsempe")) out.push("wallTileRooms");
    if (!full && s.includes("vakolat")) out.push("plasterExtent");
    if (s.includes("aljzat")) out.push("screedExtent");
    if (s.includes("valaszfal")) out.push("wallCount");
    if (s.includes("nyilaszaro")) out.push("openings");
    if (s.includes("veses")) out.push("chase");
    if (full || s.some((x) => ["valaszfal", "veses", "vakolat"].includes(x))) out.push("wallMaterial");
    out.push("loadBearing", "occupancy", "container", "cleaning", "timeline");
    return out;
}

export function title(sel) {
    if (sel.projectType === "belso") return sel.building ? `Belső bontás - ${labelOf("building", sel)}` : "Belső bontás";
    return labelOf("projectType", sel) || "Bontás";
}

// ---------------------------------------------------------------------------
//  QUOTE - returns net amounts; the engine applies VAT and rounding
// ---------------------------------------------------------------------------
const REGION = "Budapesten és környékén dolgozunk; távolabbi helyszínen kiszállási díj lehet.";

export function buildQuote(sel, { money }) {
    return WHOLE.includes(sel.projectType) ? quoteBuilding(sel, money) : quoteInterior(sel, money);
}

function quoteInterior(sel, money) {
    const R = P.rate, D = P.debris;
    const A = areaOf(sel, "area");
    const s = list(sel, "scope");
    const full = s.includes("teljes");
    const wm = sel.wallMaterial;
    const mat = P.material[wm] ?? 1;
    const concrete = wm === "beton";
    const k = (P.access[sel.access] ?? 1) * ((P.occupancy[sel.occupancy] || [1])[0]);

    const lines = [];
    const add = (label, labour, debris) => lines.push({ label, labour, debris });

    if (full) {
        add(`Teljes belső bontás csupasz falig (kb. ${num(A)} m²)`, A * R.teljes * (concrete ? 1.15 : 1), A * D.teljes);
    } else {
        const ext = P.extent[sel.floorExtent] ?? 1;
        const both = s.includes("padlocsempe") && s.includes("padlo");
        if (s.includes("padlocsempe")) {
            const q = r1(A * ext * (both ? 0.5 : 1));
            add(`Padlócsempe, járólap felszedése (kb. ${q} m²)`, q * R.padlocsempe, q * D.padlocsempe);
        }
        if (s.includes("padlo")) {
            const q = r1(A * ext * (both ? 0.5 : 1));
            add(`Parketta, laminált, PVC felszedése (kb. ${q} m²)`, q * R.padlo, q * D.padlo);
        }
        if (s.includes("falicsempe")) {
            const q = P.wallTile[sel.wallTileRooms] ?? P.wallTile.t1;
            add(`Falicsempe vésése (kb. ${q} m²)`, q * R.falicsempe, q * D.falicsempe);
        }
        if (s.includes("vakolat")) {
            const q = r1(P.wallSurface * A * (P.plaster[sel.plasterExtent] ?? P.plaster.p1));
            add(`Vakolat leverése (kb. ${q} m² falfelület)`, q * R.vakolat * (concrete ? 1.1 : 1), q * D.vakolat);
        }
        if (s.includes("mennyezet")) {
            const q = r1(A * P.ceilingShare);
            add(`Álmennyezet, gipszkarton mennyezet bontása (kb. ${q} m²)`, q * R.mennyezet, q * D.mennyezet);
        }
        if (s.includes("fa")) {
            const q = Math.max(P.woodMin, r1(A * P.woodShare));
            add(`Fa szerkezet, lambéria bontása (kb. ${q} m²)`, q * R.fa, q * D.fa);
        }
        if (s.includes("furdo")) add("Fürdőszoba berendezés leszerelése (kád, WC, mosdó)", R.furdo, D.furdo);
        if (s.includes("konyha")) add("Konyhabútor bontása", R.konyha, D.konyha);
        if (s.includes("gepeszet")) add(`Víz-, villany-, fűtésvezetékek kibontása (kb. ${num(A)} m²)`, A * R.gepeszet, A * D.gepeszet);
    }
    if (s.includes("aljzat")) {
        const q = r1(A * (P.extent[sel.screedExtent] ?? 1));
        add(`Aljzatbeton bontása 8 cm-ig (kb. ${q} m²)`, q * R.aljzat, q * D.aljzat);
    }
    if (s.includes("valaszfal")) {
        const q = r1((P.wallCount[sel.wallCount] ?? 1) * P.wallM2);
        add(`Válaszfal bontása (kb. ${q} m² falfelület)`, q * R.valaszfal * mat, q * D.valaszfal * (wm === "gk" ? 0.35 : 1));
    }
    if (s.includes("nyilaszaro")) {
        const n = P.openings[sel.openings] ?? 1;
        add(`Nyílászárók kibontása (${n} db)`, n * R.nyilaszaro, n * D.nyilaszaro);
    }
    if (s.includes("veses")) {
        if (sel.chase === "c4") {
            add("Fal- vagy födémáttörés (1 db, statikus jóváhagyás után)", R.attores * (concrete ? 1.6 : 1), D.attores);
        } else {
            const fm = P.chase[sel.chase] ?? P.chase.c1;
            add(`Vésés, vezetékhorony (kb. ${fm} fm)`, fm * R.veses * (wm === "gk" ? 0.5 : mat), fm * D.veses);
        }
    }

    const items = lines.map((l) => ({ label: l.label, amount: l.labour * k }));
    const protect = (P.occupancy[sel.occupancy] || [1, 0])[1];
    if (protect) items.push({ label: "Por- és útvonalvédelem, takarás", amount: protect });
    const vol = lines.reduce((t, l) => t + l.debris, 0);
    const skips = Math.max(1, Math.ceil(vol / P.container.m3));
    items.push({ label: `Törmelék elszállítása és lerakói díj (${skips} db ${P.container.m3} m³-es konténer)`, amount: skips * P.container.price });
    if (sel.cleaning === "igen") items.push({ label: `Építés utáni nagytakarítás (kb. ${num(A)} m²)`, amount: A * P.cleaning });
    topUp(items, P.minJob);

    const ex = [];
    ex.push(`A becslés **kb. ${num(A)} m²** területtel számol${sel.area === "nem_tudom" ? " (nem tudta pontosan)" : ""}; nagyobb felületnél arányosan több.`);
    ex.push(`Ha a törmelék a becsültnél több, további konténerenként ${money(P.container.price)}.`);
    if (s.includes("aljzat")) ex.push("8 cm-nél vastagabb vagy vasalt aljzatnál felár.");
    if (wm === "nem_tudom") ex.push("Beton, vasbeton falaknál felár.");
    ex.push("Azbesztgyanús anyag (pl. régi PVC-padló ragasztója, csőszigetelés): felmérés után, elkülönített, szabályos elszállítással, külön tételként.");
    if (sel.container !== "udvar") ex.push("Közterületen álló konténerhez közterület-foglalási engedély kell - ennek díja külön.");
    ex.push("A közművek (víz, gáz, villany) szolgáltatói leválasztása külön.");
    if (sel.cleaning !== "igen") ex.push(`Építés utáni nagytakarítás, ha kéri: ${money(P.cleaning)}/m²-től.`);
    ex.push(REGION);

    const flags = [];
    if (sel.loadBearing !== "nem" || sel.chase === "c4") {
        flags.push("Teherhordó fal vagy új nyílás csak statikus szakvélemény alapján bontható - ezt a felmérésen tisztázzuk, és külön árazzuk.");
    }

    return {
        title: title(sel),
        items,
        includes: "a felsorolt bontási munkákat, a törmelék zsákolását és lehordását, a konténert, az elszállítást a lerakói díjjal, valamint a rendezett, seprűtiszta átadást tartalmazza",
        exclusions: ex,
        flags,
    };
}

function quoteBuilding(sel, money) {
    const shed = sel.projectType === "mellek";
    const A = areaOf(sel, "bArea");
    const floorM2 = A * (shed ? 1 : (P.levels[sel.bLevels] ?? 1));
    const rate = (P.building[sel.structure] ?? P.building.nem_tudom) * (shed ? P.mellekFactor : 1);
    const base = floorM2 * rate;

    const items = [
        { label: `Gépi és kézi bontás (kb. ${num(floorM2)} m² szintterület)`, amount: base * P.buildingLabourShare },
        { label: "Törmelék rakodása, elszállítása és lerakói díj", amount: base * (1 - P.buildingLabourShare) },
    ];
    if (!shed && sel.basement === "igen") items.push({ label: `Pince bontása (kb. ${num(A)} m²)`, amount: A * P.basement });
    topUp(items, shed ? P.minMellek : P.minBuilding);

    const ex = [];
    ex.push(`A becslés **kb. ${num(A)} m²** alapterülettel számol${sel.bArea === "nem_tudom" ? " (nem tudta pontosan)" : ""}; nagyobb épületnél arányosan több (${money(rate)}/m² szintterület).`);
    if (sel.structure === "nem_tudom") ex.push("Beton, vasbeton szerkezetnél felár.");
    if (sel.roofType === "nem_tudom") ex.push("Ha a tetőn pala van, annak szabályos bontása és elszállítása külön tétel.");
    if (!shed && sel.basement === "nincs") ex.push("Az alapozás kiszedése és a terep feltöltése, rendezése külön.");
    if (!shed && sel.basement === "marad") ex.push("A megmaradó pince lefedése, a terep rendezése külön.");
    if (shed) ex.push("Az alaplemez, az alapozás kiszedése külön.");
    if (sel.utilities !== "igen") ex.push("A közművek (víz, gáz, villany) leválasztását a szolgáltatóval előre intézni kell.");
    ex.push("A bontási engedély vagy bejelentés ügyintézése, ha szükséges.");
    if (sel.container !== "udvar") ex.push("Közterület-foglalás engedélye és díja külön.");
    ex.push("Veszélyes anyagok (azbeszt, kátrány, olajos föld) külön tételként.");
    ex.push(REGION);

    const flags = [];
    if (sel.roofType === "pala") flags.push("A palatető azbesztet tartalmazhat: szabályos, engedélyes bontása és elszállítása külön tétel - ezt is vállaljuk.");

    return {
        title: title(sel),
        items,
        includes: "a gépi és kézi bontást, a törmelék rakodását, elszállítását a lerakói díjjal és a terület rendezett átadását tartalmazza",
        exclusions: ex,
        flags,
    };
}

// ---------------------------------------------------------------------------
//  SANITY SCENARIOS - test-flow.mjs clicks these through and prints the price.
//  min/max are loose market envelopes (gross Ft for private customers).
// ---------------------------------------------------------------------------
export const TEST_SCENARIOS = [
    {
        name: "Panellakás 50–80 m², 4. em. lifttel: padlócsempe + falicsempe 2 helyiség + fürdő + konyha, lakott",
        answers: {
            projectType: "Belső bontás, felújítás előtt", building: "Panellakás", access: "4. emelet vagy feljebb, lifttel", area: "50–80 m²",
            scope: ["Padlócsempe, járólap", "Falicsempe vésése", "Fürdőszoba berendezés", "Konyhabútor"],
            floorExtent: "Az egész területen", wallTileRooms: "2 helyiségben (pl. fürdő és konyha)", loadBearing: "Nem", occupancy: "Lakott",
            container: "A ház előtt vagy az udvarban", cleaning: "Nem, elég a seprűtiszta átadás", timeline: "30 napon belül",
        },
        min: 350000, max: 2000000,
    },
    {
        name: "Téglalakás 80–120 m², teljes belső bontás + aljzat + 2–3 válaszfal, üres, közterület, nagytakarítás",
        answers: {
            projectType: "Belső bontás, felújítás előtt", building: "Téglalakás", access: "1–3. emelet, lift nélkül", area: "80–120 m²",
            scope: ["Teljes belső bontás, csupasz falig", "Aljzatbeton, esztrich", "Válaszfal"],
            screedExtent: "Az egész területen", wallCount: "2–3 falat", wallMaterial: "Tégla", loadBearing: "Nem", occupancy: "Teljesen üres",
            container: "Csak közterületen (az utcán)", cleaning: "Igen, építés utáni nagytakarítást kérek", timeline: "Amint lehet",
        },
        min: 2000000, max: 8000000,
    },
    {
        name: "Kétszintes családi ház, emeleten, 20–50 m²: 4–6 nyílászáró + vésés egy helyiség, teherhordó: nem tudom",
        answers: {
            projectType: "Belső bontás, felújítás előtt", building: "Családi ház", levels: "Két szintes (földszint + emelet vagy tetőtér)",
            access: "Csak az emeleten vagy a tetőtérben", area: "20–50 m²",
            scope: ["Nyílászárók (ablak, ajtó)", "Vésés (vezetékhorony, áttörés)"],
            openings: "4–6 darabot", chase: "Egy helyiség vezetékei (kb. 20–40 fm)", wallMaterial: "Tégla", loadBearing: "Nem tudom",
            occupancy: "Bútorozott, de nem lakják", container: "A ház előtt vagy az udvarban", cleaning: "Nem, elég a seprűtiszta átadás", timeline: "60 napon belül",
        },
        min: 100000, max: 800000,
    },
    {
        name: "Iroda 120–200 m²: álmennyezet + 4+ gipszkarton válaszfal + padló, cég",
        answers: {
            projectType: "Belső bontás, felújítás előtt", building: "Iroda, üzlethelyiség", access: "Földszint", area: "120–200 m²",
            scope: ["Álmennyezet, gipszkarton mennyezet", "Válaszfal", "Parketta, laminált, PVC, szőnyeg"],
            floorExtent: "Az egész területen", wallCount: "4 vagy több falat", wallMaterial: "Gipszkarton", loadBearing: "Nem",
            occupancy: "Teljesen üres", container: "Csak közterületen (az utcán)", cleaning: "Nem, elég a seprűtiszta átadás", timeline: "30 napon belül",
        },
        customer: "Cég",
        min: 300000, max: 2000000,
    },
    {
        name: "Emeletes téglaház bontása, 100–150 m², pincével, palatető",
        answers: {
            projectType: "Teljes épület bontása", structure: "Tégla", bArea: "100–150 m²", bLevels: "Emeletes", basement: "Van, azt is bontani kell",
            roofType: "Pala (hullámpala vagy síkpala)", utilities: "Igen, le vannak kötve", container: "A ház előtt vagy az udvarban", timeline: "90 napon belül",
        },
        min: 5000000, max: 20000000,
    },
    {
        name: "Vályog melléképület, 20–40 m²",
        answers: {
            projectType: "Melléképület, garázs bontása", structure: "Vályog", bArea: "20–40 m²", roofType: "Cserép",
            utilities: "Igen, le vannak kötve", container: "A ház előtt vagy az udvarban", timeline: "30 napon belül",
        },
        min: 250000, max: 1500000,
    },
];

// ---------------------------------------------------------------------------
//  WHAT THE AI MAY SAY ABOUT THE COMPANY (from the Banacraft épületbontás site)
// ---------------------------------------------------------------------------
export const KNOWLEDGE = `- Belső terek pontos bontása Budapesten és környékén, azonnali kezdéssel, a törmelék elszállításával együtt. Teljes épületek és melléképületek bontását is vállaljuk.
- Amit bontunk: hideg és meleg burkolatok (csempe, járólap, parketta, laminált), falicsempe vésése, vakolat, belső falazatok és válaszfalak, beton- és esztrichaljzatok, álmennyezetek és gipszkarton mennyezetek, fa szerkezetek és lambéria, nyílászárók, vezetékhornyok vésése, fürdőszoba és konyha berendezés, vezetékek.
- Irodáknak (átalakítás, költözés előtt, ütemezetten), lakásoknak és házaknak (fürdő- és konyhafelújítás, teljes belső átalakítás, burkolat- és aljzatcsere), üzlethelyiségeknek, kereskedelmi és ipari tereknek dolgozunk.
- A bontási törmeléket a kijelölt hulladékfeldolgozó üzembe szállítjuk - nem az ügyfél gondja lesz utólag, és nem őt terheli a felelősség.
- A bontás megkezdése előtt ellenőrizzük a víz, gáz és villany helyzetét, és egyeztetjük a szükséges leválasztásokat.
- Ha a bontandó anyag azbesztet tartalmaz, azonosítjuk, elkülönítve kezeljük, szabályosan elszállítjuk és dokumentáljuk; ehhez saját engedélyünk van.
- Teherhordó falat, födémet vagy új nyílást csak statikus szakvélemény alapján bontunk; ezt a felmérésen tisztázzuk.
- Közterületen álló konténerhez közterület-foglalási engedély kell.
- Nem törmelékkel teli helyiséget hagyunk hátra: tiszta, rendezett területet adunk át, a következő munkafázishoz készen. Kérésre építés utáni nagytakarítást is végzünk.
- Pontos munkavégzés a megbeszéltek szerint; előre tisztázott, írásos ajánlat, utólagos meglepetések nélkül; számlát és átadási dokumentációt adunk.
- Felelősségbiztosítással dolgozunk, a munkára garanciát vállalunk.
- Ingyenes, kötelezettség nélküli helyszíni felmérés; a végleges ajánlatot a felmérés után adjuk.`;
