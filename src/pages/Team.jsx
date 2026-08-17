/**
 * The Collective — founders, leaders, and collaborators.
 *
 * Bios in the data carry inline HTML (line breaks and entities) written by the
 * people themselves, so they are rendered as markup rather than escaped text.
 * That is a deliberate, contained exception: the content file is repo-owned and
 * reviewed, not user input.
 */

import { useState } from "react";
import Reveal from "../components/Reveal.jsx";
import { optimized, onImageError } from "../lib/images.js";

function Member({ member, index }) {
    const [open, setOpen] = useState(false);
    return (
        <article className="member">
            <span className="section-index">{String(index + 1).padStart(2, "0")}</span>
            <div className="member-photo">
                <img
                    src={optimized(member.image)}
                    alt={member.name}
                    loading="lazy"
                    decoding="async"
                    style={member.customStyle ? { objectPosition: "top" } : undefined}
                    onError={onImageError(member.image)}
                />
            </div>
            <div className="member-info">
                <h2>{member.name}</h2>
                <p className="mono member-role">{member.role}</p>
                <p className="member-blurb">{member.blurb}</p>
                <button className="linkish mono" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
                    {open ? "Hide full bio" : "Read full bio"}
                </button>
                {open && (
                    <div className="member-depth" dangerouslySetInnerHTML={{ __html: member.depth || "" }} />
                )}
            </div>
        </article>
    );
}

export default function Team({ content }) {
    const team = content?.team ?? [];
    const collaborators = content?.collaborators ?? [];

    return (
        <div className="page">
            <div className="wrap">
                <header className="page-head">
                    <p className="eyebrow">The collective</p>
                    <h1 className="display">
                        Built by <em>debaters,</em> mid-season.
                    </h1>
                    <p className="lede">
                        Debate 101 is run by high-school competitors who needed these tools themselves.
                        Everything we make is free and open source — free to reuse and adapt for
                        non-commercial debate prep.
                    </p>
                </header>

                <div className="member-list">
                    {team.map((m, i) => (
                        <Reveal key={m.name} delay={Math.min(i, 6) * 60}>
                            <Member member={m} index={i} />
                        </Reveal>
                    ))}
                </div>

                {collaborators.length > 0 && (
                    <section className="hub-cat" id="collaborators">
                        <div className="hub-cat-head">
                            <h2>Collaborators</h2>
                            <span className="mono">{collaborators.length}</span>
                        </div>
                        <div className="grid grid-3">
                            {collaborators.map((c, i) => (
                                <Reveal className="card" key={c.name} delay={i * 50}>
                                    <h3 className="card-title">{c.name}</h3>
                                    <p className="card-desc">{c.bio}</p>
                                </Reveal>
                            ))}
                        </div>
                    </section>
                )}

                <section className="join">
                    <h2 className="display">Want to build with us?</h2>
                    <p className="lede" style={{ marginTop: "1rem" }}>
                        We take contributors — writers, coders, lecturers, and people who just know a
                        corner of the activity well. Everything happens in the Discord.
                    </p>
                    <div className="hero-actions" style={{ marginTop: "1.75rem" }}>
                        <a className="btn" href="https://discord.debate101.org" target="_blank" rel="noopener">
                            Join the Discord
                        </a>
                        <a className="btn btn-ghost" href="https://github.com/GeoWizard4645/debate101" target="_blank" rel="noopener">
                            Contribute on GitHub
                        </a>
                    </div>
                </section>
            </div>
        </div>
    );
}
