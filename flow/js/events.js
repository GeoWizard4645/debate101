/**
 * Debate event definitions. An event lists each side's speeches in speaking
 * order; the full column order for a round is derived by strictly
 * alternating the two lists starting with the first-speaking side
 * (speechOrder). Policy fixes the aff as first speaker; PF's first speaker
 * comes from the flip (FlowRound.firstSide).
 *
 * Ported from ebb's src/lib/format/events.ts so ids/names/shorts/aliases/
 * sides/order match byte-for-byte — that agreement is what lets a .ebb file
 * move between ebb and Cascade without conversion. `seconds` on each speech,
 * the prep table, and the cross-ex lengths below are Cascade additions; ebb
 * has no notion of official time.
 */

/**
 * @typedef {Object} SpeechDef
 * @property {string} id
 * @property {string} name
 * @property {string} short - column-header label; equals name for Policy
 * @property {"aff"|"neg"} side
 * @property {string[]} [aliases] - other names debaters call this speech,
 *   matched by search but never shown
 * @property {number} seconds - official speech length
 */

/**
 * @typedef {Object} CrossExPeriod
 * @property {string} label
 * @property {"first"|"second"} q - which team holds the question column
 */

/**
 * @typedef {Object} SideLabel
 * @property {string} label
 * @property {[string, string]} speakers
 */

/**
 * @typedef {Object} EventDef
 * @property {string} id
 * @property {string} name
 * @property {SpeechDef[]} aff
 * @property {SpeechDef[]} neg
 * @property {boolean} variableOrder
 * @property {{title: string, periods: CrossExPeriod[], shared?: boolean}} [crossEx]
 * @property {Record<"aff"|"neg", SideLabel>} [sides]
 */

const AFF_NEG_SIDES = {
    aff: { label: "Aff", speakers: ["1A", "2A"] },
    neg: { label: "Neg", speakers: ["1N", "2N"] },
};

/** @returns {SpeechDef} */
function speech(id, name, short, side, seconds, aliases) {
    return {
        id,
        name,
        short,
        side,
        seconds,
        ...(aliases && { aliases }),
    };
}

/** @type {Record<string, EventDef>} */
export const EVENTS = {
    policy: {
        id: "policy",
        name: "Policy",
        aff: [
            speech("1ac", "1AC", "1AC", "aff", 480),
            speech("2ac", "2AC", "2AC", "aff", 480),
            speech("1ar", "1AR", "1AR", "aff", 300),
            speech("2ar", "2AR", "2AR", "aff", 300),
        ],
        neg: [
            speech("1nc", "1NC", "1NC", "neg", 480),
            speech("block", "Block", "Block", "neg", 480, ["2NC", "1NR"]),
            speech("2nr", "2NR", "2NR", "neg", 300),
        ],
        variableOrder: false,
        crossEx: {
            title: "CX",
            periods: [
                { label: "1AC CX", q: "second" },
                { label: "1NC CX", q: "first" },
                { label: "2AC CX", q: "second" },
                { label: "2NC CX", q: "first" },
            ],
        },
    },
    pf: {
        id: "pf",
        name: "Public Forum",
        aff: [
            speech("ac", "Aff Constructive", "AC", "aff", 240),
            speech("ar", "Aff Rebuttal", "AR", "aff", 240),
            speech("as", "Aff Summary", "AS", "aff", 180),
            speech("af", "Aff Final Focus", "AF", "aff", 120),
        ],
        neg: [
            speech("nc", "Neg Constructive", "NC", "neg", 240),
            speech("nr", "Neg Rebuttal", "NR", "neg", 240),
            speech("ns", "Neg Summary", "NS", "neg", 180),
            speech("nf", "Neg Final Focus", "NF", "neg", 120),
        ],
        variableOrder: true,
        crossEx: {
            title: "Cross-Examination",
            shared: true,
            periods: [
                { label: "First Cross", q: "first" },
                { label: "Second Cross", q: "first" },
                { label: "Grand Cross", q: "first" },
            ],
        },
    },
    ld: {
        id: "ld",
        name: "Lincoln-Douglas",
        aff: [
            speech("1ac", "1AC", "1AC", "aff", 360),
            speech("1ar", "1AR", "1AR", "aff", 240),
            speech("2ar", "2AR", "2AR", "aff", 180),
        ],
        neg: [
            speech("1nc", "1NC", "1NC", "neg", 420),
            speech("2nr", "2NR", "2NR", "neg", 360),
        ],
        variableOrder: false,
        crossEx: {
            title: "CX",
            periods: [
                { label: "1AC CX", q: "second" },
                { label: "1NC CX", q: "first" },
            ],
        },
    },
    parli: {
        id: "parli",
        name: "Parliamentary",
        // Debaters name these speeches either by role or by the Policy-style
        // numbering, so each carries the other vocabulary as a search alias.
        // The opening speech is the Prime Minister, not a "PMC"; only the
        // speeches that have a rebuttal counterpart are named Constructive.
        aff: [
            speech("pm", "Prime Minister", "PM", "aff", 420, [
                "PMC",
                "Prime Minister Constructive",
                "1AC",
            ]),
            speech("mgc", "Member of the Government Constructive", "MGC", "aff", 480, ["2AC"]),
            speech("pmr", "Prime Minister Rebuttal", "PMR", "aff", 300, ["1AR"]),
        ],
        // The MOC and LOR run back to back, so they share one column the way
        // Policy's 2NC and 1NR share the Block: strict alternation cannot
        // express two consecutive speeches on the same side.
        neg: [
            speech("loc", "Leader of the Opposition Constructive", "LOC", "neg", 480, ["1NC"]),
            speech("block", "Opposition Block", "Block", "neg", 480, [
                "MOC",
                "Member of the Opposition Constructive",
                "2NC",
                "LOR",
                "Leader of the Opposition Rebuttal",
                "1NR",
            ]),
        ],
        variableOrder: false,
        // Parliamentary has no cross-examination; a point of information
        // interrupts a speech rather than occupying a period of its own.
        sides: {
            aff: { label: "Gov", speakers: ["PM", "MG"] },
            neg: { label: "Opp", speakers: ["LO", "MO"] },
        },
    },
};

/** Prep time per side, in seconds. Parli gets none: points of information
 *  substitute for prep the way they substitute for cross-ex. */
export const PREP_SECONDS = {
    policy: 480,
    pf: 180,
    ld: 240,
    parli: 0,
};

/** Length of one cross-examination period, in seconds. Every period within an
 *  event runs the same length, so this is one number per event rather than
 *  per period. Parli has no cross-ex at all. */
export const CX_SECONDS = {
    policy: 180,
    pf: 180,
    ld: 180,
    parli: 0,
};

/**
 * The event a round names.
 *
 * A round's `event` is a replicated register, so its value is whatever a peer
 * put on the wire, and every caller here indexes a static table with the
 * result. An id this build does not define reads as policy, the same fallback
 * a file that predates named events already gets. `in` would not do: it walks
 * the prototype chain, so `constructor` would pass and index nothing.
 * @param {string} [id]
 * @returns {EventDef}
 */
export function getEvent(id) {
    return Object.hasOwn(EVENTS, id ?? "") ? EVENTS[id] : EVENTS.policy;
}

/**
 * The event's side naming, falling back to the aff/neg the model stores.
 * @param {string} [id]
 * @returns {Record<"aff"|"neg", SideLabel>}
 */
export function sideLabels(id) {
    return getEvent(id).sides ?? AFF_NEG_SIDES;
}

/**
 * The round's full column order: the two side lists strictly alternated,
 * starting with firstSide. Uneven lists (Policy: 4 aff / 3 neg) interleave
 * until the shorter runs out, then the longer's tail follows.
 * @param {EventDef} event
 * @param {"aff"|"neg"} firstSide
 * @returns {SpeechDef[]}
 */
export function speechOrder(event, firstSide) {
    const first = firstSide === "aff" ? event.aff : event.neg;
    const second = firstSide === "aff" ? event.neg : event.aff;
    const order = [];
    for (let i = 0; i < Math.max(first.length, second.length); i++) {
        if (first[i]) order.push(first[i]);
        if (second[i]) order.push(second[i]);
    }
    return order;
}

/**
 * Everything a speech answers to in search: the name it shows under, its
 * column abbreviation, and any other name debaters call it. Search matches
 * this; nothing displays it.
 * @param {SpeechDef} speechDef
 * @returns {string}
 */
export function speechTerms(speechDef) {
    return [speechDef.name, speechDef.short, ...(speechDef.aliases ?? [])].join(" ");
}

/**
 * The official length of one speech, in seconds. 0 when the event or speech
 * id is not recognized, so a caller can use it directly as a timer duration
 * without a separate existence check.
 * @param {string} eventId
 * @param {string} speechId
 * @returns {number}
 */
export function speechSeconds(eventId, speechId) {
    const event = getEvent(eventId);
    const found = [...event.aff, ...event.neg].find((s) => s.id === speechId);
    return found?.seconds ?? 0;
}

/** Every event's speeches, keyed by id, with each speech's own seconds as
 *  the starting point for a preset's overrides. */
function presetSpeeches(eventId, overrides = {}) {
    const event = getEvent(eventId);
    const out = {};
    for (const s of [...event.aff, ...event.neg]) {
        out[s.id] = overrides[s.id] ?? s.seconds;
    }
    return out;
}

/**
 * @typedef {Object} TimerPreset
 * @property {string} id
 * @property {string} label
 * @property {string} eventId
 * @property {Record<string, number>} speeches
 * @property {number} prep
 * @property {number} cx
 */

/** Named timing variants a debater actually meets, for a preset picker in
 *  timers.js. The base speech/prep/cx numbers already match the NSDA/NPDA
 *  standard for LD, PF, and Parli, so those presets restate the defaults
 *  under a recognizable name; Policy novice divisions genuinely run shorter
 *  constructives and rebuttals, so that one overrides. */
export const TIMER_PRESETS = {
    "policy-varsity": {
        id: "policy-varsity",
        label: "Policy — Varsity/CEDA",
        eventId: "policy",
        speeches: presetSpeeches("policy"),
        prep: PREP_SECONDS.policy,
        cx: CX_SECONDS.policy,
    },
    "policy-novice": {
        id: "policy-novice",
        label: "Policy — Novice",
        eventId: "policy",
        speeches: presetSpeeches("policy", {
            "1ac": 300,
            "1nc": 300,
            "2ac": 300,
            block: 300,
            "1ar": 240,
            "2nr": 240,
            "2ar": 240,
        }),
        prep: 480,
        cx: CX_SECONDS.policy,
    },
    "ld-nsda": {
        id: "ld-nsda",
        label: "LD — NSDA",
        eventId: "ld",
        speeches: presetSpeeches("ld"),
        prep: PREP_SECONDS.ld,
        cx: CX_SECONDS.ld,
    },
    "pf-nsda": {
        id: "pf-nsda",
        label: "Public Forum — NSDA",
        eventId: "pf",
        speeches: presetSpeeches("pf"),
        prep: PREP_SECONDS.pf,
        cx: CX_SECONDS.pf,
    },
    "parli-npda": {
        id: "parli-npda",
        label: "Parliamentary — NPDA",
        eventId: "parli",
        speeches: presetSpeeches("parli"),
        prep: PREP_SECONDS.parli,
        cx: CX_SECONDS.parli,
    },
};

/**
 * The known events, for a picker. `EVENTS` itself is keyed by id and carries
 * the full speech lists a picker does not need.
 * @returns {{id: string, name: string}[]}
 */
export function eventList() {
    return Object.values(EVENTS).map((e) => ({ id: e.id, name: e.name }));
}
