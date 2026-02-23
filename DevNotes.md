These are just dev notes, ignore this, unless your just curious in which feel free to waste time reading my storage that's there to copy and paste incase gemini screws up.UPDATE GEMINI is not working with this long of a code. I'm screwed. I might install claude code or something because IDK what else to do. (ENTER CODE PREVIEW ON GITHUB TO SEE IT CLEARLY.)
Table of Content - (Bios lines 3-32, resources, 34-197, index.html,199-2000, ) //Last updated 2-17 /// Ctrl/Cmd + F ###RESOURCES### to find
###BIOS###
       const teamData = [
            {
                name: "Vivaan Shahani",
                role: "Co-Founder - Head of Web Development & Tool Creation",
                image: "assets/vivaan.png",
                blurb: "Strategic visionary architecting the intersection of economics, technology, and competitive debate.",
                depth: "Vivaan Shahani is a sophomore at Edgemont Jr/Sr High School in NY, currently in his third year of Lincoln-Douglas debate. His interest are centered around Lay/Trad Debate and LARP (Old schooled, I know). A frequent competitor on the National Circuit, Vivaan has found success at several major tournaments, reaching elimination rounds at both DSDS#1 and Harvard. Outside of the rounds, he is a multi-instrumentalist who plays the baritone saxophone in a jazz setting, a varsity lacrosse D-Pole, and a ameatur DJ (email vivaan.shahani@gmail.com to learn more about hiring me). Between his experience in Python and Swift programming, Vivaan is eager to apply his technical skills to help grow the resource hub at Debate101."
            },
            {
                name: "Max Feinstein",
                role: "Co-Founder - Head of Strategy & Critical Methodology",
                image: "assets/max-f.png",
                blurb: "A specialist in postmodern literature and critical methodology, redefining competitive discourse through rigor.",
                depth: "About me&nbsp;<br>My name is Max Feinstein, and I am a freshman at The Altamont School in Birmingham, Alabama. This is my third year of debate and my first year competing fully on the national-circuit. Debate is my primary academic interest, and I enjoy rounds where I learn new things. Subjectivity shift is real!&nbsp;<br>Outside of debate, I play ECNL and varsity soccer for Altamont (Go Knights!) and have been playing piano, electric guitar, and acoustic guitar for quite a while. I enjoy reading extensively in both philosophy and&nbsp;other&nbsp;literature&nbsp;such as The Picture of Dorian Gray&nbsp;or&nbsp;East of Eden&nbsp;etc, and am an avid NBA fan—especially of the San Antonio Spurs. I value collaborative learning environments and enjoy working with teammates and friends to create new arguments and strategies.&nbsp;<br>Debate Background&nbsp;&amp; Argument Interests<br>I specialize primarily in Kritikal and Phil/trix debate. For the k I am most comfortable engaging with postmodern literature though fine for all k lit. I read planless affirmatives and nailbomb on occasion lol, but I am also comfortable in debating all styles.&nbsp;<br>Strategically, I am drawn to arguments that emphasize methodological and ideological evaluation, framing disputes, and real impact calculus with different weighing metric indicts rather than purely empirical cost-benefit analysis.<br>Argument preferences&nbsp;(how I can best help teach you)<br>(1 = most comfortable to teach // 5 =&nbsp;least comfortable to teach)<br>1—Kritiks, K affs, PIKs, Spark, Wipeout, K tricks (this is super underutilized), trix and other unconventional and unique arguments<br>2—PICs, Phil, S/V<br>3—Counterplans (other), Policy, Disads<br>4—Theory and procedurals<br>5—Lay debate (I can assist, but others like Max M or Vivaan may be better suited)&nbsp;<br>Email me at feinsteinm29@altamontschool.org"
            },
            {
                name: "Max McBride",
                role: "Co-Founder - Head of Community Building and Outreach",
                image: "assets/max-m.png",
                blurb: "Specialist in geopolitical resolutions and empirical evidence analysis.",
                depth: "Max McBride is a freshman VLD debater at Isidore Newman School in New Orleans, Louisiana. He specializes in philosophical debate (Kant, Hobbes, Nietzsche, Mitleid arguments, Determinism and Skep, etc…) along with more traditional or lay debate, both locally and nationally. Max values personal ambition and contribution."
            },
            {
                name: "Arjun Gupta",
                role: "Co-Founder - Head of Lecture Creation & Debate Analysis",
                image: "assets/arjun.png",
                blurb: "Lead analyst for K-Aff argumentation and critical literature.",
                depth: "Arjun is a freshman at Edgemont Jr/Sr High School in NY, in his second year of debate. His debate interests mainly revolve around philosophy, theory, kritiks, and some tricks. He competes on the National Circuit, and has reached elimination rounds at tournaments like Emory and Stanford. Outside of debate, he likes hiking, skiing, playing golf, and coding, and he’s excited to work with Debate101."
            }
        ];
        ###RESOURCES###
                const resourceCategories = [
            {
                title: "Core Infrastructure",
                bgColor: "bg-blue-50",
                resources: [
                    { title: "Tabroom", desc: "The official NSDA repository for tournament registration and balloting history. Essential for tracking standings and circuit shifts.", link: "https://www.tabroom.com/", type: "external", icon: "fas fa-list", keywords: "registration, tournament, brackets, judging, nsda" },
                    { title: "Verbatim", desc: "The standard Word template for paperless debate. Features high-speed formatting macros and card organization used globally.", link: "http://paperlessdebate.com/", type: "external", icon: "fas fa-keyboard", keywords: "software, template, formatting, case building, word" },
                    { title: "Open Caselist", desc: "The central wiki where teams disclose evidence. Essential for scouting opponent strategies and researching meta-trends.", link: "https://opencaselist.com/", type: "external", icon: "fas fa-globe", keywords: "disclosure, wiki, evidence, scouting, history" },
                    { title: "NDCA Coaches Association", desc: "National Debate Coaches Association hub for coaches, open evidence archives, and administrative circuit protocols.", link: "https://www.debatecoaches.org/", type: "external", icon: "fas fa-archive", keywords: "ndca, open evidence, policy, ld" },
                    { title: "NSDA Resource Center", desc: "Official collection of training materials, historical round videos, and official rulesets from the NSDA.", link: "https://www.speechanddebate.org/resources/", type: "external", icon: "fas fa-university", keywords: "nsda, resources, training" }
                ]
            },
            {
                title: "Prep Tools & Logic",
                bgColor: "bg-white",
                resources: [
                    { title: "Resolution AI", desc: "Elite synthesis engine for high-level resolution analysis. Map offensive paths and framework clashes instantly.", link: "#tools", type: "internal", icon: "fas fa-robot", keywords: "ai, strategist, analysis, resolution, intelligence" },
                    { title: "Auto Flow Generator", desc: "Proprietary Debate 101 tool for converting Cases into Excel Flow templates. Optimized for speed and technical clarity.", link: "#autoflow", type: "internal", icon: "fas fa-file-excel", keywords: "excel, flow, automated, spreadsheet" },
                    { title: "PrepSync", desc: "AI-driven card and evidence finder. Precision search utility for high-level competitive preparation.", link: "https://prepsync.net/", type: "external", icon: "fas fa-sync-alt", keywords: "prepsync, cards, evidence finder, ai finder" },
                    { title: "DebateV", desc: "High-speed evidence search engine for finding cards across years of disclosed wikis and archives.", link: "https://debatev.com/", type: "external", icon: "fas fa-bolt", keywords: "search, cards, evidence, debatev" },
                    { title: "Circuit Debater", desc: "Massive repository of historical cases and documents from elite circuit debaters across LD and Policy.", link: "https://circuitdebater.org/", type: "external", icon: "fas fa-project-diagram", keywords: "historical, cases, circuit debater" },
                    { title: "Debate.cards", desc: "A precision search engine designed specifically for finding carded evidence across multiple national circuit archives.", link: "https://debate.cards/", type: "external", icon: "fas fa-search-plus", keywords: "evidence search, carding, preparation" },
                    { title: "Logos Debate", desc: "A modern platform providing high-quality drills, evidence sets, and prep materials for LD and PF debaters.", link: "https://logos-debate.netlify.app/", type: "external", icon: "fas fa-bookmark", keywords: "prep, drills, logos" },
                    { title: "CardCutPro", desc: "Advanced card cutting and evidence organization scripts for GitHub-based research workflows.", link: "https://github.com/dhruvtpatel/CardCutPro", type: "external", icon: "fas fa-cut", keywords: "scripts, research, cutting, github" },
                    { title: "DebateDash", desc: "Productivity dashboard for debaters to manage evidence and tournament timelines efficiently.", link: "https://github.com/dhruvtpatel/DebateDash", type: "external", icon: "fas fa-tachometer-alt", keywords: "dashboard, hub, productive, github" },
                    { title: "Cardr (GitHub)", desc: "Open-source browser extension for automated card-cutting from scholarly sites directly into Verbatim. Essential for research speed.", link: "https://github.com/SohamGovande/cardr", type: "external", icon: "fas fa-scissors", keywords: "extension, carding, research, github" },
                    { title: "Debate Flow (Vercel)", desc: "Cloud-based digital flowing platform. Supports collaborative notation and technical clarity in live rounds.", link: "https://debate-flow.vercel.app/", type: "external", icon: "fas fa-feather", keywords: "digital flow, cloud, sync, collab" }
                ]
            },
            {
                title: "Technical Utilities",
                bgColor: "bg-gray-50",
                resources: [
                    { title: "Architect Timer", desc: "Proprietary high-precision tournament timer for LD, Policy, and PF. Features automated speech sequences and prep tracking.", link: "#timer", type: "internal", icon: "fas fa-stopwatch", keywords: "timer, stop watch, clock, round time" },
                    { title: "DebTime", desc: "A minimalist, high-visibility web timer interface for tracking speech times on any device in-round.", link: "https://debti.me/", type: "external", icon: "fas fa-clock", keywords: "web timer, timing, debate" },
                    { title: "DebateTimers.com", desc: "Professional-grade browser timers featuring multi-room synchronization and streamlined UX for tournament use.", link: "https://debatetimers.com/", type: "external", icon: "fas fa-clock", keywords: "timer, clock, web" },
                    { title: "NCFCA Flow Sheets", desc: "Traditional flow sheet templates optimized for NCFCA Policy (Team Policy) and Lincoln Douglas formats.", link: "https://ncfca.org/resources/flow-sheets-policy-debate-tp/", type: "external", icon: "fas fa-table", keywords: "ncfca, template, flow" },
                    { title: "DebateKeeper (GitHub)", desc: "The most customizable Android timer for competitive debate, supporting custom bell signals and prep-time logic.", link: "https://github.com/czlee/debatekeeper", type: "external", icon: "fas fa-stopwatch", keywords: "timer, android, prep time, github" }
                ]
            },
            {
                title: "Calculators & Odds",
                bgColor: "bg-blue-50",
                resources: [
                    { title: "Screw Calculator", desc: "Proprietary projection utility for determining outround break points and 'bubble' probabilities based on tournament size.", link: "#screw", type: "internal", icon: "fas fa-calculator", keywords: "break, screw, odds, projection" },
                    { title: "SMODI LD Rankings", desc: "Annual unofficial national rankings for Lincoln-Douglas debaters, providing meta-analysis of circuit performance.", link: "https://smodi.net/ld-rankings", type: "external", icon: "fas fa-trophy", keywords: "rankings, ld, smodi, circuit" },
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
                    { title: "Proteus Academy", desc: "Strategy lab focused on high-level circuit trends and conceptual edges in national competition.", link: "https://www.youtube.com/@proteusdebateacademy", type: "fas fa-brain", keywords: "strategy, elite labs, proteus" },
                    { title: "One-World Debate", desc: "Technical analysis and instructional lectures on high-level argumentation and cross-ex mechanics.", link: "https://www.youtube.com/channel/UCYPPO78Q16D9p4_bX0rR2QQ", type: "external", icon: "fas fa-graduation-cap", keywords: "one world, lectures, analysis" },
                    { title: "Go Fight Win", desc: "Strategy hub focusing on LD mechanics, technical drilling, and round evaluation.", link: "https://www.youtube.com/channel/UC2gnLZUFVVhjTy4UL9MhvRg/featured", type: "external", icon: "fas fa-fist-raised", keywords: "go fight win, ld strategy" },
                    { title: "HSR Debate", desc: "Video archive specializing in Policy debate theory and technical breakdown of circuit-level rounds.", link: "https://www.youtube.com/channel/UCUae8CTGOPAsx-SXL61BnpQ", type: "external", icon: "fas fa-play", keywords: "hsr, policy, round review" },
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
                    { title: "Value Criterion", desc: "Specific database for analyzing values and criteria within the LD philosophical framework.", link: "http://www.valuecriterion.com/", type: "external", icon: "fas fa-gavel", keywords: "ld phil, value, criteria" },
                    { title: "CTheory", desc: "International journal of theory and technology. Research standard for accelerationism and digital postmodernism.", link: "https://journals.uvic.ca/index.php/ctheory/index", type: "external", icon: "fas fa-bolt", keywords: "baudrillard, acceleration, theory, digital" },
                    { title: "The Funambulist", desc: "Magazine examining politics of space and bodies. Crucial for settler-colonialism and biopolitics research.", link: "https://thefunambulist.net/", type: "external", icon: "fas fa-walking", keywords: "colonialism, body politics, state, biopolitics" },
                    { title: "Kritikal Discussions", desc: "A platform dedicated to exploring the intersection of critical pedagogy and competitive debate strategy.", link: "https://www.kritikaldiscussions.com/", type: "external", icon: "fas fa-comments", keywords: "k-debate, critical, pedagogy" }
                ]
            },
            {
                title: "Elite Camps",
                bgColor: "bg-white",
                resources: [
                    { title: "Harvard Workshops", desc: "World-class summer workshops taught by Ivy League champions and national circuit coaches.", link: "https://hdcsw.org/", type: "external", icon: "fas fa-crown", keywords: "camp, harvard, summer" },
                    { title: "Michigan Debate", desc: "The most rigorous Policy intensive workshop globally, known for its extreme research standards.", link: "https://michigandebate.com/", type: "external", icon: "fas fa-flask", keywords: "policy camp, michigan, summer" },
                    { title: "Victory Briefs", desc: "National hub for LD and PF training, featuring specialized technical labs and leading publications.", link: "https://victorybriefs.com/", type: "external", icon: "fas fa-trophy", keywords: "camp, ld, pf, victory briefs" },
                    { title: "Lumos Debate", desc: "Global debate camp and coaching initiative focused on public speaking and competitive success across all formats.", link: "https://www.lumosdebate.com/", type: "external", icon: "fas fa-lightbulb", keywords: "lumos, camp, coaching" },
                    { title: "NS Debate Camp", desc: "Specialized training workshop with a renowned glossary for the Tournament of Champions (TOC).", link: "https://www.nsdebatecamp.com/glossary/tournament-of-champions", type: "external", icon: "fas fa-award", keywords: "toc, glossary, camp" },
                    { title: "Dartmouth DDI", desc: "The Dartmouth Debate Institute, one of the premier Policy workshops in the country.", link: "https://www.ddidebate.org/", type: "external", icon: "fas fa-mortar-board", keywords: "ddi, dartmouth, policy camp" }
                ]
            },
            {
                title: "Elite Organizations",
                bgColor: "bg-gray-50",
                resources: [
                    { title: "Ethos Debate", desc: "Coaching and workshops focused on communication excellence and structural logic in debate.", link: "https://www.ethosdebate.com/", type: "external", icon: "fas fa-shield-alt", keywords: "ethos, coaching" },
                    { title: "Debate Resources LD", desc: "LD specific materials including briefs and technical primers for national circuit debaters.", link: "https://www.debateresources.com/lincoln-douglas", type: "external", icon: "fas fa-book-open", keywords: "resources, ld, briefs" },
                    { title: "Triumph Briefs", desc: "Modern evidence briefs provider known for quality research and high-utility carding in LD and PF.", link: "https://www.debateresources.com/lincoln-douglas", type: "external", icon: "fas fa-medal", keywords: "triumph, briefs, cards" },
                    { title: "Champion Briefs", desc: "Premier provider of monthly research briefs and prep materials for Public Forum and LD.", link: "https://championbriefs.com/", type: "external", icon: "fas fa-trophy", keywords: "champion, briefs, pf" },
                    { title: "Kankee Briefs", desc: "High-level K-focused briefs and strategy documents for national circuit LD competitors.", link: "https://www.patreon.com/kankeebriefs", type: "external", icon: "fas fa-skull", keywords: "briefs, kanke, kritikal" },
                    { title: "Outreach Debate", desc: "Initiative focused on expanding access to competitive discourse for under-resourced schools and communities.", link: "https://www. Peptalkdebate.org/", type: "external", icon: "fas fa-hands-helping", keywords: "outreach, inclusive" },
                    { title: "PepTalk Debate", desc: "Mentorship-focused debate training designed to empower middle and high school students through discourse.", link: "https://www.peptalkdebate.org/", type: "external", icon: "fas fa-bullhorn", keywords: "mentorship, pep talk" },
                    { title: "Vanguard Debate", desc: "Innovative tournament management and tabulation software designed for modern high-speed circuit efficiency.", link: "https://vanguarddebate.com/", type: "external", icon: "fas fa-shield-alt", keywords: "vanguard, tab, tournament" }
                ]
            },
            {
                title: "Equity & Community",
                bgColor: "bg-blue-50",
                resources: [
                    { title: "Women's Debate Inst.", desc: "Non-profit providing elite debate education for gender-marginalized students to bridge the equity gap.", link: "https://www.womensdebateinstitute.org/", type: "external", icon: "fas fa-female", keywords: "wdi, inclusive, equity" },
                    { title: "W.I.N. Instagram", desc: "Women in National Debate platform focusing on representation, success stories, and community highlights.", link: "https://instagram.debate101.org", type: "external", icon: "fab fa-instagram", keywords: "win, media, community" },
                    { title: "LD Docs (Email List)", desc: "Email to join the definitive LD debate google group for high-level technical discussion and evidence exchange.", link: "mailto:lddocs@groups.google.com?subject=Request%20to%20Join%20LD%20Docs%20Google%20Group&body=Hi%2C%20I've%20been%20suggested%20by%20debate101.org%20to%20ask%20if%20you%20could%20please%20add%20this%20email%20I'm%20writing%20from%3A%20%5Bfill%20email%20in%5D%20to%20the%20LD%20Docs%20Google%20Group%20please.%20Thanks%20a%20lot%2C", type: "external", icon: "fas fa-envelope-open-text", keywords: "email list, technical, ld" },
                    { title: "Architect Discord", desc: "Join our community hub for real-time round analysis, practice debates, and direct lead architect access.", link: "https://discord.debate101.org", type: "internal", icon: "fab fa-discord", keywords: "discord, community, chat, social" },
                    { title: "Debate 101 Instagram", desc: "Follow for circuit news, round highlights, upcoming lecture series announcements, and community features.", link: "https://instagram.debate101.org", type: "internal", icon: "fab fa-instagram", keywords: "instagram, social media, news" },
                    { title: "CDA Financial Aid", desc: "Essential resource for high school debaters seeking financial support and accessibility grants for competition.", link: "https://www.cdadebate.com/financial-aid", type: "external", icon: "fas fa-hand-holding-usd", keywords: "aid, grants, scholarships" },
                    { title: "r/Debate", desc: "The primary community hub for discussion on all competitive formats, including PF, LD, and Policy.", link: "https://www.reddit.com/r/Debate/", type: "external", icon: "fab fa-reddit-alien", keywords: "reddit, community, forum" }
                ]
            },
            {
                title: "Primary Research",
                bgColor: "bg-white",
                resources: [
                    { title: "Google Scholar", desc: "Standard entry point for scholarly literature, legal citations, and deep case law mining.", link: "https://scholar.google.com/", type: "external", icon: "fas fa-search", keywords: "scholar, research, data" },
                    { title: "JSTOR", desc: "Primary digital library for academic journals and social science archives essential for K-aff prep.", link: "https://www.jstor.org/", type: "external", icon: "fas fa-book-reader", keywords: "research, journals, academic" },
                    { title: "LexisNexis", desc: "Ultimate archive for news, legal records, and empirical government data used in high-level research.", link: "https://www.lexisnexis.com/en-us/gateway.page", type: "external", icon: "fas fa-gavel", keywords: "legal, news, empirics" },
                    { title: "Brookings", desc: "Non-partisan policy analysis white papers; invaluable for internal link cards and DA impacts.", link: "https://www.brookings.edu/", type: "external", icon: "fas fa-building", keywords: "policy, white papers, stats" },
                    { title: "Taylor & Francis Online", desc: "Vast repository of peer-reviewed journals covering humanities, social sciences, and geopolitics.", link: "https://www.tandfonline.com/", type: "external", icon: "fas fa-university", keywords: "research, journals, academic, taylor francis" },
                    { title: "EBSCOhost", desc: "Premier multi-disciplinary research database providing access to thousands of scholarly journals and periodicals.", link: "https://www.ebsco.com/", type: "external", icon: "fas fa-database", keywords: "database, ebsco, scholarly, articles" }
                ]
            }
        ];
//TEAMDATA
        const teamData = [
            {
                name: "Vivaan Shahani",
                role: "Co-Founder - Head of Web Development & Tool Creation",
                image: "assets/vivaan.png",
                blurb: "Strategic visionary architecting the intersection of economics, technology, and competitive debate.",
                depth: "Vivaan Shahani is a sophomore at Edgemont Jr/Sr High School in NY, currently in his third year of Lincoln-Douglas debate. His interest are centered around Lay/Trad Debate and LARP (Old schooled, I know). A frequent competitor on the National Circuit, Vivaan has found success at several major tournaments, reaching elimination rounds at both DSDS#1 and Harvard. Outside of the rounds, he is a multi-instrumentalist who plays the baritone saxophone in a jazz setting, a varsity lacrosse D-Pole, and a ameatur DJ (email vivaan.shahani@gmail.com to learn more about hiring me). Between his experience in Python and Swift programming, Vivaan is eager to apply his technical skills to help grow the resource hub at Debate101."
            },
            {
                name: "Max Feinstein",
                role: "Co-Founder - Head of Media Management and Analysis",
                image: "assets/max-f.png",
                blurb: "A specialist in postmodern literature and critical methodology, redefining competitive discourse through rigor.",
                depth: "Max Feinstein is a Freshman at The Altamont School in Birmingham, Alabama. He specializes in Kritikal debate and postmodern literature (Neoliberal logistics, Baudrillard, Nietzsche, Lacan, and Jung). Max values collaborative learning and strategic argument creation."
            },
            {
                name: "Max McBride",
                role: "Co-Founder - Head of Community Building and Outreach",
                image: "assets/max-m.jpg",
                blurb: "Specialist in geopolitical resolutions and empirical evidence analysis.",
                depth: "Max McBride is a freshman VLD debater at Isidore Newman School in New Orleans, Louisiana. He specializes in philosophical debate (Kant, Hobbes, Nietzsche, Mitleid arguments, Determinism and Skep, etc…) along with more traditional or lay debate, both locally and nationally. Max values personal ambition and contribution."
            },
            {
                name: "Arjun Gupta",
                role: "Co-Founder - Head of Lecture Creation & Debate Analysis",
                image: "assets/arjun.png",
                blurb: "Lead analyst for K-Aff argumentation and critical literature.",
                depth: "Arjun is a freshman at Edgemont Jr/Sr High School in NY, in his second year of debate. His debate interests mainly revolve around philosophy, theory, kritiks, and some tricks. He competes on the National Circuit, and has reached elimination rounds at tournaments like Emory and Stanford. Outside of debate, he likes hiking, skiing, playing golf, and coding, and he’s excited to work with Debate101."
            }
        ];
