We are trying to create a non-proft debate community group at debate101.org
Going to build some tools and community platform abilites as well as have a discord and stuff. 
Vivaan Shahani, Arjun Gupta, Max McBride & Max Feinstein

Debate 101 is an unincorporated non-profit collective bridging the gap between novice learners and elite competition through tools, community, and strategy.

IGNORE SECTION BELOW, FOR DEV REFERENCE:

const resourceCategories = [
            {
                title: "Core Infrastructure",
                bgColor: "bg-blue-50",
                resources: [
                    { title: "Tabroom", desc: "The official NSDA repository for tournament registration and balloting history. Essential for tracking standings and circuit shifts.", link: "https://www.tabroom.com/", type: "external", icon: "fas fa-list", keywords: "registration, tournament, brackets, judging, nsda" },
                    { title: "Verbatim", desc: "The standard Word template for paperless debate. Features high-speed formatting macros and card organization used globally.", link: "http://paperlessdebate.com/", type: "external", icon: "fas fa-keyboard", keywords: "software, template, formatting, case building, word" },
                    { title: "Open Caselist", desc: "The central wiki where teams disclose evidence. Essential for scouting opponent strategies and researching meta-trends.", link: "https://opencaselist.com/", type: "external", icon: "fas fa-globe", keywords: "disclosure, wiki, evidence, scouting, history" },
                    { title: "NDCA Coaches Association", desc: "National Debate Coaches Association hub for coaches, open evidence archives, and administrative circuit protocols.", link: "https://www.debatecoaches.org/", type: "external", icon: "fas fa-archive", keywords: "ndca, open evidence, policy, ld" }
                ]
            },
            {
                title: "Prep Tools & Logic",
                bgColor: "bg-white",
                resources: [
                    { title: "Architect Timer", desc: "Proprietary high-precision tournament timer for LD, Policy, and PF. Features automated speech sequences and prep tracking.", link: "#timer", type: "internal", icon: "fas fa-stopwatch", keywords: "timer, stop watch, clock, round time" },
                    { title: "Auto Flow Generator", desc: "Proprietary Debate 101 tool for converting Cases into Excel Flow templates. Optimized for speed and technical clarity.", link: "#autoflow", type: "internal", icon: "fas fa-file-excel", keywords: "excel, flow, automated, spreadsheet" },
                    { title: "Resolution AI", desc: "Elite synthesis engine for high-level resolution analysis. Map offensive paths and framework clashes instantly.", link: "#tools", type: "internal", icon: "fas fa-robot", keywords: "ai, strategist, analysis, resolution, intelligence" },
                    { title: "Debate.cards", desc: "A precision search engine designed specifically for finding carded evidence across multiple national circuit archives.", link: "https://debate.cards/", type: "external", icon: "fas fa-search-plus", keywords: "evidence search, carding, preparation" },
                    { title: "Logos Debate", desc: "A modern platform providing high-quality drills, evidence sets, and prep materials for LD and PF debaters.", link: "https://logos-debate.netlify.app/", type: "external", icon: "fas fa-bookmark", keywords: "prep, drills, logos" },
                    { title: "Cardr (GitHub)", desc: "Open-source browser extension for automated card-cutting from scholarly sites directly into Verbatim. Essential for research speed.", link: "https://github.com/SohamGovande/cardr", type: "external", icon: "fas fa-scissors", keywords: "extension, carding, research, github" },
                    { title: "Debate Flow (Vercel)", desc: "Cloud-based digital flowing platform. Supports collaborative notation and technical clarity in live rounds.", link: "https://debate-flow.vercel.app/", type: "external", icon: "fas fa-feather", keywords: "digital flow, cloud, sync, collab" }
                ]
            },
            {
                title: "Technical Utilities",
                bgColor: "bg-gray-50",
                resources: [
                    { title: "DebateKeeper", desc: "The most customizable Android timer for competitive debate, supporting custom bell signals and prep-time logic.", link: "https://github.com/czlee/debatekeeper", type: "external", icon: "fas fa-stopwatch", keywords: "timer, android, prep time" },
                    { title: "DebTime", desc: "A minimalist, high-visibility web timer interface for tracking speech times on any device in-round.", link: "https://debti.me/", type: "external", icon: "fas fa-clock", keywords: "web timer, timing, debate" },
                    { title: "DebateTimers.com", desc: "Professional-grade browser timers featuring multi-room synchronization and streamlined UX for tournament use.", link: "https://debatetimers.com/", type: "external", icon: "fas fa-hourglass-half", keywords: "timer, clock, web" },
                    { title: "NCFCA Flow Sheets", desc: "Traditional flow sheet templates optimized for NCFCA Policy (Team Policy) and Lincoln Douglas formats.", link: "https://ncfca.org/resources/flow-sheets-policy-debate-tp/", type: "external", icon: "fas fa-table", keywords: "ncfca, template, flow" }
                ]
            },
            {
                title: "Calculators & Odds",
                bgColor: "bg-blue-50",
                resources: [
                    { title: "DebateBreaker", desc: "Instant probability calculations for tournament breaks based on your current record and field power matching.", link: "https://www.debatebreaker.com/", type: "external", icon: "fas fa-calculator", keywords: "break calculator, odds, bracket" },
                    { title: "CDA Break Calc", desc: "Specialized calculator for determining break points and seed probabilities in large-scale tournament brackets.", link: "https://www.cdadebate.com/debate-tournament-break-calculator", type: "external", icon: "fas fa-percent", keywords: "break, seed, seeds" },
                    { title: "Circuit Debater Screw", desc: "Technical utility for calculating elimination round probabilities and ensuring fairness in bracket seeding.", link: "https://tools.circuitdebater.org/screw", type: "external", icon: "fas fa-tools", keywords: "screw calculator, bracket, circuit" }
                ]
            },
            {
                title: "Academy & Lectures",
                bgColor: "bg-white",
                resources: [
                    { title: "DebateRounds", desc: "Comprehensive archive of high-level debate round recordings across various circuits, providing essential technical film study.", link: "https://debaterounds.com/", type: "external", icon: "fas fa-video", keywords: "rounds, recordings, film study, technical" },
                    { title: "Debate Drills YT", desc: "Premier archive for technical drills and mechanics masterclasses. Essential for circuit readiness.", link: "https://www.youtube.com/@DebateDrills", type: "external", icon: "fab fa-youtube", keywords: "video, coaching, drills" },
                    { title: "Bill Batterman", desc: "Exhaustive lecture archive from one of the circuit's most respected minds, covering Policy and LD fundamentals.", link: "https://www.youtube.com/c/BillBatterman", type: "external", icon: "fas fa-chalkboard", keywords: "batterman, policy, lectures, theory" },
                    { title: "Proteus Academy", desc: "Strategy lab focused on high-level circuit trends and conceptual edges in national competition.", link: "https://www.youtube.com/@proteusdebateacademy", type: "external", icon: "fas fa-brain", keywords: "strategy, elite labs, proteus" },
                    { title: "NSDA Training", desc: "Official training and final round videos from the National Speech & Debate Association official archive.", link: "https://www.youtube.com/@nsdaspeechanddebate", type: "external", icon: "fas fa-video", keywords: "nsda, finals, official" },
                    { title: "LD Debate Prep", desc: "A comprehensive repository of training materials specifically tailored for high-level Lincoln Douglas competition.", link: "https://lddebateprep.org/", type: "external", icon: "fas fa-graduation-cap", keywords: "ld prep, learning" },
                    { title: "Argument Institute", desc: "Platform dedicated to the structural integrity of argumentation and high-level strategy and research methods.", link: "https://argumentinstitute.org/", type: "external", icon: "fas fa-university", keywords: "logic, structure, coaching" },
                    { title: "The Debate Guru", desc: "Community-driven site providing introductory case ideas and fundamental concept breakdowns for novices.", link: "https://thedebateguru.weebly.com/", type: "external", icon: "fas fa-star", keywords: "guru, help, novice" }
                ]
            },
            {
                title: "Critical & Phil Hub",
                bgColor: "bg-gray-50",
                resources: [
                    { title: "Stanford Encyclopedia", desc: "The gold standard for philosophical framework research. Peer-reviewed entries on every core concept in forensics.", link: "https://plato.stanford.edu/", type: "external", icon: "fas fa-landmark", keywords: "phil, philosophy, SEP, framework, kant, ethics" },
                    { title: "PhilPapers", desc: "Comprehensive directory of philosophical literature. Essential for finding niche primary sources for K-Aff research.", link: "https://philpapers.org/", type: "external", icon: "fas fa-balance-scale", keywords: "phil, papers, critical research, scholarship, archive" },
                    { title: "CTheory", desc: "International journal of theory and technology. Research standard for accelerationism and digital postmodernism.", link: "https://journals.uvic.ca/index.php/ctheory/index", type: "external", icon: "fas fa-bolt", keywords: "baudrillard, acceleration, theory, digital" },
                    { title: "The Funambulist", desc: "Magazine examining politics of space and bodies. Crucial for settler-colonialism and biopolitics research.", link: "https://thefunambulist.net/", type: "external", icon: "fas fa-walking", keywords: "colonialism, body politics, state, biopolitics" },
                    { title: "Kritikal Discussions", desc: "A platform dedicated to exploring the intersection of critical pedagogy and competitive debate strategy.", link: "https://www.kritikaldiscussions.com/", type: "external", icon: "fas fa-comments", keywords: "k-debate, critical, pedagogy" }
                ]
            },
            {
                title: "Elite Camps & Orgs",
                bgColor: "bg-white",
                resources: [
                    { title: "Vanguard Debate", desc: "Innovative tournament management and tabulation software designed for modern high-speed circuit efficiency.", link: "https://vanguarddebate.com/", type: "external", icon: "fas fa-shield-alt", keywords: "vanguard, tab, tournament" },
                    { title: "Harvard Workshops", desc: "World-class summer workshops taught by Ivy League champions and national circuit coaches.", link: "https://hdcsw.org/", type: "external", icon: "fas fa-crown", keywords: "camp, harvard, summer" },
                    { title: "Michigan Debate", desc: "The most rigorous Policy intensive workshop globally, known for its extreme research standards.", link: "https://michigandebate.com/", type: "external", icon: "fas fa-flask", keywords: "policy camp, michigan, summer" },
                    { title: "Victory Briefs", desc: "National hub for LD and PF training, featuring specialized technical labs and leading publications.", link: "https://victorybriefs.com/", type: "external", icon: "fas fa-trophy", keywords: "camp, ld, pf, victory briefs" },
                    { title: "Lumos Debate", desc: "Global debate camp and coaching initiative focused on public speaking and competitive success across all formats.", link: "https://www.lumosdebate.com/", type: "external", icon: "fas fa-lightbulb", keywords: "lumos, camp, coaching" },
                    { title: "NS Debate Camp", desc: "Specialized training workshop with a renowned glossary for the Tournament of Champions (TOC).", link: "https://www.nsdebatecamp.com/glossary/tournament-of-champions", type: "external", icon: "fas fa-award", keywords: "toc, glossary, camp" },
                    { title: "Outreach Debate", desc: "Initiative focused on expanding access to competitive discourse for under-resourced schools and communities.", link: "https://www.outreachdebate.com/", type: "external", icon: "fas fa-hands-helping", keywords: "outreach, inclusive" },
                    { title: "PepTalk Debate", desc: "Mentorship-focused debate training designed to empower middle and high school students through discourse.", link: "https://www.peptalkdebate.org/", type: "external", icon: "fas fa-bullhorn", keywords: "mentorship, pep talk" }
                ]
            },
            {
                title: "Equity & Community",
                bgColor: "bg-blue-50",
                resources: [
                    { title: "Women's Debate Inst.", desc: "Non-profit providing elite debate education for gender-marginalized students to bridge the equity gap.", link: "https://www.womensdebateinstitute.org/", type: "external", icon: "fas fa-female", keywords: "wdi, inclusive, equity" },
                    { title: "W.I.N. Instagram", desc: "Women in National Debate platform focusing on representation, success stories, and community highlights.", link: "https://www.instagram.com/windebate/", type: "external", icon: "fab fa-instagram", keywords: "win, media, community" },
                    { title: "r/Debate", desc: "The primary community hub for discussion on all competitive formats, including PF, LD, and Policy.", link: "https://www.reddit.com/r/Debate/", type: "external", icon: "fab fa-reddit-alien", keywords: "reddit, community, forum" },
                    { title: "LD Docs (Email List)", desc: "The definitive LD debate email list for high-level technical discussion and evidence exchange.", link: "mailto:lddocs@groups.google.com", type: "external", icon: "fas fa-envelope-open-text", keywords: "email list, technical, ld" }
                ]
            },
            {
                title: "Primary Research",
                bgColor: "bg-white",
                resources: [
                    { title: "Google Scholar", desc: "Standard entry point for scholarly literature, legal citations, and deep case law mining.", link: "https://scholar.google.com/", type: "external", icon: "fas fa-search", keywords: "scholar, research, data" },
                    { title: "JSTOR", desc: "Primary digital library for academic journals and social science archives essential for K-aff prep.", link: "https://www.jstor.org/", type: "external", icon: "fas fa-book-reader", keywords: "research, journals, academic" },
                    { title: "LexisNexis", desc: "Ultimate archive for news, legal records, and empirical government data used in high-level research.", link: "https://www.lexisnexis.com/en-us/gateway.page", type: "external", icon: "fas fa-gavel", keywords: "legal, news, empirics" },
                    { title: "Brookings", desc: "Non-partisan policy analysis white papers; invaluable for internal link cards and DA impacts.", link: "https://www.brookings.edu/", type: "external", icon: "fas fa-building", keywords: "policy, white papers, stats" }
                ]
            }
        ];
