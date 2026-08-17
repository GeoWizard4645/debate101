#!/usr/bin/env python3
"""Map RTF index entries to resource hub categories and merge into content.json."""

import json
import re
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
CONTENT_PATH = ROOT / "data" / "content.json"

# Each entry: (title, desc, url, keywords, category_title)
RTF_ENTRIES = [
    # --- Field 1: Leagues & Governing Bodies ---
    ("NSDA (Speech & Debate)", "Primary US secondary forensic governing body; rulesets, honor society, and national tournament administration.", "https://www.speechanddebate.org/", "nsda, governing, national, speech", "Leagues & Governing Bodies"),
    ("CEDA", "Intercollegiate policy debate association governing non-restrictive policy debate and national rankings.", "https://cedadebate.org/", "ceda, policy, college, governing", "Leagues & Governing Bodies"),
    ("NDT", "Premier US collegiate policy debate championship under the American Forensic Association.", "https://ndtdebate.com/", "ndt, policy, college, championship", "Leagues & Governing Bodies"),
    ("APDA", "US collegiate off-topic parliamentary debate circuit governing rankings and tournament standards.", "https://apda.online/", "apda, parliamentary, college, circuit", "Leagues & Governing Bodies"),
    ("NPDA", "Largest US intercollegiate parliamentary debate organization with two-on-two extemporaneous policy debate.", "https://parlidebate.org/", "npda, parliamentary, college", "Leagues & Governing Bodies"),
    ("WSDC", "Global governing authority for international secondary school parliamentary-style debate.", "https://wsdc.net/", "wsdc, worlds, international, parliamentary", "Leagues & Governing Bodies"),
    ("Stoa USA", "National Christian home-school speech and debate organization governing regional leagues and NITOC.", "https://stoausa.org/", "stoa, homeschool, christian, nitoc", "Leagues & Governing Bodies"),
    ("IPDA", "Governing body for extemporaneous individual and team IPDA formats across collegiate and scholastic leagues.", "https://ipdadebate.info/", "ipda, parliamentary, governing", "Leagues & Governing Bodies"),
    ("AMTA", "Primary governing body for intercollegiate mock trial, publishing annual case materials and rules.", "https://collegemocktrial.org/", "mock trial, amta, college, governing", "Leagues & Governing Bodies"),
    ("NHSMTC", "Secondary school governing umbrella for state-level mock trial champions competing nationally.", "https://nhsmtc.org/", "mock trial, high school, national", "Leagues & Governing Bodies"),
    ("CSDF", "Bilingual national organization managing interprovincial secondary debate competitions across Canada.", "https://csdf-fcde.ca/", "canada, debate, bilingual, secondary", "Leagues & Governing Bodies"),
    ("ESU Debate", "International public speaking and debate organization running the Schools Mace and International Public Speaking Competition.", "https://esu.org/", "esu, international, public speaking, mace", "Leagues & Governing Bodies"),
    ("Australian Debating Federation", "National umbrella organization overseeing scholastic and tertiary debate associations across Australia.", "https://debating.org.au/", "australia, debate, governing, federation", "Leagues & Governing Bodies"),
    ("EUDC", "Governing framework for the annual European Universities Debating Championship in British Parliamentary format.", "https://eutwo.org/", "eudc, europe, bp, parliamentary", "Leagues & Governing Bodies"),
    ("IDEA", "Global network providing debate training, youth forums, civic communication initiatives, and educational guides.", "https://idebate.org/", "idea, global, training, civic", "Leagues & Governing Bodies"),
    ("Pan-American UDC", "Regional governing committee managing trilingual BP debate across the Americas.", "https://panamudc.org/", "panam, americas, bp, parliamentary", "Leagues & Governing Bodies"),
    ("AUDC", "Executive committee overseeing the primary Asian parliamentary debate championship circuit.", "https://audc.asia/", "audc, asia, bp, parliamentary", "Leagues & Governing Bodies"),
    ("WUDC", "World council overseeing the premier international British Parliamentary debating tournament.", "https://wudc.org/", "wudc, worlds, bp, international", "Leagues & Governing Bodies"),
    ("HSPDP", "Secondary school debate initiative focusing on structured, accessible parliamentary debate formats.", "https://hs-pdp.org/", "hspdp, parliamentary, high school", "Leagues & Governing Bodies"),
    ("MSPDP", "Middle school debate outreach framework promoting critical thinking and civic discourse.", "https://cspdp.org/", "mspdp, middle school, parliamentary", "Leagues & Governing Bodies"),
    ("NYC Urban Debate League", "Urban debate league providing access, tournament infrastructure, and coaching across New York City schools.", "https://nycudl.org/", "nyc, urban debate, equity, league", "Leagues & Governing Bodies"),
    ("Chicago Urban Debate League", "Urban debate league supporting competitive policy debate programs across Chicago Public Schools.", "https://chicagourbandebate.org/", "chicago, urban debate, policy, league", "Leagues & Governing Bodies"),
    ("Bay Area Urban Debate League", "San Francisco Bay Area urban debate organization expanding competitive policy debate access.", "https://baudl.org/", "bay area, urban debate, policy, league", "Leagues & Governing Bodies"),
    ("Houston Urban Debate League", "Greater Houston league providing tournament operations and evidence resources to public schools.", "https://houstonurbandebate.org/", "houston, urban debate, policy, league", "Leagues & Governing Bodies"),
    ("Dallas Urban Debate Alliance", "Dallas-based urban debate initiative operating middle and high school debate circuits.", "https://dallasurbandebate.org/", "dallas, urban debate, policy, league", "Leagues & Governing Bodies"),
    ("Detroit Urban Debate League", "Regional league operating policy debate infrastructure across Detroit public schools.", "https://detroitdebate.org/", "detroit, urban debate, policy, league", "Leagues & Governing Bodies"),
    ("Miami Urban Debate League", "Florida-based urban debate league expanding access to competitive speech and debate.", "https://miamiurbandebate.org/", "miami, urban debate, florida, league", "Leagues & Governing Bodies"),
    ("Great Lakes Debate League", "Midwestern regional debate circuit governing high school policy competitions.", "https://greatlakesdebate.org/", "great lakes, policy, regional, circuit", "Leagues & Governing Bodies"),
    ("DANEIS", "Regional independent school debate league managing parliamentary and public speaking competitions in New England.", "https://daneis.org/", "daneis, new england, independent schools, league", "Leagues & Governing Bodies"),
    ("Florida Forensic League", "State forensic association overseeing high school championship qualification and speech rulesets.", "https://floridaforensics.org/", "ffl, florida, forensics, state league", "Leagues & Governing Bodies"),
    ("GFCA", "Georgia Forensics Coaches Association establishing speech and debate rules, circuit rankings, and state tournaments.", "https://gfca.net/", "gfca, georgia, forensics, state league", "Leagues & Governing Bodies"),
    ("CHSSA", "California High School Speech Association managing forensic qualification and rules throughout California.", "https://cshssa.org/", "chssa, california, forensics, state league", "Leagues & Governing Bodies"),
    ("Texas Forensic Association", "Primary Texas high school forensic organization setting tournament qualification standards and rulesets.", "https://texasforensicassociation.com/", "tfa, texas, forensics, state league", "Leagues & Governing Bodies"),
    ("IHSA Speech", "Illinois High School Association governing high school speech and debate state finals.", "https://www.ihsa.org/sports-activities/speech", "ihsa, illinois, speech, state league", "Leagues & Governing Bodies"),
    ("PHSSL", "Pennsylvania High School Speech League overseeing district and state competitions.", "https://phssl.org/", "phssl, pennsylvania, speech, state league", "Leagues & Governing Bodies"),
    ("OHSSL", "Ohio High School Speech League organizing individual events, congress, and debate competitions.", "https://ohssl.org/", "ohssl, ohio, speech, state league", "Leagues & Governing Bodies"),
    ("MHSSL", "Massachusetts High School Speech and Debate League managing tournament calendars and state championships.", "https://mhssl.org/", "mhssl, massachusetts, speech, state league", "Leagues & Governing Bodies"),
    ("ALUD", "National network supporting urban debate leagues across major US metropolitan centers.", "https://urban-debate.org/", "alud, urban debate, national, equity", "Leagues & Governing Bodies"),
    ("International Forensic Association", "Global collegiate forensic association running international tournament events for speech and debate.", "https://internationalforensics.org/", "ifa, international, forensics, collegiate", "Leagues & Governing Bodies"),
    ("National Forensic Association", "Collegiate forensic organization governing NFA-LD policy debate and individual speech events.", "https://nationalforensicassociation.org/", "nfa, collegiate, ld, forensics", "Leagues & Governing Bodies"),
    # Tabulation -> Core Infrastructure / Debate Software
    ("Classrooms.cloud", "Integrated virtual venue management tool for video routing alongside Tabroom tournament operations.", "https://classrooms.cloud/", "virtual, tabroom, video, tournament", "Core Infrastructure"),
    ("NSDA Campus", "Secure online debate room utility designed specifically for Tabroom integration.", "https://www.speechanddebate.org/campus", "nsda, campus, online, tabroom", "Core Infrastructure"),
    ("ROPIR Tabulation", "Cloud-based speech tournament management and online video judging platform.", "https://ropir.com/", "ropir, tabulation, video judging", "Core Infrastructure"),
    ("ForensicsTab", "Cloud-native tabulation system built for rapid entry processing and live standings generation.", "https://forensicstab.com/", "forensicstab, tabulation, cloud", "Core Infrastructure"),
    ("Tournman Software", "Desktop debate pairing application used for localized policy and parliamentary tournaments.", "https://tournman.com/", "tournman, tabulation, desktop", "Core Infrastructure"),
    ("Tabroom Master (GitHub)", "Open-source utility scripts for automating complex sweepstakes calculations on Tabroom data exports.", "https://github.com/tabroom-master", "tabroom, github, sweepstakes, automation", "Core Infrastructure"),
    ("DebateManager", "Web tabulation engine designed for European and parliamentary debate tournament formats.", "https://debatemanager.com/", "debatemanager, tabulation, parliamentary", "Core Infrastructure"),
    ("Calico Tab System", "Lightweight web tabulator optimized for rapid small-circuit middle school and novice competitions.", "https://calicotab.com/", "calico, tabulation, novice", "Core Infrastructure"),
    ("Tabbycat Tabulation", "Open-source web-based tabulation system built for British Parliamentary and two-team formats.", "https://tabbycat.org/", "tabbycat, bp, tabulation, open source", "Core Infrastructure"),
    ("SpikTab", "Specialized tabulator handling complex tie-breaking matrices for European parliamentary debate leagues.", "https://spiktab.com/", "spiktab, tabulation, parliamentary", "Core Infrastructure"),
    ("TRPC", "Classic desktop tabulation system developed at Baylor University for policy debate pairings.", "https://www.baylor.edu/debate/trpc", "trpc, tabulation, policy, baylor", "Core Infrastructure"),
    ("CAT (Computer Assisted Tab)", "Foundational tabulation program developed at CSU Fullerton that laid groundwork for modern cloud engines.", "https://www.csufullerton.edu/debate", "cat, tabulation, csuf, policy", "Core Infrastructure"),
    ("SpeechPrep Tab Engine", "Web-based tabulation platform focusing on individual speech event snaking and judge assignment.", "https://speechprep.com/tab", "speechprep, tabulation, speech events", "Core Infrastructure"),
    ("Tabroom Help Center", "Official Tabroom registration and tournament management documentation.", "https://docs.tabroom.com/", "tabroom, docs, registration, help", "Core Infrastructure"),
    ("SpeechWire Manage", "SpeechWire tournament management portal for directors and registrants.", "https://manage.speechwire.com/", "speechwire, tabulation, tournament", "Core Infrastructure"),
    # Field 2: Evidence / Prep
    ("NDCA Open Evidence Project", "Free annual repository of evidence files produced by major summer debate institutes.", "https://opencaselist.com/openev", "open evidence, ndca, camp files", "Briefs & Curricula"),
    ("High School PF Caselist", "Dedicated Public Forum disclosure wiki tracking team positions and citations nationally.", "https://opencaselist.com/hspf", "pf, caselist, disclosure, opencaselist", "Prep Tools & Logic"),
    ("College Policy Caselist", "NDT/CEDA college policy disclosure wiki. This is where high schoolers download college files.", "https://opencaselist.com/ndtceda", "policy, caselist, college, disclosure", "Prep Tools & Logic"),
    ("College LD Caselist", "Intercollegiate NFA-LD disclosure platform for single-affirmative policy-style debate.", "https://opencaselist.com/nfald", "ld, caselist, college, disclosure", "Prep Tools & Logic"),
    ("APDA Web Archives", "Historical database of case outlines, resolution lists, and parliamentary debate results.", "https://apda.online/results", "apda, archives, parliamentary, results", "Prep Tools & Logic"),
    ("Cross-X.com Archives", "Historical discussion forum and evidence-exchange repository spanning decades of high school policy debate.", "https://cross-x.com/", "cross-x, policy, archives, forum", "Prep Tools & Logic"),
    ("PlanetDebate Archive", "Historical commercial evidence hub containing classic brief archives and lecture resources.", "https://planetdebate.com/", "planetdebate, archives, evidence, policy", "Prep Tools & Logic"),
    ("Paperless Debate Open Archive", "Legacy file repository hosting classic policy debate evidence files from the initial paperless transition.", "https://paperlessdebate.com/archive", "paperless, archive, policy, evidence", "Prep Tools & Logic"),
    ("Harvard Debate Case Archive", "Harvard's NDT/CEDA disclosure page on openCaselist — download college round files and cites.", "https://opencaselist.com/ndtceda/Harvard", "harvard, cases, archive, policy", "Prep Tools & Logic"),
    ("Northwestern Debate File Archive", "Northwestern's college policy disclosure page on openCaselist.", "https://opencaselist.com/ndtceda/Northwestern", "northwestern, files, policy, archive", "Prep Tools & Logic"),
    ("Wake Forest DRG", "Annual research guide providing background material and starter cards for national topics.", "https://debate.wfu.edu/drg", "wake forest, research guide, policy, cards", "Prep Tools & Logic"),
    ("Michigan State Debate File Vault", "Michigan State's college policy disclosure page on openCaselist.", "https://opencaselist.com/ndtceda/MichiganState", "msu, files, policy, evidence", "Prep Tools & Logic"),
    ("Emory Debate File Repository", "Emory's NDT/CEDA disclosure page on openCaselist.", "https://opencaselist.com/ndtceda/Emory", "emory, files, policy, research", "Prep Tools & Logic"),
    ("Kentucky Debate File Portal", "University of Kentucky's college policy disclosure page on openCaselist.", "https://opencaselist.com/ndtceda/Kentucky", "kentucky, files, policy, toc", "Prep Tools & Logic"),
    ("Berkeley Debate Case Library", "Cal Berkeley's college policy disclosure page on openCaselist.", "https://opencaselist.com/ndtceda/Berkeley", "berkeley, cases, policy, archive", "Prep Tools & Logic"),
    ("Dartmouth Debate Open Research", "Dartmouth's college policy disclosure page on openCaselist.", "https://opencaselist.com/ndtceda/Dartmouth", "dartmouth, research, policy, archive", "Prep Tools & Logic"),
    ("Texas Debate Research Archive", "UT Austin's college policy disclosure page on openCaselist.", "https://opencaselist.com/ndtceda/Texas", "texas, ut, policy, research", "Prep Tools & Logic"),
    ("Cornell Debate Evidence Base", "Cornell's college policy disclosure page on openCaselist.", "https://opencaselist.com/ndtceda/Cornell", "cornell, bp, parliamentary, briefs", "Prep Tools & Logic"),
    ("Vermont Debate Central", "UVM Lawrence Debate Union homepage.", "https://www.uvm.edu/cas/english/lawrence-debate-union", "vermont, evidence, research, archive", "Prep Tools & Logic"),
    ("Stanford Forensic Institute Archives", "Stanford National Forensic Institute. Camp files are released through Open Evidence.", "https://snfi.stanford.edu/", "snfi, stanford, camp files, archive", "Prep Tools & Logic"),
    ("George Mason Debate File Vault", "George Mason's college policy disclosure page on openCaselist.", "https://opencaselist.com/ndtceda/GeorgeMason", "gmu, policy, files, research", "Prep Tools & Logic"),
    ("Weber State Debate Files", "Weber State's NFA-LD disclosure page on openCaselist.", "https://opencaselist.com/nfald/WeberState", "weber, ld, policy, files", "Prep Tools & Logic"),
    ("Cardr Search Platform", "Cloud search and auto-citation generator pulling metadata from browser sessions into structured cards.", "https://cardrdebate.com/", "cardr, search, citation, cards", "Prep Tools & Logic"),
    ("OpenEv Search Engine", "NDCA Open Evidence — downloadable camp files from summer institutes, hosted on openCaselist.", "https://opencaselist.com/openev", "open evidence, search, camp files", "Prep Tools & Logic"),
    ("Ideastream Debate Search", "Semantic search tool targeting peer-reviewed law review articles formatted for policy debaters.", "https://ideastream.debate/", "ideastream, law review, search, policy", "Prep Tools & Logic"),
    ("QuickCard Search Engine", "Browser extension indexing instant card results from news sites based on debate tag parameters.", "https://quickcard.io/", "quickcard, extension, cards, search", "Prep Tools & Logic"),
    ("CardCutter AI Portal", "AI-assisted research tool automating article summaries and bibliographical citation formatting.", "https://cardcutter.ai/", "cardcutter, ai, cards, citation", "Prep Tools & Logic"),
    ("DebateSearch.io", "Natural language processing search engine indexing high school Lincoln-Douglas framework files.", "https://debatesearch.io/", "debatesearch, ld, framework, search", "Prep Tools & Logic"),
    ("CitationMachine Forensics", "Automated citation parser converted for quick-copying Verbatim-style references.", "https://citationmachine.net/forensics", "citation, verbatim, forensics", "Prep Tools & Logic"),
    ("DebateCard Indexer", "Open-source Python scraper indexing public policy document archives for card extraction.", "https://debatecardindexer.org/", "debatecard, indexer, scraper, policy", "Prep Tools & Logic"),
    ("CardVault Research Portal", "Encrypted cloud store for debate teams to maintain private prep databases and shared search indexes.", "https://cardvault.net/", "cardvault, prep, private, search", "Prep Tools & Logic"),
    ("FastCard Scraper (GitHub)", "Command-line utility for mass-scraping law journals and think tank outputs into docx card files.", "https://github.com/fastcard-debate", "fastcard, scraper, github, cards", "Prep Tools & Logic"),
    ("EvSearch Engine", "Lightweight research index searching through high school Public Forum brief archives.", "https://evsearch.org/", "evsearch, pf, briefs, search", "Prep Tools & Logic"),
    ("CaseFinder Engine", "Search database querying open caselists specifically for counterplan and disadvantage entry tags.", "https://casefinder.net/", "casefinder, caselist, cp, da", "Prep Tools & Logic"),
    ("PolicyCard Database", "High-performance SQL database indexing intercollegiate policy debate cards.", "https://policycard.db/", "policycard, database, policy, cards", "Prep Tools & Logic"),
    ("LexisNexis Academic", "Premier legal and news database used for primary research in Policy and Lincoln-Douglas debate.", "https://www.lexisnexis.com/academic", "lexisnexis, legal, academic, research", "Primary Research"),
    # Field 3: Paperless / Software
    ("CardMirror", "Cross-platform open-source ProseMirror editor matching Verbatim functionality on Windows, Mac, Linux, and Web.", "https://debate-decoded.ghost.io/", "cardmirror, verbatim, paperless, open source", "Debate Software & Docs"),
    ("Debate Template (Google Docs)", "Google Docs extension replicating paperless formatting macros for Chromebook environments.", "https://www.atlantadebate.org/", "google docs, template, chromebook, paperless", "Debate Software & Docs"),
    ("Verbatim Flow", "Excel-based digital flowing template distributed within the official Verbatim installation package.", "https://paperlessdebate.com/flow", "verbatim, flow, excel, paperless", "Debate Software & Docs"),
    ("Fast Debate Paste", "System tray utility accelerating text transfer and clean-pasting between browsers and debate editors.", "https://fastdebatepaste.com/", "fast debate paste, utility, paperless", "Debate Software & Docs"),
    ("FlexFlow Editor", "Multi-pane document reader optimized for live speech delivery and side-by-side case view.", "https://flexflowdebate.com/", "flexflow, delivery, paperless, reader", "Debate Software & Docs"),
    ("Verbatim Mini", "Stripped-down VBA macro template designed to bypass strict institutional IT and antivirus blocking.", "https://paperlessdebate.com/", "verbatim mini, paperless, word", "Debate Software & Docs"),
    ("MacroDebate", "Custom Word template suite optimized for speed-reading and high-contrast night viewing in rounds.", "https://macrodebate.org/", "macrodebate, word, paperless, template", "Debate Software & Docs"),
    ("DocxDebate Tools (GitHub)", "Python-based batch processing tool for repairing corrupt debate files and stripping invalid styles.", "https://github.com/docxdebate", "docxdebate, github, word, repair", "Debate Software & Docs"),
    ("StylePox Remover", "Utility built into CardMirror that automatically cleans corrupt Word XML formatting styles.", "https://debate-decoded.ghost.io/tools", "stylepox, cardmirror, word, formatting", "Debate Software & Docs"),
    ("DebateDoc Formatter", "Web application converting raw plain-text web cuts into formatted Word docx cards.", "https://debatedoc.com/", "debatedoc, formatter, cards, web", "Debate Software & Docs"),
    ("CardFormatter JS (GitHub)", "Client-side JavaScript library for re-highlighting and formatting text blocks in browser environments.", "https://github.com/cardformatter", "cardformatter, javascript, github, formatting", "Debate Software & Docs"),
    ("DebateFormat Google Workspace", "Official Google Workspace add-on providing card-tagging and citation insertion tools.", "https://workspace.google.com/", "google workspace, add-on, paperless", "Debate Software & Docs"),
    ("QuickTag Macro Suite", "Custom macro pack for Word focusing on single-keystroke tag summarization and font scaling.", "https://quicktagdebate.com/", "quicktag, word, macros, paperless", "Debate Software & Docs"),
    ("FastBlock Word Add-In", "Microsoft Word add-in providing floating navigation panes and drag-and-drop file merging.", "https://fastblock.io/", "fastblock, word, add-in, paperless", "Debate Software & Docs"),
    ("SmartCite Forensics", "Browser plugin parsing academic paper metadata into standardized Verbatim citations.", "https://smartcite.forensics/", "smartcite, citation, browser, verbatim", "Debate Software & Docs"),
    ("OpenDebate Editor", "Standalone lightweight markdown editor built specifically for paperless debate speech assembly.", "https://opendebateeditor.org/", "opendebate, markdown, editor, paperless", "Debate Software & Docs"),
    ("SpeechView Document Reader", "High-contrast presentation viewer for desktop computers designed to eliminate lag during speech delivery.", "https://speechview.net/", "speechview, delivery, reader, paperless", "Debate Software & Docs"),
    ("DebateSync Cloud Sync", "Local network sync utility allowing debate partners to share file changes in real time during prep.", "https://debatesync.io/", "debatesync, sync, prep, collaboration", "Debate Software & Docs"),
    ("FlowSheet Pro", "Web-based digital flowing canvas supporting multi-sheet cross-examination tracking.", "https://flowsheetpro.com/", "flowsheet, flowing, web, cross-ex", "Debate Software & Docs"),
    ("SimpleDebate Formatter", "Minimalist browser tool for cleaning and formatting news articles into single-page cards.", "https://simpledebate.org/", "simpledebate, formatter, cards, browser", "Debate Software & Docs"),
    ("Ebb Flowing App", "Native digital flowing canvas supporting real-time multi-column notation and cross-device sync.", "https://ebbdebate.com/", "ebb, flowing, digital, sync", "Technical Utilities"),
    ("DebTime Web Timer", "Minimalist high-visibility web timer tracking prep time and speech intervals across mobile and desktop.", "https://debtime.com/", "debtime, timer, web, prep", "Technical Utilities"),
    ("CDA Break Calculator (CT)", "Regional algorithmic calculator projecting tournament break points for high school leagues.", "https://ctdebate.org/calc", "cda, break calculator, ct, odds", "Calculators & Odds"),
    ("SMODI Rankings", "Statistical ranking engine evaluating Lincoln-Douglas debaters based on opponent strength and circuit depth.", "https://smodi.org/", "smodi, rankings, ld, circuit", "Calculators & Odds"),
    ("TOC Rankings Calculator", "Tracking engine compiling Tournament of Champions bid allocations and qualifying points.", "https://tocrankings.com/", "toc, bid, rankings, calculator", "Calculators & Odds"),
    ("FlowMaster App", "iOS and Android digital flowing utility featuring gesture-based column movement and speech timers.", "https://flowmaster.app/", "flowmaster, flowing, mobile, timer", "Technical Utilities"),
    ("Cross-Ex Timer", "Specialized timer tracking cross-examination and preparation intervals with visual alerts.", "https://crossextimer.com/", "cross-ex, timer, prep, speech", "Technical Utilities"),
    ("DebatePoints Calculator", "Analytical tool modeling speaker point distributions across judge cohorts to detect rating bias.", "https://debatepoints.com/", "speaker points, calculator, bias, analytics", "Calculators & Odds"),
    ("SpeakerPoint Normalizer (GitHub)", "Python library for tournament directors to normalize speaker points across disparate judge pools.", "https://github.com/speakerpoints", "speaker points, normalize, tab, github", "Calculators & Odds"),
    ("Parlimenu Timer", "Custom timing application designed for parliamentary debate, incorporating motion prep clocks.", "https://parlimenu.com/", "parlimenu, parliamentary, timer", "Technical Utilities"),
    ("MultiTimer Forensics", "Web utility managing simultaneous speech timers for congress chambers and speech panels.", "https://multitimerforensics.net/", "multitimer, congress, speech, timer", "Technical Utilities"),
    ("BreakPoint Simulator", "Monte Carlo simulation engine calculating expected break thresholds for large invitationals.", "https://breakpointsim.org/", "breakpoint, break, simulator, odds", "Calculators & Odds"),
    ("RoundRobin Calculator", "Matrix generator computing optimal round-robin pairings and judge rotation schedules.", "https://roundrobin.calc/", "round robin, pairings, calculator, tab", "Calculators & Odds"),
    ("SpeechPrep Clock", "Visual countdown timer designed for projected display in speech tournament preparation rooms.", "https://speechprep.com/clock", "speechprep, timer, speech events", "Technical Utilities"),
    ("DebateStats Analytics", "Analytical dashboard tracking historical win-loss records, side biases, and judge decisions.", "https://debatestats.io/", "debatestats, analytics, records, judges", "Calculators & Odds"),
    ("CircuitRank Calculator", "Elo-based ranking system calculating debater relative strength across circuit invitationals.", "https://circuitrank.com/", "circuitrank, elo, rankings, circuit", "Calculators & Odds"),
    ("PrepClock Web", "Minimalist preparation timer accessible via browser with high-contrast, low-power display modes.", "https://prepclock.web.app/", "prepclock, timer, prep, web", "Technical Utilities"),
    ("FlowSheet Web", "Collaborative browser-based flowing tool allowing real-time dual-user entry for team debate formats.", "https://flowsheetweb.io/", "flowsheet, flowing, collaborative, web", "Technical Utilities"),
    ("ForensicsTimer iOS", "Native iOS application managing speech, interp, and debate timing configurations.", "https://apps.apple.com/app/forensicstimer", "forensicstimer, ios, timer, speech", "Technical Utilities"),
    ("Auto Flow Generator", "Automated converter processing raw docx cases into structured Excel flow sheets.", "https://debate101.org/flow-02", "auto flow, excel, docx, debate101", "Technical Utilities"),
    # Field 4: Briefs
    ("Triumph Briefs", "Research briefs, topic analyses, and block sets for Public Forum and Lincoln-Douglas debaters.", "https://triumphbriefs.com/", "triumph, briefs, pf, ld", "Elite Organizations"),
    ("Kankee Briefs", "Free open-access Public Forum research briefs focusing on economic and empirical evidence.", "https://kankeebriefs.com/", "kankee, briefs, pf, free", "Elite Organizations"),
    ("Logos Debate (logosdebate.com)", "Curated debate briefs, Christian circuit guides, and rhetoric instructional modules.", "https://logosdebate.com/", "logos, briefs, christian, rhetoric", "Elite Organizations"),
    ("Outreach Debate", "Educational briefings and mentoring programs for under-resourced debate circuits.", "https://outreachdebate.org/", "outreach, equity, mentoring, briefs", "Elite Organizations"),
    ("PlanetDebate Brief Vault", "Historical and active topic analysis sets covering national high school policy resolutions.", "https://planetdebate.com/briefs", "planetdebate, briefs, policy, topic", "Briefs & Curricula"),
    ("Millennial Briefs", "Topic analysis briefs designed for Public Forum and Lincoln-Douglas debaters.", "https://millennialbriefs.com/", "millennial, briefs, pf, ld", "Briefs & Curricula"),
    ("Big Sky Briefs", "Regional brief publisher providing evidence sets for high school policy resolutions.", "https://bigskybriefs.com/", "big sky, briefs, policy, regional", "Briefs & Curricula"),
    ("Forensics Connection", "Instructional materials, interp scripts, and speech guides for forensic coaches.", "https://forensicsconnection.com/", "forensics connection, speech, interp, coaches", "Briefs & Curricula"),
    ("Debate Central Briefs", "Free policy debate research briefs published by the National Center for Policy Analysis.", "https://debatecentral.ncpa.org/", "debate central, policy, briefs, ncpa", "Briefs & Curricula"),
    ("Paradigm Briefs", "Starter evidence sets and argument outlines for novice and intermediate debaters.", "https://paradigmbriefs.com/", "paradigm, briefs, novice, evidence", "Briefs & Curricula"),
    ("Foundation Briefs", "Non-profit brief publisher providing free research packs to urban debate league students.", "https://foundationbriefs.com/", "foundation, briefs, urban, free", "Briefs & Curricula"),
    ("Cross-Ex Briefing Portal", "Community-contributed strategy blocks and evidence packs for policy debate resolutions.", "https://cross-ex.com/briefs", "cross-ex, briefs, policy, blocks", "Briefs & Curricula"),
    ("Extemp Genie Brief Engine", "Auto-aggregating news brief service designed for extemporaneous speech prep.", "https://extempgenie.com/", "extemp, genie, briefs, news", "Briefs & Curricula"),
    ("Prepd Brief Archives", "Historical research database and topic files from the Prepd platform.", "https://prepd.in/archives", "prepd, archives, briefs, extemp", "Briefs & Curricula"),
    ("West Coast Briefs", "Long-standing publisher of policy, LD, and individual events instructional handbooks.", "https://westcoastbriefs.com/", "west coast, briefs, policy, ld", "Briefs & Curricula"),
    ("Baylor Briefs", "University-produced policy debate handbook providing research on national topics.", "https://www.baylor.edu/debate/briefs", "baylor, briefs, policy, handbook", "Briefs & Curricula"),
    ("Wake Forest Briefs", "Topic briefs compiled by the Wake Forest debate program.", "https://debate.wfu.edu/briefs", "wake forest, briefs, policy", "Briefs & Curricula"),
    ("Michigan Briefs", "High school policy debate topic guides published by the University of Michigan.", "https://michigandebate.com/briefs", "michigan, briefs, policy, topic", "Briefs & Curricula"),
    ("Texas Debate Briefs", "Specialized brief packs targeting Texas Forensic Association topics and rulesets.", "https://texasbriefs.com/", "texas, briefs, tfa, policy", "Briefs & Curricula"),
    # Field 4: Video / Academy
    ("Bill Batterman (YouTube)", "Video library covering policy debate theory, file construction, flowing, and history.", "https://www.youtube.com/@BillBatterman", "batterman, youtube, policy, lectures", "Academy & Lectures"),
    ("HSR Debate Channel", "High school debate lecture channel targeting novice and intermediate skill progression.", "https://www.youtube.com/@HSRDebate", "hsr, youtube, lectures, high school", "Academy & Lectures"),
    ("Proteus Academy", "Advanced instructional modules on philosophy, kritiks, and persuasive rhetoric.", "https://proteusacademy.org/", "proteus, philosophy, kritik, coaching", "Academy & Lectures"),
    ("One-World Debate", "Video guides focusing on international parliamentary and global debate techniques.", "https://oneworlddebate.org/", "one world, parliamentary, international, video", "Academy & Lectures"),
    ("Go Fight Win Debate", "Video series and strategy articles focusing on Public Forum debate mechanics.", "https://gofightwindebate.com/", "go fight win, pf, strategy, video", "Academy & Lectures"),
    ("GoForensics", "Video and document repository for individual speech events, interp selection, and extemp prep.", "https://goforensics.org/", "goforensics, speech, interp, extemp", "Academy & Lectures"),
    ("Extemp Central", "Portal for extemporaneous speaking topic questions, strategy guides, and event news.", "https://extempcentral.com/", "extemp, central, speech, topics", "Academy & Lectures"),
    ("Kentucky Debate (YouTube)", "Recorded lectures from the Kentucky Debate Institute covering advanced policy topics.", "https://www.youtube.com/@KentuckyDebate", "kentucky, youtube, policy, kdi", "Academy & Lectures"),
    ("Gonzaga Debate (YouTube)", "Instructional recordings on flowing, cross-examination, and counterplan theory.", "https://www.youtube.com/@GonzagaDebate", "gonzaga, youtube, policy, flowing", "Academy & Lectures"),
    ("Dartmouth Debate (YouTube)", "Summer institute lectures on policy strategy, kritiks, and topicality.", "https://www.youtube.com/@DartmouthDebate", "dartmouth, youtube, policy, ddi", "Academy & Lectures"),
    ("Harvard Debate Council (YouTube)", "Demonstration rounds and public debate recordings hosted by Harvard University.", "https://www.youtube.com/@HarvardDebate", "harvard, youtube, policy, rounds", "Academy & Lectures"),
    ("SNFI Debate (YouTube)", "Instructional videos covering Lincoln-Douglas framework and Public Forum strategy.", "https://www.youtube.com/@SNFIDebate", "snfi, stanford, youtube, ld, pf", "Academy & Lectures"),
    ("Michigan Debate (YouTube)", "Policy debate instructional content, topic lectures, and demonstration rounds.", "https://www.youtube.com/@MichiganDebate", "michigan, youtube, policy, lectures", "Academy & Lectures"),
    ("Emory Debate (YouTube)", "Barkley Forum recordings, public debate events, and technical debate lectures.", "https://www.youtube.com/@EmoryDebate", "emory, youtube, policy, barkley", "Academy & Lectures"),
    ("Northwestern Debate (YouTube)", "Historical video archive of national championship debates and strategic lectures.", "https://www.youtube.com/@NorthwesternDebate", "northwestern, youtube, policy, rounds", "Academy & Lectures"),
    ("Wake Forest Debate (YouTube)", "Topic analysis videos and technical skill breakdowns for high school debaters.", "https://www.youtube.com/@WakeForestDebate", "wake forest, youtube, policy, analysis", "Academy & Lectures"),
    ("APDA Debate (YouTube)", "Recorded parliamentary debate final rounds, case demonstrations, and speech guides.", "https://www.youtube.com/@APDADebate", "apda, youtube, parliamentary, rounds", "Academy & Lectures"),
    ("WSDC Debate (YouTube)", "High-level international parliamentary debate demonstration matches and coaching seminars.", "https://www.youtube.com/@WSDCDebate", "wsdc, youtube, worlds, parliamentary", "Academy & Lectures"),
    ("British Parliamentary Debate Vault", "Aggregated video database of EUDC and WUDC grand final rounds and instructional workshops.", "https://bpdebate.tv/", "bp, eudc, wudc, video, finals", "Academy & Lectures"),
    ("Speech and Debate Canada (YouTube)", "Secondary school parliamentary debate instructional content and national finals recordings.", "https://www.youtube.com/@DebateCanada", "canada, youtube, parliamentary, finals", "Academy & Lectures"),
    ("SpeechUS Portal", "Educational portal providing sample speeches, interpretation cuttings, and original oratory guides.", "https://speechus.org/", "speechus, speech, oratory, interp", "Academy & Lectures"),
    ("Paperless Debate (Article)", "Historical paper on the transition to paperless debate workflows.", "https://digitalcommons.nl.edu/", "paperless, history, research, article", "Academy & Lectures"),
    # Field 5: Camps
    ("Gonzaga Debate Institute", "Comprehensive Policy institute offering extensive evidence production labs.", "https://gonzagadebate.org/", "gonzaga, gdi, policy, camp", "More Camps & Institutes"),
    ("Stanford National Forensic Institute", "Multi-event institute covering Policy, LD, PF, and Parliamentary debate.", "https://snfi.stanford.edu/", "snfi, stanford, camp, multi-event", "More Camps & Institutes"),
    ("VBI Institute", "Lincoln-Douglas and Public Forum summer academy by Victory Briefs.", "https://vbiinstitute.com/", "vbi, ld, pf, camp, victory briefs", "More Camps & Institutes"),
    ("Harvard Debate Council", "Advanced instruction in Policy, Public Forum, Lincoln-Douglas, and Speech.", "https://harvarddebate.org/", "harvard, camp, policy, ld, pf", "More Camps & Institutes"),
    ("Spartan Debate Institutes", "Intensive Policy debate program at Michigan State known for research labs.", "https://msudebate.com/", "msu, sdi, policy, camp", "More Camps & Institutes"),
    ("KU Debate Camp", "Midwest Policy debate training ground with deep historical success.", "https://kudebate.com/", "kansas, ku, policy, camp", "More Camps & Institutes"),
    ("Missouri State Debate Institute", "Accessible Policy and Public Forum debate workshop.", "https://www.missouristate.edu/", "msdi, missouri state, policy, pf, camp", "More Camps & Institutes"),
    ("Indiana University Debate Institute", "Policy and speech intensive summer program.", "https://indiana.edu/~debate", "indiana, idi, policy, camp", "More Camps & Institutes"),
    ("Georgia Debate Institutes", "Southeastern workshop catering to regional and national Policy debaters.", "https://georgiadebate.org/", "georgia, gdi, policy, camp", "More Camps & Institutes"),
    ("Cornell International Summer Debate", "Specialized program focusing on British Parliamentary and WSDC formats.", "https://www.cornell.edu/", "cornell, bp, wsdc, camp, international", "More Camps & Institutes"),
    ("Bay Area Speech & Debate Academies", "Regional training clinics targeting secondary speech and debate mastery.", "https://basda.org/", "basda, bay area, camp, speech", "More Camps & Institutes"),
    ("Oregon Debate and Speech Institute", "Northwest regional institute for individual events and debate formats.", "https://www.uoregon.edu/", "oregon, odsi, camp, speech", "More Camps & Institutes"),
    ("University of Miami Debate Institute", "Southeastern clinic specializing in Policy, PF, and Speech.", "https://www.miami.edu/debate", "miami, camp, policy, pf", "More Camps & Institutes"),
    ("POI Debate Institute", "Specialized workshop focusing on Program Oral Interpretation and Speech events at UC Berkeley.", "https://www.berkeley.edu/", "poi, berkeley, interp, speech, camp", "More Camps & Institutes"),
    ("UT Austin National Institute in Forensics", "Large-scale institute offering Policy, LD, PF, Interp, and Extemp labs.", "https://utspeechanddebate.org/", "ut austin, nif, camp, multi-event", "More Camps & Institutes"),
    ("Kentucky Debate Institute", "Summer camp hosted by the organizers of the Tournament of Champions.", "https://ci.uky.edu/debate", "kdi, kentucky, policy, toc, camp", "More Camps & Institutes"),
    ("UC Berkeley Debate Institute", "West Coast institute specializing in Policy debate, LD framework, and Parliamentary debate.", "https://berkeleydebate.com/", "berkeley, ucbi, policy, camp", "More Camps & Institutes"),
    ("UNT Debate Institute", "Regional workshop providing accessible Policy and Public Forum debate training.", "https://www.unt.edu/debate", "unt, camp, policy, pf", "More Camps & Institutes"),
    ("Wyoming Debate Institute", "High-altitude Policy debate workshop focusing on research efficiency and strategy.", "https://www.uwyo.edu/debate", "wyoming, camp, policy", "More Camps & Institutes"),
    ("SDI Public Forum Institute", "Dedicated Public Forum workshop at Michigan State focusing on evidence analysis and delivery.", "https://msudebate.com/pf", "msu, pf, sdi, camp", "More Camps & Institutes"),
    ("Mean Green Debate Institute", "Intensive summer camp targeting Texas circuit and national TFA debaters.", "https://meangreendebate.com/", "unt, mean green, texas, camp", "More Camps & Institutes"),
    ("Florida Forensics Institute", "Summer institute catering to speech events, Original Oratory, Extemp, and PF.", "https://ffi.org/", "ffi, florida, speech, camp", "More Camps & Institutes"),
    ("Southwest Debate Institute", "Regional clinic serving Arizona, New Mexico, and Utah speech and debate competitors.", "https://www.asu.edu/", "southwest, asu, camp, regional", "More Camps & Institutes"),
    ("Midwest Debate Institute", "Midwest summer workshop focusing on novice and intermediate skill advancement.", "https://www.truman.edu/", "midwest, truman, camp, novice", "More Camps & Institutes"),
    ("Capitol Debate Camps", "National summer camp provider running Public Forum, LD, and Speech workshops.", "https://capitoldebate.com/", "capitol, camp, pf, ld, speech", "More Camps & Institutes"),
    ("Summit Debate Workshops", "High-level Public Forum, Congressional Debate, and Individual Events summer institute.", "https://summitdebate.com/", "summit, camp, pf, congress", "More Camps & Institutes"),
    ("Institute for Speech and Debate", "National summer program specializing in Public Forum, Speech, and Congressional debate.", "https://isdebedu.org/", "isd, camp, pf, speech, congress", "More Camps & Institutes"),
    ("National Debate Forum", "Elite Public Forum and Lincoln-Douglas summer debate camp.", "https://nationaldebateforum.com/", "ndf, camp, pf, ld", "More Camps & Institutes"),
    ("Champion Debate Institute", "Florida summer institute focusing on Public Forum and Lincoln-Douglas formats.", "https://championdebate.com/", "champion, camp, pf, ld, florida", "More Camps & Institutes"),
    # Field 6: Philosophy - Critical & Phil Hub / Philosophy & Critical Theory
    ("PhilSci-Archive", "Open-access archive for preprints and papers in the philosophy of science.", "https://philsci-archive.pitt.edu/", "philosophy of science, preprints, archive", "Philosophy & Critical Theory"),
    ("Continental Philosophy Online", "Repository indexing primary texts in phenomenology, existentialism, and post-structuralism.", "https://continental-philosophy.org/", "continental, phenomenology, existentialism", "Philosophy & Critical Theory"),
    ("Utilitarianism.com Archive", "Digital library of classic and contemporary texts on consequentialist moral theory.", "https://utilitarianism.com/", "utilitarianism, ethics, consequentialism", "Philosophy & Critical Theory"),
    ("Kantian Philosophy", "Repository dedicated to Immanuel Kant's deontological ethics, critique, and moral law.", "https://kant.org/", "kant, deontology, ethics, philosophy", "Philosophy & Critical Theory"),
    ("Ethics Archive Online", "Collection of primary source documents covering normative and applied ethical frameworks.", "https://ethicsarchive.org/", "ethics, normative, applied, archive", "Philosophy & Critical Theory"),
    ("Nietzsche Source", "Primary digital edition of Friedrich Nietzsche's philosophical works and fragments.", "https://nietzschesource.org/", "nietzsche, philosophy, primary texts", "Philosophy & Critical Theory"),
    ("Foucault Info Repository", "Resource site collecting lectures, interviews, and primary texts by Michel Foucault.", "https://foucault.info/", "foucault, biopolitics, philosophy, kritik", "Philosophy & Critical Theory"),
    ("Lacan.com Archive", "Psychoanalytic resource hub covering Jacques Lacan, Slavoj Žižek, and critical theory.", "https://lacan.com/", "lacan, zizek, psychoanalysis, kritik", "Philosophy & Critical Theory"),
    ("Heidegger Research Network", "Academic archive indexing texts on phenomenology, ontology, and existentialism.", "https://heidegger.org/", "heidegger, phenomenology, ontology", "Philosophy & Critical Theory"),
    ("Derrida Online Portal", "Deconstruction theory archive collecting primary essays and commentary on Jacques Derrida.", "https://derrida.org/", "derrida, deconstruction, philosophy", "Philosophy & Critical Theory"),
    ("Habermas Archive", "Text repository focusing on communicative action, public sphere, and discourse ethics.", "https://habermas.org/", "habermas, discourse ethics, philosophy", "Philosophy & Critical Theory"),
    ("Pragmatism Cybrary", "Resource hub for American pragmatism covering John Dewey, Charles Peirce, and Richard Rorty.", "https://pragmatism.org/", "pragmatism, dewey, peirce, philosophy", "Philosophy & Critical Theory"),
    ("Environmental Ethics Archive", "Center for Environmental Philosophy repository on ecocentrism and deep ecology.", "https://cep.unt.edu/archive", "environmental ethics, ecology, philosophy", "Philosophy & Critical Theory"),
    ("Animal Ethics Repository", "Research hub analyzing animal rights, anti-speciesism, and moral extensionism.", "https://animalethics.org/", "animal ethics, speciesism, philosophy", "Philosophy & Critical Theory"),
    ("Episteme Research Network", "Philosophical database covering formal epistemology, social epistemology, and justification.", "https://episteme.org/", "epistemology, philosophy, justification", "Philosophy & Critical Theory"),
    ("Political Theory Daily", "Aggregator indexing articles on normative political philosophy and democratic theory.", "https://politicaltheorydaily.com/", "political theory, philosophy, aggregator", "Philosophy & Critical Theory"),
    ("Existentialism Web Index", "Primary resource archive covering Sartre, Camus, Beauvoir, and existential phenomenology.", "https://existentialism.com/", "existentialism, sartre, camus, philosophy", "Philosophy & Critical Theory"),
    ("Critical Race Theory Archive", "Collection of foundational legal and theoretical texts defining Critical Race Theory.", "https://crt-archive.org/", "crt, critical race theory, law, kritik", "Philosophy & Critical Theory"),
    ("Decoloniality & Anti-Colonial Hub", "Resource hub indexing works on Indigenous sovereignty, settler-colonial critiques, and decoloniality.", "https://decoloniality.org/", "decolonial, anti-colonial, indigenous, kritik", "Philosophy & Critical Theory"),
    ("Psychoanalytic Studies Archive", "Text database covering Lacanian, Freudian, and Žižekian psychoanalytic literature.", "https://psychoanalysis-research.org/", "psychoanalysis, lacan, freud, kritik", "Philosophy & Critical Theory"),
    ("Biopolitics Web Index", "Bibliographies and essays on Foucault, Agamben, and Esposito's theories of state power and biopolitics.", "https://biopolitics.org/", "biopolitics, foucault, agamben, kritik", "Philosophy & Critical Theory"),
    ("Afrofuturism & Black Studies Portal", "Academic directory indexing foundational literature on Afropessimism and the Black radical tradition.", "https://blackstudiesportal.org/", "afropessimism, black studies, kritik", "Philosophy & Critical Theory"),
    ("Post-Humanism Research Network", "Research database covering Object-Oriented Ontology, new materialism, and eco-criticisms.", "https://posthuman-network.org/", "posthumanism, ooo, materialism, kritik", "Philosophy & Critical Theory"),
    ("Queer Theory Text Collective", "Digital archive interrogating heteronormativity, queer pessimism, and gender performativity.", "https://queertheory.org/", "queer theory, gender, kritik", "Philosophy & Critical Theory"),
    ("Global South Studies Hub", "Critical platform analyzing post-colonialism, subaltern studies, and non-Western international relations.", "https://globalsouthstudies.org/", "global south, postcolonial, subaltern, kritik", "Philosophy & Critical Theory"),
    ("Indigenous Law & Sovereignty Center", "Resource hub detailing tribal sovereignty, federal Indian law, and settler colonialism.", "https://indigenouslaw.org/", "indigenous, sovereignty, law, kritik", "Philosophy & Critical Theory"),
    ("Disability Studies Quarterly", "Open-access academic journal offering core literature for ableism and disability kritiks.", "https://dsq-sds.org/", "disability, ableism, kritik, journal", "Philosophy & Critical Theory"),
    ("Anti-Capitalist Research Network", "Archive of economic critiques targeting neoliberalism, global financial systems, and commodity fetishism.", "https://anticapitalistresearch.net/", "anticapitalist, cap k, neoliberalism, kritik", "Philosophy & Critical Theory"),
    ("CCRU Archive", "Text archive covering accelerationism, cybernetics, and post-structural culture theory.", "https://ccru.net/", "ccru, accelerationism, kritik", "Philosophy & Critical Theory"),
    ("Critical Pedagogy Library", "Primary source texts on Paulo Freire, radical education, and classroom power dynamics.", "https://criticalpedagogy.org/", "critical pedagogy, freire, education, kritik", "Philosophy & Critical Theory"),
    ("Feminist Theory Web Portal", "Directory indexing primary literature across radical, materialist, and intersectional feminism.", "https://feministtheory.org/", "feminism, feminist theory, kritik", "Philosophy & Critical Theory"),
    ("Surveillance Studies Network", "Academic network providing research on panopticism, state surveillance, and data security.", "https://surveillance-studies.net/", "surveillance, panopticism, kritik", "Philosophy & Critical Theory"),
    ("Borderlands Critical Journal", "Refereed journal focusing on postcolonialism, migration, sovereignty, and critical theory.", "https://borderlands.net.au/", "borderlands, postcolonial, migration, kritik", "Philosophy & Critical Theory"),
    ("Mass Incarceration Research Hub", "Empirical and critical evidence database targeting the prison-industrial complex.", "https://massincarcerationresearch.org/", "mass incarceration, prison, kritik", "Philosophy & Critical Theory"),
    ("Environmental Justice Network", "Resource portal documenting environmental racism, climate justice, and frontline resistance.", "https://ejnet.org/", "environmental justice, climate, kritik", "Philosophy & Critical Theory"),
    # Field 7: Think Tanks
    ("Center for American Progress", "Research institute producing proposals on economic growth, social justice, and national security.", "https://americanprogress.org/", "cap, progressive, policy, think tank", "Think Tanks & Policy"),
    ("Belfer Center", "Harvard Kennedy School center focusing on nuclear security, cyber policy, and strategy.", "https://www.belfercenter.org/", "belfer, harvard, nuclear, security", "Think Tanks & Policy"),
    ("Jamestown Foundation", "Specialized research organization analyzing security and intelligence across Eurasia and China.", "https://jamestown.org/", "jamestown, eurasia, china, security", "Think Tanks & Policy"),
    ("Lowy Institute", "Policy think tank providing analysis on Australia, the Indo-Pacific, and global power dynamics.", "https://www.lowyinstitute.org/", "lowy, australia, indo-pacific, policy", "Think Tanks & Policy"),
    ("Observer Research Foundation", "Indian policy think tank covering Asian geopolitics, technology, and economic development.", "https://www.orfonline.org/", "orf, india, asia, geopolitics", "Think Tanks & Policy"),
    ("Center for European Policy Analysis", "Public policy institution dedicated to fostering transatlantic security and democratic resilience.", "https://cepa.org/", "cepa, europe, transatlantic, security", "Think Tanks & Policy"),
    ("CISAC (Stanford)", "Stanford University center analyzing biosecurity, nuclear risk, and cyber safety.", "https://cisac.fsi.stanford.edu/", "cisac, stanford, biosecurity, nuclear", "Think Tanks & Policy"),
    ("Stimson Center", "Nonpartisan policy institute focusing on global security, arms control, and environmental protection.", "https://www.stimson.org/", "stimson, arms control, security, policy", "Think Tanks & Policy"),
    ("Hudson Institute", "Strategic research organization focusing on defense, international trade, and energy policy.", "https://www.hudson.org/", "hudson, defense, trade, policy", "Think Tanks & Policy"),
    ("Center for Naval Analyses", "Federally funded research center conducting operations research for the US Navy and Marines.", "https://www.cna.org/", "cna, navy, defense, research", "Think Tanks & Policy"),
    ("Institute for Defense Analyses", "Non-profit corporation advising the Department of Defense on national security issues.", "https://www.ida.org/", "ida, defense, dod, research", "Think Tanks & Policy"),
    ("Center for International Policy", "Foreign policy institute advocating for demilitarization and human rights.", "https://ciponline.org/", "cip, foreign policy, demilitarization", "Think Tanks & Policy"),
    ("Freedom House", "Non-profit organization tracking global democracy, political rights, and civil liberties.", "https://freedomhouse.org/", "freedom house, democracy, human rights", "Think Tanks & Policy"),
    ("European Policy Centre", "Brussels-based think tank focusing on European integration, economic policy, and foreign affairs.", "https://www.epc.eu/", "epc, europe, brussels, policy", "Think Tanks & Policy"),
    ("Center for Strategic and Budgetary Assessments", "Independent defense research institute specializing in military strategy and force structure.", "https://csbaonline.org/", "csba, defense, military, strategy", "Think Tanks & Policy"),
    ("European Council on Foreign Relations", "Pan-European think tank conducting research on European foreign and security policy.", "https://ecfr.eu/", "ecfr, europe, foreign policy", "Think Tanks & Policy"),
    ("East-West Center", "Education and research organization promoting relations between the US, Asia, and the Pacific.", "https://www.eastwestcenter.org/", "east-west, asia, pacific, policy", "Think Tanks & Policy"),
    ("German Marshall Fund", "Nonpartisan policy organization promoting transatlantic cooperation on security and democracy.", "https://www.gmfus.org/", "gmf, transatlantic, democracy, policy", "Think Tanks & Policy"),
    ("International Institute for Strategic Studies", "UK-based authority on military conflict, defense capability, and arms control assessments.", "https://www.iiss.org/", "iiss, defense, military, uk", "Think Tanks & Policy"),
    ("Royal United Services Institute", "British defense and security think tank producing strategic military research.", "https://rusi.org/", "rusi, uk, defense, military", "Think Tanks & Policy"),
    ("Center for a New American Security", "Defense strategy think tank specializing in Indo-Pacific security, national security tech, and deterrence.", "https://www.cnas.org/", "cnas, defense, indo-pacific, security", "Think Tanks & Policy"),
    ("NBER", "Economic working papers and quantitative econometric research studies.", "https://www.nber.org/", "nber, economics, working papers", "Government Data & Records"),
    ("Center on Budget and Policy Priorities", "Research institute analyzing domestic fiscal policy and assistance programs.", "https://www.cbpp.org/", "cbpp, budget, fiscal, policy", "Think Tanks & Policy"),
    ("World Resources Institute", "Environmental policy research organization focusing on climate risk and resource management.", "https://www.wri.org/", "wri, environment, climate, policy", "Think Tanks & Policy"),
    ("Center for Global Development", "Research institute focusing on international development, foreign aid, and global health.", "https://www.cgdev.org/", "cgd, development, aid, global health", "Think Tanks & Policy"),
    ("Center for Economic and Policy Research", "Economic analysis group focusing on employment, welfare, and macroeconomics.", "https://cepr.net/", "cepr, economics, macro, policy", "Think Tanks & Policy"),
    ("Baker Institute for Public Policy", "Rice University think tank specializing in energy policy, global health, and foreign policy.", "https://www.bakerinstitute.org/", "baker, rice, energy, policy", "Think Tanks & Policy"),
    ("UN Digital Library", "Repository of UN documents, voting records, and international security publications.", "https://digitallibrary.un.org/", "un, documents, international, library", "Government Data & Records"),
    ("IMF eLibrary", "Publications archive covering global economic surveillance, financial stability, and trade.", "https://elibrary.imf.org/", "imf, economics, global, publications", "Government Data & Records"),
    ("Harvard Dataverse", "Open research data repository hosting social science datasets and replication files.", "https://dataverse.harvard.edu/", "dataverse, harvard, datasets, research", "Government Data & Records"),
    ("NTIS", "Repository for US government-sponsored research, engineering, and technical reports.", "https://www.ntis.gov/", "ntis, government, technical, reports", "Government Data & Records"),
    ("Oyez Supreme Court Archive", "Unofficial archive of US Supreme Court oral arguments, decision summaries, and judge opinions.", "https://www.oyez.org/", "oyez, supreme court, law, oral arguments", "Government Data & Records"),
    ("Law Library of Congress", "World's largest collection of legal materials, foreign legislation, and legal reports.", "https://www.law.gov/", "law library, congress, legal, legislation", "Government Data & Records"),
    ("Congressional Record", "Official record of the debates and proceedings of the United States Congress.", "https://www.congress.gov/congressional-record", "congressional record, congress, debates", "Government Data & Records"),
    ("US Census Open Data", "Official platform for accessing demographic, social, and economic data across US populations.", "https://data.census.gov/", "census, data, demographics, statistics", "Government Data & Records"),
    ("EPA Research", "Federal scientific database detailing air quality, water safety, and climate assessments.", "https://www.epa.gov/research", "epa, environment, climate, research", "Government Data & Records"),
    # Extra links from RTF footer / research notes
    ("Yale OCS — Policy & Think Tanks", "Career strategy guide to policy research institutions and think tank employment.", "https://ocs.yale.edu/", "yale, think tanks, policy, careers", "Think Tanks & Policy"),
    ("UVA Economics — Think Tanks", "University of Virginia economics department guide to major US think tanks.", "https://economics.virginia.edu/", "uva, think tanks, economics, guide", "Think Tanks & Policy"),
    ("Think Tank Alert Rankings", "Independent rankings and alerts tracking think tank influence and publications.", "https://thinktankalert.com/", "think tank, rankings, alert", "Think Tanks & Policy"),
    ("Institute for China-America Studies", "Research on China-US relations and strategic competition.", "https://chinaus-icas.org/", "china, us, foreign policy, research", "Think Tanks & Policy"),
    ("Frontiers — Strategic Knowledge Networks", "Academic research on American strategic knowledge networks and global order.", "https://www.frontiersin.org/", "frontiers, research, strategy, networks", "Research Databases"),
    ("ResearchGate — US Think Tanks", "Academic paper on the evolution and roles of think tanks in the United States.", "https://www.researchgate.net/", "researchgate, think tanks, academic", "Research Databases"),
    ("State.gov — Think Tank Jobs", "Historical State Department resource on careers in think tanks and policy research.", "https://2009-2017.state.gov/", "state department, think tanks, careers", "Think Tanks & Policy"),
    ("Tillväxtanalys — US Think Tanks", "Swedish government analysis of think tank landscape in the United States.", "https://www.tillvaxtanalys.se/", "think tanks, analysis, sweden", "Think Tanks & Policy"),
    ("Wikipedia — Libertarianism", "Overview article useful as a starting point for libertarian framework research.", "https://en.wikipedia.org/wiki/Libertarianism", "wikipedia, libertarianism, philosophy", "Philosophy & Critical Theory"),
    ("Scribd — College 101 Guide", "General educational guide occasionally referenced in debate prep contexts.", "https://www.scribd.com/", "scribd, guide, education", "Briefs & Curricula"),
    ("Reddit r/geopolitics — Think Tanks", "Community discussion thread on think tank resources and geopolitical analysis.", "https://www.reddit.com/r/geopolitics/", "reddit, geopolitics, think tanks", "News & Analysis"),
    ("Debate101 Strategic Assets", "Centralized index of curated research bases, lecture vaults, and strategy modules.", "https://debate101.org/", "debate101, hub, resources, strategy", "Core Infrastructure"),
]


def normalize_host(url: str) -> str | None:
    if not url or url.startswith("#") or url.startswith("mailto:"):
        return None
    if not url.startswith("http"):
        return None
    p = urlparse(url.strip())
    host = p.netloc.lower().replace("www.", "")
    path = re.sub(r"/+$", "", p.path.lower())
    return f"{host}{path}"


def host_only(norm: str) -> str:
    return norm.split("/")[0]


def is_duplicate(existing_norms: set[str], url: str) -> bool:
    n = normalize_host(url)
    if not n:
        return True
    if n in existing_norms:
        return True
    h = host_only(n)
    for e in existing_norms:
        if host_only(e) == h:
            # Same host - check if paths are compatible
            if n == e or n.startswith(e) or e.startswith(n):
                return True
            # Special: treat root and www home as duplicate of any path on same org if title matches closely
            if path_is_home(n) and path_is_home(e):
                return True
    return False


def path_is_home(norm: str) -> bool:
    return "/" not in norm or norm.endswith(".org") or norm.endswith(".com") or norm.endswith(".edu") or norm.endswith(".net")


def make_resource(title, desc, link, keywords):
    return {
        "title": title,
        "desc": desc,
        "link": link,
        "type": "external",
        "icon": "fas fa-link",
        "keywords": keywords,
    }


def main():
    with open(CONTENT_PATH) as f:
        content = json.load(f)

    cat_map = {c["title"]: c for c in content["resources"]}

    existing_norms = set()
    for cat in content["resources"]:
        for r in cat["resources"]:
            n = normalize_host(r["link"])
            if n:
                existing_norms.add(n)

    added = []
    skipped = []
    for title, desc, url, keywords, category in RTF_ENTRIES:
        if is_duplicate(existing_norms, url):
            skipped.append((title, url))
            continue
        n = normalize_host(url)
        if not n:
            skipped.append((title, url))
            continue
        if category not in cat_map:
            print(f"WARNING: unknown category {category} for {title}")
            continue
        resource = make_resource(title, desc, url, keywords)
        cat_map[category]["resources"].append(resource)
        existing_norms.add(n)
        added.append((category, title, url))

    with open(CONTENT_PATH, "w") as f:
        json.dump(content, f, indent=2)
        f.write("\n")

    print(f"Added: {len(added)}")
    print(f"Skipped (duplicate): {len(skipped)}")
    by_cat = {}
    for cat, title, url in added:
        by_cat.setdefault(cat, []).append(title)
    for cat, titles in sorted(by_cat.items()):
        print(f"\n{cat} (+{len(titles)}):")
        for t in titles:
            print(f"  - {t}")


if __name__ == "__main__":
    main()
