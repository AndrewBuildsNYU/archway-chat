# Archway Chat

A streaming, multi-turn chatbot that runs entirely in the browser and talks to the
**NYU Archway** — NYU's API gateway in front of the AI vendors it holds keys for.

It demonstrates the core Archway loop end to end: list the models *this key* is allowed
to call, stream a completion back token by token, and read the `X-NYU-*` accounting
headers the gateway returns with every response.

## Try it

<https://andrewbuildsnyu.github.io/archway-chat/>

It is already pointed at the Archway — there is no server to run and nothing to install.
The only thing you supply is your own key.

## Get a key

Issue one from the Archway portal, at `/portal` on the gateway. If you do not know where
that is, ask whoever runs your Archway.

Make it a **low-quota key**. A browser app necessarily holds its key in the page, so
anyone with your screen, your devtools, or your laptop has the key. This app keeps it in
`sessionStorage`, which means it is gone when you close the tab, and it is sent to the
Archway and nowhere else. Never paste a high-quota or shared key into a browser demo, and
revoke a key from the portal the moment you are done with it.

## Run it locally

```
git clone https://github.com/AndrewBuildsNYU/archway-chat.git
cd archway-chat
```

Then open `index.html`. No build step, no dependencies, no npm.

Opening the file directly gives the page a `null` origin, which a gateway's CORS policy
may reject. If calls fail on that, serve the folder instead:

```
python -m http.server 8000
```

and browse to the address it prints. That only serves the static page — the API calls
still go to the same Archway the published app uses. There is no local gateway anywhere in
this example.

To point the app at a *different* Archway, edit the `BASE_URL` constant at the top of
`assets/archway.js`. There is deliberately no field for it in the UI: an endpoint a visitor
can retype is an endpoint a visitor can be *told* to retype, which is one screenshot away
from sending an NYU key to somebody else's server. Whichever gateway you point at must list
your page's origin in `NYU_CORS_ALLOWED_ORIGINS`, or the browser blocks the request before
it is ever sent.

## How it works

The interesting part is the turn loop in `assets/app.js`.

**Context is the transcript.** The gateway is stateless: there is no conversation id. Each
turn sends the whole prior `messages` array plus the new user message, so the model sees
the history. An optional system prompt is passed as `system` on its own and the client
turns it into a `role: "system"` message — a top-level `system` field would be forwarded
to the vendor and rejected.

**Streaming and stopping.** `Archway.streamChat` takes an `onDelta(fragment, fullSoFar)`
callback and an `AbortController` signal. Deltas are written into the live bubble with
`textContent`, never `innerHTML` — model output is untrusted text. Stop aborts the
controller and the partial answer stays in the transcript as a real assistant turn, which
keeps the user/assistant roles alternating for the next request. If nothing streamed
before the failure, the turn is undone and your text is handed back to the composer.

**The readout.** After every turn `Archway.renderReadout` shows the provider and model the
gateway actually used, the prompt/completion token counts it billed against your quota,
and a mock badge when the request was served by the mock adapter because no live vendor
credential was configured for that provider.

Quotas are enforced in tokens, not dollars, and reserved before the upstream call — so a
request can be refused while the remaining-tokens header still shows headroom. A refusal
comes back as a normal gateway error and `Archway.renderError` explains it.

## Files

| File | What it is |
| --- | --- |
| `index.html` | Markup, the page's small layout style block, nothing else |
| `assets/app.js` | This app: transcript state, the streaming turn loop, the controls |
| `assets/archway.js` | Shared Archway client — key panel, models, chat, readout, errors |
| `assets/archway.css` | Shared design system — tokens, components, dark mode |
| `assets/fonts/` | Inter, the interface typeface, self-hosted under the SIL Open Font License (`OFL.txt`) |

The two shared files are copied in from the examples collection; edit them there, not here.

MIT licensed.
