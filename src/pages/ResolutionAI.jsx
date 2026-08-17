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
                    First use downloads about 1 GB of model weights into your browser's cache — a few
                    minutes on a normal connection, once. After that it loads in seconds and works
                    offline. Generation runs around 20 tokens a second on WebGPU, and the strip above
                    the input shows exactly what it is doing at every point.
                </p>
                <p className="fine">
                    On a machine without WebGPU it falls back to the CPU, which is considerably slower.
                    If answers ever look like nonsense rather than merely wrong, switch backends with
                    the link under the chat — some GPU drivers mis-run quantised models.
                </p>
            </div>
        </div>
    );
}
