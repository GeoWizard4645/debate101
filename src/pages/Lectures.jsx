/**
 * Lecture Lab — the video archive, grouped by argument style.
 *
 * Thumbnails are loaded from YouTube's static image host and the iframe is only
 * mounted once a lecture is opened, so the page does not pull in an embed per
 * video on first paint.
 */

import { useState } from "react";
import { Icon } from "../components/Chrome.jsx";
import Reveal from "../components/Reveal.jsx";

/** YouTube ids in the data sometimes carry a `?si=` share suffix. */
function cleanId(raw) {
    return String(raw || "").split("?")[0];
}

function Lecture({ item }) {
    const [open, setOpen] = useState(false);
    const id = cleanId(item.youtubeId);

    return (
        <div className="card lecture">
            {open ? (
                <div className="lecture-frame">
                    <iframe
                        src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1`}
                        title={item.title}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
                        allowFullScreen
                        loading="lazy"
                    />
                </div>
            ) : (
                <button className="lecture-thumb" onClick={() => setOpen(true)} aria-label={`Play: ${item.title}`}>
                    <img
                        src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`}
                        alt=""
                        loading="lazy"
                        onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
                    />
                    <span className="lecture-play"><Icon name="play" size={18} /></span>
                </button>
            )}
            <h3 className="card-title">{item.title}</h3>
            <p className="card-desc">{item.desc}</p>
        </div>
    );
}

export default function Lectures({ content }) {
    const categories = content?.lectures ?? [];
    const total = categories.reduce((a, c) => a + (c.lectures?.length ?? 0), 0);
    const populated = categories.filter((c) => (c.lectures?.length ?? 0) > 0);
    const empty = categories.filter((c) => (c.lectures?.length ?? 0) === 0);

    return (
        <div className="page">
            <div className="wrap">
                <header className="page-head">
                    <p className="eyebrow">Academy</p>
                    <h1 className="display">Lecture <em>Lab.</em></h1>
                    <p className="lede">
                        Recorded lectures and full rounds, organised by argument style. Everything is
                        free and hosted on our YouTube channel.
                    </p>
                    <div className="hub-meta">
                        <span className="mono"><b>{total}</b> video{total === 1 ? "" : "s"}</span>
                        <a className="mono ulink" href="https://youtube.debate101.org" target="_blank" rel="noopener">
                            Subscribe on YouTube <Icon name="external" size={11} />
                        </a>
                    </div>
                </header>

                {populated.map((cat) => (
                    <section className="hub-cat" key={cat.title}>
                        <div className="hub-cat-head">
                            <h2>{cat.title}</h2>
                            <span className="mono">{cat.lectures.length}</span>
                        </div>
                        <div className="grid grid-3">
                            {cat.lectures.map((l, i) => (
                                <Reveal key={l.title} delay={Math.min(i, 8) * 50}>
                                    <Lecture item={l} />
                                </Reveal>
                            ))}
                        </div>
                    </section>
                ))}

                {empty.length > 0 && (
                    <section className="hub-cat">
                        <div className="hub-cat-head">
                            <h2>In production</h2>
                            <span className="mono">{empty.length}</span>
                        </div>
                        <div className="grid grid-3">
                            {empty.map((c) => (
                                <div className="card lecture-soon" key={c.title}>
                                    <h3 className="card-title">{c.title}</h3>
                                    <p className="card-desc">
                                        Nothing published here yet. Requests go in the Discord and we record
                                        against them.
                                    </p>
                                    <a className="card-go mono" href="https://discord.debate101.org" target="_blank" rel="noopener">
                                        Request a lecture <Icon name="external" size={12} />
                                    </a>
                                </div>
                            ))}
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
}
