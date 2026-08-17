/**
 * Screw Calculator — estimates where the bubble falls at a tournament and how
 * many teams on the bubble record miss the break.
 *
 * The model is the same one the previous site used: assume each round is a coin
 * flip, so records follow a binomial distribution over the prelim rounds, then
 * fill break slots from the top record down. It is a rough instrument and the
 * page says so.
 */

import { useMemo, useState } from "react";

function nCr(n, r) {
    if (r < 0 || r > n) return 0;
    let out = 1;
    for (let i = 1; i <= r; i++) out = (out * (n - r + i)) / i;
    return out;
}

export default function Screw() {
    const [entries, setEntries] = useState(120);
    const [rounds, setRounds] = useState(6);
    const [breakSize, setBreakSize] = useState(32);
    const [ran, setRan] = useState(false);

    const result = useMemo(() => {
        const distribution = [];
        for (let wins = rounds; wins >= 0; wins--) {
            const prob = nCr(rounds, wins) / Math.pow(2, rounds);
            distribution.push({
                wins,
                losses: rounds - wins,
                count: Math.round(entries * prob * 10) / 10,
            });
        }

        let slotsLeft = breakSize;
        let bubble = null;
        for (const item of distribution) {
            if (slotsLeft >= item.count) {
                slotsLeft -= item.count;
                item.status = "clear";
            } else if (slotsLeft > 0) {
                bubble = {
                    record: `${item.wins}-${item.losses}`,
                    slots: Math.round(slotsLeft * 10) / 10,
                    atRecord: item.count,
                    screwed: Math.round((item.count - slotsLeft) * 10) / 10,
                };
                item.status = "bubble";
                slotsLeft = 0;
            } else {
                item.status = "out";
            }
        }

        const max = Math.max(...distribution.map((d) => d.count), 1);
        return { distribution, bubble, max };
    }, [entries, rounds, breakSize]);

    return (
        <div className="page">
            <div className="wrap">
                <header className="page-head">
                    <p className="eyebrow">Tournament math</p>
                    <h1 className="display">Screw <em>Calculator.</em></h1>
                    <p className="lede">
                        Where does the bubble land, and how many teams on that record miss? Assumes every
                        round is a coin flip, which is exactly as crude as it sounds — treat it as a
                        sense of the shape, not a prediction.
                    </p>
                </header>

                <div className="screw-form">
                    <label>
                        <span className="mono">Entries</span>
                        <input type="number" min="2" max="1000" value={entries}
                               onChange={(e) => setEntries(Math.max(2, +e.target.value || 2))} />
                    </label>
                    <label>
                        <span className="mono">Prelim rounds</span>
                        <input type="number" min="1" max="12" value={rounds}
                               onChange={(e) => setRounds(Math.min(12, Math.max(1, +e.target.value || 1)))} />
                    </label>
                    <label>
                        <span className="mono">Break to</span>
                        <select value={breakSize} onChange={(e) => setBreakSize(+e.target.value)}>
                            {[64, 32, 16, 8, 4, 2].map((n) => (
                                <option key={n} value={n}>
                                    {n === 2 ? "Finals (2)" : n === 4 ? "Semis (4)" : n === 8 ? "Quarters (8)"
                                        : n === 16 ? "Octas (16)" : n === 32 ? "Doubles (32)" : "Triples (64)"}
                                </option>
                            ))}
                        </select>
                    </label>
                    <button className="btn" onClick={() => setRan(true)}>Calculate</button>
                </div>

                {ran && (
                    <section className="screw-results">
                        <p className="screw-verdict">
                            {result.bubble ? (
                                <>
                                    The bubble lands at <b>{result.bubble.record}</b>. About{" "}
                                    <b>{result.bubble.atRecord}</b> entries finish on that record for{" "}
                                    <b>{result.bubble.slots}</b> remaining slots — roughly{" "}
                                    <b>{result.bubble.screwed}</b> get screwed on speaks.
                                </>
                            ) : (
                                <>Every projected record clears the break at this size. No bubble.</>
                            )}
                        </p>

                        <div className="screw-chart">
                            {result.distribution.map((d) => (
                                <div className="screw-row" key={d.wins}>
                                    <span className="mono screw-record">{d.wins}-{d.losses}</span>
                                    <div className="screw-track">
                                        <span
                                            className={`screw-fill is-${d.status}`}
                                            style={{ width: `${(d.count / result.max) * 100}%` }}
                                        />
                                    </div>
                                    <span className="mono screw-count">{d.count}</span>
                                </div>
                            ))}
                        </div>

                        <ul className="legend mono">
                            <li><i className="is-clear" /> Clears</li>
                            <li><i className="is-bubble" /> Bubble</li>
                            <li><i className="is-out" /> Misses</li>
                        </ul>
                    </section>
                )}
            </div>
        </div>
    );
}
