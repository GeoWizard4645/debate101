import Chat from "../components/Chat.jsx";

export default function ResolutionAI() {
    return (
        <div className="page">
            <div className="wrap-narrow">
                <header className="page-head">
                    <p className="eyebrow">Cloud AI</p>
                    <h1 className="display">Resolution <em>AI.</em></h1>
                    <p className="lede">
                        Paste a resolution and get a first pass at both sides. Answers come from a
                        real model (GPT-OSS 20B on Groq) through our own proxy — no account, no
                        install, nothing to download.
                    </p>
                </header>

                <Chat
                    kind="res"
                    placeholder="Enter a resolution…"
                    intro="Give me a resolution and I'll sketch a few affirmative and negative paths. Treat this as a starting point rather than a finished case."
                    seedPrompts={[
                        "Resolved: The United States ought to guarantee universal childcare.",
                        "Resolved: Justice requires open borders for human migration.",
                        "Resolved: AI development ought to be regulated by an international body.",
                    ]}
                />

                <p className="fine">
                    Because the model runs in the cloud, what you type leaves this device — it goes
                    to our proxy, which calls Groq's API without ever exposing a key in your
                    browser. Most questions never reach the model at all — the debate engine
                    answers those instantly and exactly.
                </p>
                <p className="fine">
                    The site is free, and so is the model tier it runs on, so heavy days can hit a
                    daily cap. If that happens the engine still answers, and the model is back
                    tomorrow.
                </p>
            </div>
        </div>
    );
}
