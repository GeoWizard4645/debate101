/**
 * The deterministic debate engine.
 *
 * A 1B model in a browser tab costs a gigabyte of download and several seconds
 * per answer. Most of what these tools are asked, though, is not open-ended: a
 * glossary question has one correct answer, and a resolution decomposes along
 * lines the activity has already standardised. So the model is now the last
 * resort rather than the first.
 *
 * Three layers, cheapest first:
 *
 *   1. GLOSSARY — exact and fuzzy lookup over a curated term bank. Sub-millisecond,
 *      always correct, zero tokens.
 *   2. ANALYSIS — a resolution is parsed (type, actor, agent verb, domain) and
 *      matched against argument banks per domain. Produces a full structured
 *      brief with no model at all.
 *   3. MODEL — only when the first two are not confident, and even then the
 *      engine's findings are injected as context so the model writes less and
 *      writes it better.
 *
 * Everything here is pure, synchronous, and allocation-light: the indexes are
 * built once at module load (a few hundred entries) and every query is a
 * scored scan over small arrays. There is no async, no network, no storage.
 */

/* ------------------------------------------------------------------ Utils -- */

const STOP = new Set(
    ("a an the is are was were be been being of in on at to for with by from as that this these those " +
     "it its and or but if then than so such not no nor do does did done have has had will would shall " +
     "should can could may might must ought i you he she they we us our your their what which who whom " +
     "when where why how about into over under again further more most other some any each few").split(" "),
);

/** Lowercase, strip punctuation, drop stop words, crude singularise. */
export function tokenize(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s'-]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP.has(w))
        .map((w) => (w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

/** Levenshtein distance, capped — used only for short term matching. */
function editDistance(a, b, cap = 3) {
    if (Math.abs(a.length - b.length) > cap) return cap + 1;
    const prev = new Array(b.length + 1);
    const cur = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
        cur[0] = i;
        let best = cur[0];
        for (let j = 1; j <= b.length; j++) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            if (cur[j] < best) best = cur[j];
        }
        if (best > cap) return cap + 1;
        for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
    }
    return prev[b.length];
}

/* -------------------------------------------------------------- Glossary -- */

/**
 * Curated term bank. Every answer here is written to be correct and complete
 * on its own, because when a term matches, this text is what the debater sees —
 * the model is never consulted.
 */
export const GLOSSARY = [
    ["kritik|k|critique", "A kritik is an argument that challenges the assumptions behind the opponent's advocacy rather than its outcomes. Instead of debating whether the plan works, it argues the mindset, framing, or discourse producing the plan is itself the problem. A kritik has a link (what the opponent did), an impact (why that mindset is bad), and an alternative (what to do instead)."],
    ["topicality|t|topical", "Topicality argues the affirmative's plan is not an example of the resolution, so it should not be evaluated. It runs as a shell: an interpretation of what a word in the resolution means, a violation showing the aff does not meet it, standards explaining why that interpretation is better for debate (limits, ground, predictability), and voters explaining why it is a reason to reject the team."],
    ["counterplan|cp", "A counterplan is a negative advocacy that competes with the affirmative plan — it solves the aff's harms in a way the aff does not, and doing both is either impossible or worse than the counterplan alone. It needs competition (usually via net benefit) and solvency."],
    ["disadvantage|disad|da", "A disadvantage argues the plan causes a bad consequence. Its parts are uniqueness (the bad thing is not happening now), link (the plan causes it), internal link (how that leads to the impact), and impact (why it matters). Weighing a DA against the aff's advantage is the core of policy comparison."],
    ["permutation|perm", "A permutation tests whether a counterplan or alternative actually competes, by proposing to do both. 'Perm do both' is the standard form. A permutation is a test of competition, not a new advocacy — the aff does not have to defend it as their plan."],
    ["framework|fw", "Framework is the argument about how the judge should evaluate the round — what counts as a reason to vote. In LD it usually means a value and criterion; in policy it is often the debate about whether to weigh consequences or to interrogate the discourse first. Winning framework decides which impacts are even relevant."],
    ["theory", "Theory is an argument about the rules of debate itself — that something an opponent did made the round unfair or uneducational. Like topicality it runs as interpretation, violation, standards, and voters. Common shells include condo (conditionality bad), disclosure, and various spec arguments."],
    ["condo|conditionality", "Conditionality is the negative's ability to kick advocacies mid-round. 'Condo bad' argues that letting the neg drop positions freely is unfair to the aff, who has to answer everything while the neg commits to nothing. 'Condo good' argues it is necessary for negative flexibility against a prepared aff."],
    ["spreading|spread", "Spreading is speaking at high speed — often 250-350 words per minute — to fit more arguments into a fixed time. It is standard in circuit policy and LD. Clarity still matters: if the judge cannot flow it, it does not count. Practice with our Speed Trainer."],
    ["flow|flowing", "Flowing is the note-taking system debaters use to track arguments through a round. Rows are arguments and columns are speeches, so you can see at a glance what was answered and what was dropped. Our Cascade app is built for exactly this."],
    ["drop|dropped|conceded|concession", "A dropped argument is one the opponent never answered. In most judging paradigms a dropped argument is treated as true, which is why flowing carefully matters — the easiest way to win is to extend something they ignored and explain why it decides the round."],
    ["extend|extension", "Extending an argument means carrying it forward into your next speech with warrant and impact, not just repeating the tagline. A real extension re-explains why the argument is true and why it matters now that the other team has responded."],
    ["turn|link turn|impact turn", "A turn converts an opponent's argument into a reason to vote for you. A link turn says the plan actually solves the thing they say it causes; an impact turn says the thing they call bad is actually good. Do not read both at once — that is a double turn and it works against you."],
    ["voter|voting issue", "A voting issue is a reason the judge should decide the round on that argument alone, usually fairness or education on a theory or topicality shell."],
    ["rvi|reverse voting issue", "A reverse voting issue argues that if the opponent runs theory or topicality and loses it, that is itself a reason to vote against them — on the grounds that they forced you to spend time defending your legitimacy."],
    ["solvency", "Solvency is whether the plan actually achieves the advantage it claims. A solvency deficit argues the plan does not fix the harm, which lowers the aff's offense without requiring a disadvantage."],
    ["inherency", "Inherency is the argument that the harm exists in the status quo and will continue absent the plan. If the government is already doing the plan, the aff has no reason to exist."],
    ["fiat", "Fiat is the convention that we assume the plan is enacted, so debate is about whether it should be rather than whether Congress would pass it. 'Should' implies 'would' is the standard justification."],
    ["status quo|squo", "The status quo is the present system — what happens if the judge votes negative and nothing changes."],
    ["burden of proof", "The burden of proof falls on the affirmative, who must prove the resolution true. The negative has the burden of rejoinder — to clash with what the aff presents rather than to prove the opposite resolution."],
    ["presumption", "Presumption is where the judge votes when nobody has won offense. It usually goes negative, toward less change, though some argue it flows to whichever side proposes the least change from the status quo."],
    ["permissibility", "Permissibility argues that if an action is not prohibited, it is allowed — often paired with presumption in phil debate to argue the aff cannot meet its burden."],
    ["tricks", "Tricks are short, often hidden arguments designed to be dropped — a-prioris, paradoxes, or definitional claims that win instantly if unanswered. They reward careful flowing more than any other style."],
    ["a priori|apriori", "An a priori is an argument that, if true, decides the round before the substance is reached — for example a definitional argument that makes the resolution analytically true or false."],
    ["skep|skepticism", "Skepticism argues that moral knowledge is impossible or that no action can be justified, so the aff cannot meet its burden to prove the resolution true. Usually paired with presumption."],
    ["util|utilitarianism", "Utilitarianism evaluates actions by their consequences, maximising overall wellbeing. It is the default framework in most policy debate and a common LD standard, because it makes impacts directly comparable."],
    ["deontology|deont", "Deontology evaluates actions by whether they respect duties or rights, independent of consequences. Kantian ethics is the most common form in LD — treating people as ends and never merely as means."],
    ["disclosure", "Disclosure is the norm of posting your cases and positions to the caselist wiki before the round. Disclosure theory argues that failing to disclose is unfair; anti-disclosure arguments cite small-school and safety concerns."],
    ["cross-ex|cx|crossfire", "Cross-examination is the questioning period between speeches. It is used to clarify positions, set up arguments for your next speech, and expose gaps. In PF the equivalent is crossfire, where both sides question each other."],
    ["speaker points|speaks", "Speaker points are the judge's score for delivery and strategy, usually on a 25-30 scale. They decide seeding among teams with the same record, which is what makes the bubble round so painful."],
    ["bid|toc bid", "A bid is an invitation to the Tournament of Champions, earned by reaching a specified elimination round at a designated tournament. Two bids qualify you."],
    ["prefs|mjp", "Mutual judge preference lets both teams rank the judge pool, and tab assigns judges both sides ranked similarly. It is why knowing paradigms matters."],
    ["paradigm", "A paradigm is a judge's stated approach to evaluating debates — what arguments they are comfortable with, how they weigh, and their preferences on speed and theory. Read it before the round; it is on Tabroom."],
    ["tabula rasa|tab", "A tabula rasa judge claims to bring no presuppositions and to evaluate only what is argued in the round, including how to evaluate it."],
    ["stock issues", "The stock issues are harms, inherency, solvency, topicality, and significance — the traditional checklist an affirmative must satisfy to win a policy round."],
    ["plan text", "The plan text is the exact wording of the affirmative's proposed action. Precision matters because the negative will read counterplans and topicality off the specific words."],
    ["advantage", "An advantage is the good consequence the affirmative claims from the plan, structured as uniqueness, link, internal link, and impact — the mirror image of a disadvantage."],
    ["impact calculus|impact calc", "Impact calculus compares impacts on magnitude (how big), probability (how likely), and timeframe (how soon). Doing it explicitly is usually the difference between a close win and a close loss."],
    ["case turn", "A case turn argues the affirmative's own advantage is backwards — that the plan makes the very thing it claims to solve worse."],
    ["off-case|off", "Off-case positions are negative arguments read separately from the affirmative case — disadvantages, counterplans, kritiks, and topicality, each on its own sheet."],
    ["on-case|case debate", "On-case arguments answer the affirmative's contentions directly, attacking their solvency, inherency, or impacts on the aff's own flow."],
    ["signposting", "Signposting is telling the judge exactly where you are on the flow — 'on the topicality flow, second argument' — so they can follow. It is the cheapest way to gain speaker points."],
    ["roadmap", "A roadmap is the brief statement before a speech of what order you will address the flows in, so the judge can set their paper up."],
    ["rfd|reason for decision", "The reason for decision is the judge's explanation of why they voted the way they did. Writing the RFD you want the judge to give is a good way to structure a final speech."],
    ["lay judge|lay", "A lay judge is a parent or community member without technical debate experience. Against a lay judge, slow down, drop the jargon, and argue in plain persuasive terms."],
    ["prep time|prep", "Prep time is the fixed pool of time each side can use between speeches. LD is typically four or five minutes, policy eight, PF three."],
];

/** Prebuilt lookup: alias -> entry index. Built once at module load. */
const GLOSSARY_INDEX = (() => {
    const map = new Map();
    GLOSSARY.forEach(([aliases, answer], i) => {
        aliases.split("|").forEach((alias) => map.set(alias.trim(), { i, answer, alias: alias.trim() }));
    });
    return map;
})();

const GLOSSARY_ALIASES = [...GLOSSARY_INDEX.keys()];

/**
 * Look a question up in the glossary.
 * @returns {{answer: string, term: string, confidence: number} | null}
 */
export function lookupGlossary(question) {
    const raw = String(question || "").toLowerCase().trim();
    if (!raw) return null;

    // Exact alias, or a "what is X" phrasing around one.
    const direct = raw.replace(/^(what|whats|what's|define|explain|tell me about|how does|how do|whats a|what is a|what is an|what are)\b/g, "")
        .replace(/\b(in|for|during|debate|mean|means|meaning|work|works|do|does)\b/g, " ")
        .replace(/[^a-z0-9\s-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (GLOSSARY_INDEX.has(direct)) {
        const hit = GLOSSARY_INDEX.get(direct);
        return { answer: hit.answer, term: hit.alias, confidence: 1 };
    }

    // Whole-word alias appearing in the question.
    const words = raw.replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean);
    const wordSet = new Set(words);
    let best = null;
    for (const alias of GLOSSARY_ALIASES) {
        if (alias.includes(" ")) {
            if (raw.includes(alias)) {
                const score = 0.8 + alias.length / 100;
                if (!best || score > best.confidence) {
                    const hit = GLOSSARY_INDEX.get(alias);
                    best = { answer: hit.answer, term: alias, confidence: Math.min(0.97, score) };
                }
            }
        } else if (wordSet.has(alias)) {
            // Single very short aliases (t, k, cp) only count when the question
            // is clearly asking about a term, not using the letter incidentally.
            const trustworthy = alias.length > 2 || /\b(what|define|explain|mean)\b/.test(raw);
            if (!trustworthy) continue;
            const score = 0.8 + Math.min(alias.length, 12) / 100;
            if (!best || score > best.confidence) {
                const hit = GLOSSARY_INDEX.get(alias);
                best = { answer: hit.answer, term: alias, confidence: Math.min(0.96, score) };
            }
        }
    }
    if (best) return best;

    // Fuzzy: a single typo away from an alias.
    for (const word of words) {
        if (word.length < 4) continue;
        for (const alias of GLOSSARY_ALIASES) {
            if (alias.includes(" ") || Math.abs(alias.length - word.length) > 2) continue;
            if (editDistance(word, alias, 1) <= 1) {
                const hit = GLOSSARY_INDEX.get(alias);
                return { answer: hit.answer, term: alias, confidence: 0.72 };
            }
        }
    }

    return null;
}

/* ------------------------------------------------- Resolution analysis --- */

/** Topic domains with real argument banks. Keywords are weighted by specificity. */
export const DOMAINS = [
    {
        id: "economy",
        label: "Economics & labour",
        keys: { economy: 3, economic: 3, wage: 3, minimum: 2, labour: 3, labor: 3, union: 3, tax: 3, taxation: 3, inflation: 3, unemployment: 3, worker: 2, market: 2, trade: 2, tariff: 3, poverty: 2, income: 3, welfare: 2, gdp: 3, industry: 2, business: 2, capitalism: 2 },
        aff: [
            "Redistribution raises aggregate demand — lower-income households spend a larger share of marginal income, so the policy is stimulative rather than merely transferring.",
            "Labour-market power has shifted decisively toward employers; correcting it restores the bargaining position that makes wage growth track productivity.",
            "The status quo externalises costs onto public programmes — taxpayers subsidise low wages through benefits, so the policy shifts costs back onto the firms creating them.",
        ],
        neg: [
            "Price floors and mandates produce disemployment at the margin, and the workers priced out are precisely the low-skill workers the policy is meant to help.",
            "Compliance costs fall hardest on small firms without legal departments, entrenching the large incumbents the aff claims to be constraining.",
            "Fiscal cost crowds out other spending or raises borrowing; the trade-off with existing anti-poverty programmes may be net negative.",
        ],
        das: ["Spending / debt ceiling", "Business confidence and investment", "Inflation"],
        cps: ["States counterplan", "Earned income tax credit instead of a mandate", "Phase-in with exemptions for small firms"],
        ks: ["Capitalism K — reform stabilises the system it claims to fix", "Settler colonialism / racial capitalism critiques of property"],
    },
    {
        id: "environment",
        label: "Environment & climate",
        keys: { climate: 3, environment: 3, carbon: 3, emission: 3, warming: 3, pollution: 3, energy: 2, renewable: 3, fossil: 3, nuclear: 2, biodiversity: 3, conservation: 3, water: 2, ocean: 2, sustainability: 3, green: 2 },
        aff: [
            "Climate impacts are non-linear and partially irreversible, so timeframe arguments cut aff — delay forecloses options that later action cannot recover.",
            "Co-benefits are immediate and local: air-quality improvements produce measurable mortality reductions independent of long-run climate effects.",
            "First-mover policy shapes international standards; unilateral action has leverage effects beyond the emissions it directly abates.",
        ],
        neg: [
            "Emissions leakage — production relocates to jurisdictions with weaker rules, so global emissions may not fall while domestic industry does.",
            "Without China and India the marginal effect on global temperature is small relative to the economic cost imposed.",
            "Regulatory capture and offset accounting mean paper reductions often exceed real ones.",
        ],
        das: ["Economy / energy prices", "Politics — election backlash", "Grid reliability"],
        cps: ["Carbon tax instead of regulation", "International agreement counterplan", "Adaptation rather than mitigation"],
        ks: ["Eco-managerialism — treating nature as a resource to be optimised", "Degrowth critiques of green growth"],
    },
    {
        id: "education",
        label: "Education",
        keys: { education: 3, school: 3, student: 3, teacher: 3, curriculum: 3, university: 3, college: 3, tuition: 3, childcare: 3, literacy: 3, classroom: 3, learning: 2, standardized: 3 },
        aff: [
            "Early intervention has the highest measured return of any social spending — effects compound across a lifetime rather than dissipating.",
            "Access barriers are the binding constraint, not ability; removing them converts existing latent capacity into realised outcomes.",
            "Public provision breaks the link between parental income and child outcomes, which is the central mechanism reproducing inequality.",
        ],
        neg: [
            "Funding does not track outcomes cleanly — implementation quality and teacher capacity dominate marginal dollars.",
            "Universal provision spends heavily on families who would have purchased the service anyway, so targeting achieves more per dollar.",
            "Federal conditions crowd out local control and the experimentation that produces improvement.",
        ],
        das: ["Federalism", "Spending trade-off", "Teacher-union politics"],
        cps: ["Means-tested provision", "States / block grants", "Vouchers or tax credits"],
        ks: ["Schooling as social reproduction", "Critiques of human-capital framing of children"],
    },
    {
        id: "health",
        label: "Health & medicine",
        keys: { health: 3, healthcare: 3, medical: 3, medicine: 3, hospital: 3, insurance: 3, patient: 3, drug: 3, pharmaceutical: 3, disease: 3, pandemic: 3, mental: 2, vaccine: 3, care: 1 },
        aff: [
            "Coverage gaps produce deferred care, which converts cheap early treatment into expensive emergency treatment — the status quo is not the low-cost option.",
            "Health is a precondition for exercising every other capability, so it has priority under most frameworks rather than competing on equal terms.",
            "Risk pooling is the entire function of insurance; fragmenting the pool is what makes coverage unaffordable for the people who need it most.",
        ],
        neg: [
            "Supply is inelastic in the short run — expanding demand without expanding provider capacity produces queues rather than care.",
            "Innovation incentives depend on returns; price controls trade present access against future treatments that do not get developed.",
            "Administrative transition costs and implementation failure risk are large and routinely understated.",
        ],
        das: ["Pharmaceutical innovation", "Federal spending", "Provider shortage"],
        cps: ["Public option rather than single payer", "State-level experimentation", "Price transparency mandates"],
        ks: ["Biopolitics — health as a mode of governing populations", "Disability critiques of the medical model"],
    },
    {
        id: "criminal",
        label: "Criminal justice",
        keys: { criminal: 3, prison: 3, police: 3, incarceration: 3, sentencing: 3, crime: 3, punishment: 3, justice: 2, bail: 3, felony: 3, rehabilitation: 3, abolition: 3, surveillance: 2 },
        aff: [
            "Incapacitation and deterrence returns diminish sharply past a threshold the United States passed decades ago — marginal incarceration buys almost no safety.",
            "Collateral consequences fall on families and communities who committed no offence, so the harm is systematically undercounted.",
            "Procedural injustice reduces cooperation with law enforcement, so the status quo is self-undermining on its own terms.",
        ],
        neg: [
            "Incapacitation effects are real for a small high-frequency offender population; broad releases do not distinguish them.",
            "Victim interests and community consent are underweighted when reform is framed only around offenders.",
            "Implementation without supervision or reentry capacity converts a paper reform into recidivism.",
        ],
        das: ["Crime rate / politics", "Police backlash", "Federalism"],
        cps: ["Restorative justice programmes", "State-level reform", "Sentencing commission rather than statute"],
        ks: ["Prison abolition — reform legitimises the carceral system", "Afropessimism and the racial ontology of punishment"],
    },
    {
        id: "foreign",
        label: "Foreign policy & security",
        keys: { foreign: 3, military: 3, war: 3, nato: 3, alliance: 3, nuclear: 2, deterrence: 3, sanction: 3, diplomacy: 3, intervention: 3, troop: 3, weapon: 2, treaty: 3, china: 2, russia: 2, ukraine: 2, israel: 2, taiwan: 2, security: 2 },
        aff: [
            "Credible commitment is what deters; ambiguity invites the miscalculation that produces conflict.",
            "Burden-sharing arguments cut aff — allied capability substitutes for the American presence rather than adding to the bill.",
            "Escalation risk is highest where there is no established channel, so engagement lowers rather than raises war probability.",
        ],
        neg: [
            "Entrapment — commitments transfer the decision for war to another state's judgement.",
            "Security dilemma: capability read as defensive by us is read as offensive by them, producing the arms race the policy meant to avoid.",
            "Overstretch trades finite readiness against the theatre that actually matters.",
        ],
        das: ["Escalation / miscalculation", "Alliance credibility", "Defence spending trade-off"],
        cps: ["Conditional engagement", "Multilateral through allies or the UN", "Offshore balancing"],
        ks: ["Security K — threat construction produces the enemy it describes", "Orientalism and imperial framing"],
    },
    {
        id: "tech",
        label: "Technology & AI",
        keys: { technology: 3, artificial: 3, intelligence: 2, algorithm: 3, data: 3, privacy: 3, internet: 3, platform: 3, social: 2, encryption: 3, automation: 3, robot: 3, biotech: 3, genetic: 3, cyber: 3 },
        aff: [
            "Ex-post liability arrives after the harm and cannot undo it; deployment speed makes precaution the only functional lever.",
            "Concentration is self-reinforcing through data advantage, so waiting for competition to discipline the market means waiting indefinitely.",
            "Standards set early become locked in; the window for governing a technology closes as it diffuses.",
        ],
        neg: [
            "Regulators lack the technical capacity to write rules that survive contact with the field, so rules ossify around today's architecture.",
            "Compliance costs are a barrier to entry that entrenches exactly the incumbents the policy targets.",
            "Jurisdictional arbitrage — development relocates rather than stopping.",
        ],
        das: ["Innovation / competitiveness", "China tech race", "First Amendment"],
        cps: ["Industry self-regulation with audit", "International standards body", "Transparency mandates instead of restrictions"],
        ks: ["Techno-solutionism", "Surveillance capitalism and data extraction"],
    },
    {
        id: "immigration",
        label: "Immigration & borders",
        keys: { immigration: 3, immigrant: 3, border: 3, migrant: 3, refugee: 3, asylum: 3, citizenship: 3, deportation: 3, visa: 3, naturalization: 3 },
        aff: [
            "Migration raises aggregate output and fiscal balance over the lifecycle; the fiscal-cost framing misreads a timing effect as a permanent one.",
            "Restriction does not reduce migration so much as push it into irregular channels, which raises deaths and empowers smuggling networks.",
            "Freedom of movement is difficult to deny under any framework that treats birthplace as morally arbitrary.",
        ],
        neg: [
            "Absorption capacity — housing, schooling, and services are locally constrained even where national aggregates look fine.",
            "Wage competition concentrates on the workers closest in skill to new arrivals, who are often recent migrants themselves.",
            "Sending-state brain drain removes exactly the professionals development depends on.",
        ],
        das: ["Politics / backlash", "Labour market", "State and local budgets"],
        cps: ["Expanded legal channels rather than open borders", "Regional processing agreements", "Point-based selection"],
        ks: ["Borders as a colonial artefact", "Citizenship as an arbitrary birthright lottery"],
    },
    {
        id: "rights",
        label: "Rights & democracy",
        keys: { right: 2, liberty: 3, freedom: 3, speech: 3, democracy: 3, vote: 3, voting: 3, constitution: 3, court: 3, privacy: 2, protest: 3, censorship: 3, discrimination: 3, equality: 2 },
        aff: [
            "Rights function as side constraints, so they are not the kind of thing that can be traded against aggregate benefit.",
            "Procedural legitimacy is what makes outcomes binding; a policy that wins on substance while damaging procedure is self-defeating.",
            "Chilling effects operate before enforcement, so the harm is far wider than the set of people actually sanctioned.",
        ],
        neg: [
            "Rights conflict with each other, so 'respect rights' underdetermines the answer — the aff still owes a resolution of the conflict.",
            "Absolutist framing collapses under emergency cases the aff has to bite.",
            "Judicial enforcement removes the question from democratic contestation, which has its own legitimacy cost.",
        ],
        das: ["Court legitimacy", "Politics", "Federalism"],
        cps: ["Legislative rather than judicial remedy", "Narrow tailoring with sunset", "State constitutional protection"],
        ks: ["Rights discourse as liberal individualism", "Critical legal studies — indeterminacy of rights"],
    },
];

const RES_TYPES = [
    { id: "policy", label: "Policy", test: /\b(ought to|should|must)\b.*\b(adopt|enact|implement|require|ban|prohibit|guarantee|provide|abolish|legalize|legalise|fund|establish)\b|\bthe (united states|usfg|federal government|states)\b/i },
    { id: "value", label: "Value", test: /\bis (more|less) (important|valuable|justified|desirable)\b|\bought to value\b|\bis (just|unjust|moral|immoral|ethical)\b/i },
    { id: "fact", label: "Fact", test: /\b(is|are|was|were)\b(?!.*\bought\b)/i },
];

const ACTORS = [
    [/\bunited states federal government\b|\busfg\b/i, "the United States federal government"],
    [/\bthe united states\b|\bthe us\b|\bamerica\b/i, "the United States"],
    [/\bstates?\b(?! of)/i, "the states"],
    [/\bpublic (schools?|universities)\b|\bschools?\b/i, "schools"],
    [/\bindividuals?\b|\bpeople\b|\bcitizens?\b/i, "individuals"],
    [/\bgovernments?\b/i, "governments"],
    [/\bnations?\b|\bcountries\b|\bstates? ought\b/i, "nations"],
];

/**
 * Parse and analyse a resolution entirely deterministically.
 * @returns {{isResolution:boolean, type:object, actor:string|null, agentVerb:string|null,
 *            domains:Array, confidence:number, brief:object}}
 */
export function analyzeResolution(text) {
    const raw = String(text || "").trim();
    const body = raw.replace(/^resolved:?\s*/i, "").trim();
    const looksLikeResolution =
        /^resolved/i.test(raw) ||
        /\b(ought|should|must)\b/i.test(body) ||
        (body.split(/\s+/).length >= 6 && /\b(is|are)\b/i.test(body));

    const type = RES_TYPES.find((t) => t.test.test(body)) ?? RES_TYPES[0];
    const actorEntry = ACTORS.find(([re]) => re.test(body));
    const actor = actorEntry ? actorEntry[1] : null;
    const agentVerb = (body.match(/\b(ought to|should|must|is|are)\b/i) || [null])[0];

    // Weighted keyword scoring across domains.
    const tokens = tokenize(body);
    const counts = new Map();
    for (const t of tokens) counts.set(t, (counts.get(t) || 0) + 1);

    // Morphological matching, not just equality: "environmental" has to reach
    // the `environment` key and "economically" the `economic` one. The crude
    // plural stemmer above does not get there, and a full stemmer is not worth
    // the weight, so a prefix relation on stems of five characters or more
    // covers the cases that actually occur in resolutions.
    const tokenList = [...counts.keys()];
    const scored = DOMAINS.map((d) => {
        let score = 0;
        const matched = [];
        for (const [key, weight] of Object.entries(d.keys)) {
            let n = counts.get(key) || 0;
            if (n === 0 && key.length >= 5) {
                for (const tok of tokenList) {
                    if (tok.length >= 5 && (tok.startsWith(key) || key.startsWith(tok))) {
                        n += counts.get(tok);
                        break;
                    }
                }
            }
            if (n > 0) {
                score += weight * (1 + Math.log(n));
                matched.push(key);
            }
        }
        return { domain: d, score, matched };
    })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score);

    const top = scored.slice(0, 2);
    const totalScore = top.reduce((a, s) => a + s.score, 0);

    // Confidence: a clear resolution shape plus a decisive domain match.
    let confidence = 0;
    if (looksLikeResolution) confidence += 0.45;
    if (actor) confidence += 0.1;
    if (top.length) confidence += Math.min(0.45, totalScore / 14);

    return {
        isResolution: looksLikeResolution,
        type,
        actor,
        agentVerb,
        domains: top,
        confidence: Math.min(0.98, confidence),
        brief: buildBrief({ body, type, actor, top }),
    };
}

function buildBrief({ body, type, actor, top }) {
    const aff = [];
    const neg = [];
    const das = [];
    const cps = [];
    const ks = [];
    for (const { domain } of top) {
        aff.push(...domain.aff);
        neg.push(...domain.neg);
        das.push(...domain.das);
        cps.push(...domain.cps);
        ks.push(...domain.ks);
    }

    const frameworks =
        type.id === "value"
            ? ["Morality / justice with a criterion of consistency with rights", "Societal welfare with a criterion of maximising wellbeing"]
            : type.id === "fact"
              ? ["Truth-testing — the aff must prove the statement true", "Comparative worlds with a preponderance standard"]
              : ["Consequentialism — weigh the aggregate outcome", "Structural violence — evaluate who bears the cost first"];

    return {
        resolution: body,
        actor,
        type: type.label,
        frameworks,
        aff: aff.slice(0, 4),
        neg: neg.slice(0, 4),
        das: [...new Set(das)].slice(0, 4),
        cps: [...new Set(cps)].slice(0, 4),
        ks: [...new Set(ks)].slice(0, 3),
        definitions: extractContestableTerms(body),
    };
}

/** Words a topicality debate is likely to turn on: rare, load-bearing nouns. */
function extractContestableTerms(body) {
    const tokens = tokenize(body);
    const common = new Set(["state", "government", "policy", "people", "public", "federal", "united"]);
    const seen = new Set();
    const out = [];
    for (const t of tokens) {
        if (t.length < 5 || common.has(t) || seen.has(t)) continue;
        seen.add(t);
        out.push(t);
        if (out.length >= 4) break;
    }
    return out;
}

/** Render a brief as the markdown the chat displays. */
export function renderBrief(brief) {
    const list = (items) => items.map((i) => `* ${i}`).join("\n");
    const parts = [
        `**Resolution type:** ${brief.type}${brief.actor ? ` · **Actor:** ${brief.actor}` : ""}`,
        `**FRAMEWORK OPTIONS**\n${list(brief.frameworks)}`,
        `**AFFIRMATIVE**\n${list(brief.aff)}`,
        `**NEGATIVE**\n${list(brief.neg)}`,
    ];
    if (brief.das.length) parts.push(`**LIKELY DISADVANTAGES**\n${list(brief.das)}`);
    if (brief.cps.length) parts.push(`**COUNTERPLAN ANGLES**\n${list(brief.cps)}`);
    if (brief.ks.length) parts.push(`**KRITIK ANGLES**\n${list(brief.ks)}`);
    if (brief.definitions.length) {
        parts.push(`**CONTESTABLE TERMS** — define these before they do\n${list(brief.definitions)}`);
    }
    return parts.join("\n\n");
}

/* ------------------------------------------------------------- Routing --- */

/**
 * Decide how a question should be answered.
 *
 * `answer` means the engine is confident and the model is never loaded.
 * `augment` means the engine has real findings but the phrasing needs a model —
 * the brief is handed over as context so the model writes less.
 * `defer` means the engine has nothing useful and the model answers alone.
 *
 * @returns {{mode:"answer"|"augment"|"defer", text?:string, context?:string, source:string}}
 */
export function route(kind, question) {
    if (kind === "faq") {
        const hit = lookupGlossary(question);
        if (hit && hit.confidence >= 0.8) {
            return { mode: "answer", text: hit.answer, source: `glossary:${hit.term}` };
        }
        if (hit) {
            return {
                mode: "augment",
                context: `A curated reference defines "${hit.term}" as: ${hit.answer}`,
                source: `glossary-weak:${hit.term}`,
            };
        }
        return { mode: "defer", source: "none" };
    }

    const analysis = analyzeResolution(question);
    if (analysis.isResolution && analysis.domains.length && analysis.confidence >= 0.72) {
        return {
            mode: "answer",
            text: renderBrief(analysis.brief),
            analysis,
            source: `analysis:${analysis.domains.map((d) => d.domain.id).join("+")}`,
        };
    }
    if (analysis.isResolution) {
        return {
            mode: "augment",
            context:
                `Resolution type: ${analysis.brief.type}. ` +
                (analysis.actor ? `Actor: ${analysis.actor}. ` : "") +
                (analysis.domains.length
                    ? `Likely topic area: ${analysis.domains.map((d) => d.domain.label).join(", ")}.`
                    : ""),
            analysis,
            source: "analysis-weak",
        };
    }
    return { mode: "defer", source: "none" };
}

export const ENGINE_STATS = {
    glossaryTerms: GLOSSARY.length,
    glossaryAliases: GLOSSARY_ALIASES.length,
    domains: DOMAINS.length,
    arguments: DOMAINS.reduce((a, d) => a + d.aff.length + d.neg.length + d.das.length + d.cps.length + d.ks.length, 0),
};
