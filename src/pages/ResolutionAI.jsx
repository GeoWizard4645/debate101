import Chat from "../components/Chat.jsx";

export default function ResolutionAI() {
    return (
        <div className="page">
            <div className="wrap-narrow">
                <header className="page-head">
                    <p className="eyebrow">On-device</p>
                    <h1 className="display">Resolution <em>AI.</em></h1>
                    <p className="lede">
                        Paste a resolution and get a first pass at both sides. The model runs entirely
                        inside your browser — no account, no server, no quota, and nothing you type
                        leaves this machine.
                    </p>
                </header>

                <Chat
                    kind="res"
                    placeholder="Enter a resolution…"
                    intro="Give me a resolution and I'll sketch a few affirmative and negative paths. I'm a very small model running on your device, so treat this as a starting point rather than a finished case."
                    seedPrompts={[
                        "Resolved: The United States ought to guarantee universal childcare.",
                        "Resolved: Justice requires open borders for human migration.",
                        "Resolved: AI development ought to be regulated by an international body.",
                    ]}
                />

                <p className="fine">
                    First use downloads roughly 100 MB of model weights into your browser's cache. After
                    that it works offline. If the answers look like nonsense, switch to CPU mode using
                    the link under the chat — some GPU drivers mis-run quantised models.
                </p>
            </div>
        </div>
    );
}
